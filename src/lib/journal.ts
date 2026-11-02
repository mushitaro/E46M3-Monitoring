/**
 * MEMORY's journal: everything MANUAL does, recorded as it happens, and cut into episodes the owner
 * can keep afterwards (operator, 2026-11-02).
 *
 * MANUAL is tried first and kept afterwards. Asking an owner to start a session before reading a
 * fault is the wrong order, and asking them to choose a range of time afterwards is a question
 * nobody can answer. So the app records every read as it happens, cuts the stream where work
 * naturally breaks, and SAVE keeps an episode whole. What is not kept goes after seven days.
 *
 * ## Where an episode breaks
 *
 *   - at a CONNECT: a new link is new work;
 *   - after a DISCONNECT, deliberate or lost: what comes next is on another link;
 *   - after ten minutes with nothing recorded: the owner walked away.
 *
 * Two neighbouring episodes can be joined (`joins`): the break before the later one is ignored.
 *
 * ## What it is not
 *
 * Not PROBE. A handed-over investigation keeps its own record and sends it as it goes; this is the
 * owner's own work, and it leaves the device only when kept and then synced (privacy policy §10,
 * 2026-11-02). Pure: the store is lib/sync/journalStore.ts and the recording is the shell's.
 */
import type { ErrorMemoryEntry } from '@tsunagi/ds2-mss54';
import { sessionLabel, type FailureNote, type SavedSession } from './sync/session';

/** Nothing recorded for this long ends an episode. */
export const IDLE_MS = 10 * 60_000;
/** An episode not kept is deleted this long after it ended. */
export const KEEP_MS = 7 * 24 * 60 * 60_000;

type Datalog = NonNullable<SavedSession['datalog']>;

/** One thing that happened. `t` is the device's clock when it was recorded. */
export type JournalEvent =
    | { t: number; kind: 'connect'; ecu: string; mock: boolean }
    | { t: number; kind: 'disconnect'; lost: boolean }
    | { t: number; kind: 'ident'; ident: { hex: string; length: number } }
    | { t: number; kind: 'faults'; faults: ErrorMemoryEntry[] }
    /** A module with no decoder: the frames its own SGBD sends and the bytes that came back. */
    | { t: number; kind: 'rawFaults'; reads: Array<{ request: string; response: string; source: string }> }
    | { t: number; kind: 'datalog'; datalog: Datalog }
    | { t: number; kind: 'adaptation'; blocks: unknown }
    | { t: number; kind: 'run'; job: string; result: unknown }
    | { t: number; kind: 'failure'; note: FailureNote };

/** The kinds that are something read or done, rather than the link coming and going. */
const CONTENT: ReadonlySet<JournalEvent['kind']> = new Set(['ident', 'faults', 'rawFaults', 'datalog', 'adaptation', 'run', 'failure']);

export interface Episode {
    /** Its first event's time, which also names it: stable while it grows, and unique on one device. */
    start: number;
    end: number;
    ecu: string | null;
    mock: boolean;
    events: JournalEvent[];
    counts: { faultReads: number; samples: number; adaptations: number; runs: number; failures: number };
}

/**
 * The episodes in a stream of events, oldest first. Episodes with nothing read or done in them (a
 * connect and a disconnect) are left out: there is nothing to keep. `joins` holds the starts of
 * episodes the owner joined to the one before.
 */
export function episodes(events: readonly JournalEvent[], joins: ReadonlySet<number> = new Set()): Episode[] {
    const sorted = [...events].sort((a, b) => a.t - b.t);
    const groups: JournalEvent[][] = [];
    let prev: JournalEvent | null = null;
    for (const e of sorted) {
        const breaks = prev === null || e.kind === 'connect' || prev.kind === 'disconnect' || e.t - prev.t > IDLE_MS;
        if (breaks && !(prev !== null && joins.has(e.t))) groups.push([e]);
        else groups[groups.length - 1].push(e);
        prev = e;
    }
    return groups.filter((g) => g.some((e) => CONTENT.has(e.kind))).map(toEpisode);
}

function toEpisode(events: JournalEvent[]): Episode {
    const connect = events.find((e): e is Extract<JournalEvent, { kind: 'connect' }> => e.kind === 'connect');
    const counts = { faultReads: 0, samples: 0, adaptations: 0, runs: 0, failures: 0 };
    for (const e of events) {
        if (e.kind === 'faults' || e.kind === 'rawFaults') counts.faultReads++;
        else if (e.kind === 'datalog') counts.samples += e.datalog.samples;
        else if (e.kind === 'adaptation') counts.adaptations++;
        else if (e.kind === 'run') counts.runs++;
        else if (e.kind === 'failure') counts.failures++;
    }
    return {
        start: events[0].t,
        end: events[events.length - 1].t,
        ecu: connect?.ecu ?? null,
        mock: connect?.mock ?? false,
        events,
        counts,
    };
}

/** When an episode that is not kept is deleted. */
export function expiresAt(ep: Pick<Episode, 'end'>): number {
    return ep.end + KEEP_MS;
}

/** The events older than every episode that may still be kept: what the store can delete now. */
export function prunable(events: readonly JournalEvent[], now: number, joins: ReadonlySet<number> = new Set()): number {
    // Cut at the start of the oldest episode still inside its seven days, so no episode is ever
    // half deleted; with none inside, everything up to now may go.
    const live = episodes(events, joins).filter((ep) => expiresAt(ep) > now);
    return live.length > 0 ? live[0].start : now;
}

/**
 * An episode as a saved session: what MEMORY lists and SYNC sends once it is kept. The newest
 * identity and fault read stand for the episode, the last recording is its datalog (each recording
 * is kept in `datalogs`), and learned values and procedure results ride along.
 */
export function toSession(
    ep: Episode,
    head: { id: string; createdAt?: number; syncedAt: number | null },
    now: number,
    fallbackEcu: string,
    appBuild: string | null,
): SavedSession & {
    datalogs: Datalog[];
    rawFaults: Array<{ request: string; response: string; source: string }> | null;
    adaptations: unknown[];
    runs: Array<{ job: string; result: unknown }>;
} {
    const last = <K extends JournalEvent['kind']>(kind: K) =>
        [...ep.events].reverse().find((e): e is Extract<JournalEvent, { kind: K }> => e.kind === kind);
    const ecu = ep.ecu ?? fallbackEcu;
    const datalogs = ep.events.filter((e): e is Extract<JournalEvent, { kind: 'datalog' }> => e.kind === 'datalog').map((e) => e.datalog);
    return {
        v: 1,
        id: head.id,
        label: sessionLabel(ep.start, ecu, ep.mock),
        createdAt: head.createdAt ?? ep.start,
        updatedAt: now,
        syncedAt: head.syncedAt,
        appBuild,
        ecu,
        mock: ep.mock,
        ident: last('ident')?.ident ?? null,
        faults: last('faults')?.faults ?? null,
        datalog: datalogs.length > 0 ? datalogs[datalogs.length - 1] : null,
        failures: ep.events.filter((e): e is Extract<JournalEvent, { kind: 'failure' }> => e.kind === 'failure').map((e) => e.note),
        datalogs,
        rawFaults: last('rawFaults')?.reads ?? null,
        adaptations: ep.events.filter((e): e is Extract<JournalEvent, { kind: 'adaptation' }> => e.kind === 'adaptation').map((e) => e.blocks),
        runs: ep.events.filter((e): e is Extract<JournalEvent, { kind: 'run' }> => e.kind === 'run').map((e) => ({ job: e.job, result: e.result })),
    };
}

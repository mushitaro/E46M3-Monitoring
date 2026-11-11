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
import { PLAUSIBLE_FROM } from './clock.ts';
import { sessionLabel, type FailureNote, type SavedSession } from './sync/session.ts';

/** Nothing recorded for this long ends an episode. */
export const IDLE_MS = 10 * 60_000;
/** An episode not kept is deleted this long after it ended. */
export const KEEP_MS = 7 * 24 * 60 * 60_000;

type Datalog = NonNullable<SavedSession['datalog']>;

/**
 * How an event was timed. `t` is `appNow()` (lib/clock) when it was recorded. `loose` is set when
 * the page had not yet heard the server's time: `t` is then the device's clock as it stood when the
 * page opened, and the page puts it right when it does hear it (useJournal). `seq` is the store's
 * key, present on events read back from it.
 */
export interface JournalStamp {
    loose?: true;
    seq?: number;
}

/** One thing that happened. */
export type JournalEvent = (
    | { t: number; kind: 'connect'; ecu: string; mock: boolean }
    | { t: number; kind: 'disconnect'; lost: boolean }
    | { t: number; kind: 'ident'; ident: { hex: string; length: number } }
    | { t: number; kind: 'faults'; faults: ErrorMemoryEntry[] }
    /** A module with no decoder: the frames its own SGBD sends and the bytes that came back. */
    | { t: number; kind: 'rawFaults'; reads: Array<{ request: string; response: string; source: string }> }
    | { t: number; kind: 'datalog'; datalog: Datalog }
    | { t: number; kind: 'adaptation'; blocks: unknown }
    | { t: number; kind: 'run'; job: string; result: unknown }
    | { t: number; kind: 'failure'; note: FailureNote }
) &
    JournalStamp;

/**
 * An event whose date cannot be trusted: timed before the page heard the server and never put
 * right (the page closed first), or timed before the WORKS build existed. Kept until the owner
 * decides: nothing undated is deleted by its age, because its age is not known.
 */
export const undated = (e: JournalEvent): boolean => e.loose === true || e.t < PLAUSIBLE_FROM;

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
    /** Some of its times cannot be trusted (`undated`): it is not deleted after seven days. */
    undated: boolean;
}

/**
 * The episodes in a stream of events, oldest first. Episodes with nothing read or done in them (a
 * connect and a disconnect) are left out: there is nothing to keep. `joins` holds the starts of
 * episodes the owner joined to the one before.
 */
export function episodes(events: readonly JournalEvent[], joins: ReadonlySet<number> = new Set()): Episode[] {
    return groups(events, joins)
        .filter((g) => g.some((e) => CONTENT.has(e.kind)))
        .map(toEpisode);
}

/** Every stretch of the stream, with or without anything read in it. */
function groups(events: readonly JournalEvent[], joins: ReadonlySet<number>): JournalEvent[][] {
    const sorted = [...events].sort((a, b) => a.t - b.t);
    const out: JournalEvent[][] = [];
    let prev: JournalEvent | null = null;
    for (const e of sorted) {
        const breaks = prev === null || e.kind === 'connect' || prev.kind === 'disconnect' || e.t - prev.t > IDLE_MS;
        if (breaks && !(prev !== null && joins.has(e.t))) out.push([e]);
        else out[out.length - 1].push(e);
        prev = e;
    }
    return out;
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
        undated: events.some(undated),
    };
}

/** When an episode that is not kept is deleted. */
export function expiresAt(ep: Pick<Episode, 'end'>): number {
    return ep.end + KEEP_MS;
}

/**
 * The events the store may delete now: whole stretches that ended more than seven days ago, so no
 * episode is ever half deleted. A stretch with an undated event is not timed by its own clock — a
 * clock put right later would make it look decades old the moment it was written — but by when a
 * page with the right time first found it (`found`, by its first event's time): seven days from then.
 */
export function expired(
    events: readonly JournalEvent[],
    now: number,
    joins: ReadonlySet<number> = new Set(),
    found: Readonly<Record<string, number>> = {},
): JournalEvent[] {
    return groups(events, joins)
        .filter((g) => {
            if (!g.some(undated)) return expiresAt({ end: g[g.length - 1].t }) <= now;
            const at = found[String(g[0].t)];
            return at !== undefined && at + KEEP_MS <= now;
        })
        .flat();
}

/** The undated episodes not yet marked found: what a page with the right time marks now. */
export function unfound(events: readonly JournalEvent[], joins: ReadonlySet<number>, found: Readonly<Record<string, number>>): number[] {
    return groups(events, joins)
        .filter((g) => g.some(undated) && found[String(g[0].t)] === undefined)
        .map((g) => g[0].t);
}

/**
 * What putting the clock right moved: an event's old time to its new one. The owner's joins and
 * keeps are named by an episode's first time, so they move with it.
 */
export function rebaseMeta<M extends { joins: number[]; kept: Record<string, string> }>(meta: M, moved: ReadonlyMap<number, number>): M {
    const at = (t: number) => moved.get(t) ?? t;
    const kept: Record<string, string> = {};
    for (const [start, v] of Object.entries(meta.kept)) {
        const i = v.lastIndexOf('@');
        kept[String(at(Number(start)))] = i < 0 ? v : `${v.slice(0, i)}@${at(Number(v.slice(i + 1)))}`;
    }
    return { ...meta, joins: meta.joins.map(at), kept };
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

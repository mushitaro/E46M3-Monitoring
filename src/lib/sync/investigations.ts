/**
 * A delegated investigation, kept the same on the device and in the owner's account: the tab's
 * half of the policy's 「調査の記録」 (functions/api/notebook and /runs are the other).
 *
 * For each CO-WORK record on the device that holds a mandate, one round:
 *
 *   1. take the record as the account holds it, and add here what the desk wrote — through the
 *      device store, so the rules check it again (lib/notebook/store `addEntries`);
 *   2. send what the device wrote that the account does not have, if it was written while the
 *      record was delegated (lib/investigation/share `sendableEntry`);
 *   3. send each finished PROBE run the account does not have, if a mandate stood as it started.
 *
 * Nothing is kept about what was sent: the account's own copy is the list, read at the start of
 * each round, so a round interrupted halfway is finished by the next. Entries never change, so the
 * same entry twice is the same entry. Never throws; best effort, like every send this build makes
 * by itself, and nothing at all before the notice is acknowledged (`canSync`).
 */
import { mergeEntries, type NotebookEntry } from '@/lib/notebook/rules';
import { addEntries, listAllEntries } from '@/lib/notebook/store';
import { sendableEntry, sendableRun } from '@/lib/investigation/share';
import { listRuns, type StoredRun } from '@/lib/probe/runStore';
import { canSync } from './cloud';
import { api, gzipB64 } from './owner-sync';

export interface InvestigationSync {
    /** Entries the desk wrote that reached this device. */
    pulled: number;
    /** Entries and runs this device sent. */
    sent: number;
    /** Entries the account refused, with its reason — a rule refuses the same entry every time. */
    refused: { id: unknown; reason: string }[];
}

const NONE: InvestigationSync = { pulled: 0, sent: 0, refused: [] };

/** How long after a mandate ends a record still gets rounds: the tail written offline goes, and so does a withdrawal. */
export const TAIL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The records worth a round: those holding a mandate that stands, or ended less than a week ago.
 * A record handed over long ago is not asked about every two minutes for the rest of the device's life.
 */
export function delegatedRecords(entries: readonly NotebookEntry[], now: number): string[] {
    return [
        ...new Set(entries.flatMap((e) => (e.body.kind === 'mandate' && e.at <= now && e.body.until + TAIL_MS > now ? [e.sessionId] : []))),
    ];
}

/** What of a record the account lacks and may have, in the order written. */
export function toSend(local: readonly NotebookEntry[], remote: readonly NotebookEntry[]): NotebookEntry[] {
    const there = new Set(remote.map((e) => e.id));
    const whole = mergeEntries(local, remote);
    return local.filter((e) => !there.has(e.id) && e.by !== 'desk' && sendableEntry(whole, e));
}

/** Runs of a record the account lacks and may have. */
export function runsToSend(entries: readonly NotebookEntry[], runs: readonly StoredRun[], remoteIds: ReadonlySet<string>): StoredRun[] {
    return runs.filter((r) => !remoteIds.has(r.id) && r.endedAt >= r.startedAt && sendableRun(entries, r));
}

function appBuild(): string | null {
    return document.querySelector('meta[name="build-id"]')?.getAttribute('content') ?? null;
}

async function pull(local: readonly NotebookEntry[], remote: readonly NotebookEntry[]): Promise<number> {
    const here = new Set(local.map((e) => e.id));
    let n = 0;
    // One at a time: a desk entry the device's rules refuse must not hold back the ones after it.
    for (const e of remote.filter((x) => !here.has(x.id))) {
        try {
            await addEntries([e]);
            n++;
        } catch {
            /* refused here: the device keeps what its rules allow */
        }
    }
    return n;
}

async function round(record: string, local: NotebookEntry[], out: InvestigationSync): Promise<void> {
    const got = await api<{ entries: NotebookEntry[] }>(`/api/notebook?record=${encodeURIComponent(record)}`);
    if (!got.ok || !got.data) return;
    const remote = got.data.entries ?? [];
    out.pulled += await pull(local, remote);

    const entries = toSend(local, remote);
    for (let i = 0; i < entries.length; i += 100) {
        const r = await api<{ stored: number; refused: InvestigationSync['refused'] }>('/api/notebook', {
            method: 'POST',
            body: { entries: entries.slice(i, i + 100) },
        });
        if (!r.ok || !r.data) return;
        out.sent += r.data.stored;
        out.refused.push(...(r.data.refused ?? []));
    }

    const whole = mergeEntries(local, remote);
    const listed = await api<{ runs: { id: string }[] }>(`/api/runs?record=${encodeURIComponent(record)}`);
    if (!listed.ok || !listed.data) return;
    const runs = runsToSend(whole, await listRuns(record).catch(() => []), new Set(listed.data.runs.map((r) => r.id)));
    for (const run of runs) {
        const r = await api('/api/runs', {
            method: 'POST',
            body: {
                id: run.id,
                record,
                n: run.n,
                planV: run.planV,
                startedAt: run.startedAt,
                endedAt: run.endedAt,
                end: run.end,
                sampleCount: run.samples.length,
                mock: run.mock === true,
                appBuild: appBuild(),
                runGz: await gzipB64(JSON.stringify(run)),
            },
        });
        if (r.ok) out.sent++;
    }
}

let inFlight: Promise<InvestigationSync> | null = null;

/** One round over every delegated record on the device. Concurrent calls share the round in flight. */
export function syncInvestigations(): Promise<InvestigationSync> {
    if (!canSync()) return Promise.resolve(NONE);
    inFlight ??= (async () => {
        const out: InvestigationSync = { pulled: 0, sent: 0, refused: [] };
        try {
            const all = await listAllEntries();
            for (const record of delegatedRecords(all, Date.now())) {
                await round(record, all.filter((e) => e.sessionId === record), out);
            }
        } catch {
            /* the next round finishes it */
        }
        return out;
    })().finally(() => {
        inFlight = null;
    });
    return inFlight;
}

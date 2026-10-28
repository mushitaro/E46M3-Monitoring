/**
 * Read records: what the WORKS build sent to the car and what came back, sent by the app itself,
 * success or failure — the policy's 「読み取りの記録」. They are how the operator sees which reads a
 * module answers, parked and moving, and where the tool is wrong.
 *
 * Like error records (errorRecords.ts), and unlike a session, they go by themselves, best effort,
 * and never into the caller's path: the link calls `recordRead` and is back at once. What differs
 * is the volume. A recording or a PROBE run repeats one read many times a second, so one of each
 * kind (lib/investigation/readRecord `readKey`) is kept per minute, and they go in batches — every
 * half minute, or sooner when a batch fills. A batch that could not go waits in its own outbox
 * (owner-sync.ts `outbox`, newest twenty batches, to the account it was queued under) for the next
 * send that succeeds.
 *
 * Preview only, the car only (useDs2Link tells this nothing about PRACTICE), and nothing before the
 * notice is acknowledged (`canSync`): until then a batch is kept, not sent.
 */
import type { ReadRecord } from '@/lib/investigation/readRecord';
import { READ_LIMITS, readKey } from '@/lib/investigation/readRecord';
import { canSync } from './cloud';
import { api, isPreviewBuild, outbox } from './owner-sync';

const box = outbox('monitoring-reads-outbox');

/** One of each kind of read per this long. */
export const READ_KIND_WINDOW_MS = 60_000;
const BATCH = 50;
const FLUSH_AFTER_MS = 30_000;

let pending: ReadRecord[] = [];
const lastOfKind = new Map<string, number>();
let timer: ReturnType<typeof setTimeout> | null = null;

function appBuild(): string | null {
    return document.querySelector('meta[name="build-id"]')?.getAttribute('content') ?? null;
}

/**
 * Whether this read is the first of its kind in the window — the throttle, on its own so it can be
 * tested. Forgets kinds older than the window as it goes.
 */
export function firstOfKind(seen: Map<string, number>, r: Omit<ReadRecord, 'id'>, windowMs = READ_KIND_WINDOW_MS): boolean {
    const key = readKey(r);
    const last = seen.get(key);
    if (last !== undefined && r.at - last < windowMs) return false;
    seen.set(key, r.at);
    if (seen.size > 500) for (const [k, t] of seen) if (r.at - t >= windowMs) seen.delete(k);
    return true;
}

/** Sent, or not worth sending again (refused as malformed or too large). */
async function send(batch: unknown): Promise<boolean> {
    if (!canSync()) return false;
    const r = await api('/api/reads', { method: 'POST', body: batch });
    if (r.ok) return true;
    return r.status === 400 || r.status === 413;
}

async function flush(): Promise<void> {
    timer = null;
    const reads = pending.splice(0, READ_LIMITS.batch);
    if (reads.length === 0) return;
    const batch = { reads, appBuild: appBuild() };
    try {
        if (await send(batch)) await box.flush(send);
        else await box.add(batch);
    } catch {
        // Nowhere to put it. The read already happened; this must not become a failure of it.
    }
    if (pending.length > 0) schedule(0);
}

function schedule(ms: number): void {
    if (timer === null) timer = setTimeout(() => void flush(), ms);
}

/** Fire and forget: the link's half. Returns at once; nothing it does reaches the caller. */
export function recordRead(r: Omit<ReadRecord, 'id'>): void {
    if (!isPreviewBuild()) return;
    try {
        if (!firstOfKind(lastOfKind, r)) return;
        pending.push({ ...r, id: crypto.randomUUID() });
        if (pending.length > READ_LIMITS.batch * 4) pending = pending.slice(-READ_LIMITS.batch * 4);
        schedule(pending.length >= BATCH ? 0 : FLUSH_AFTER_MS);
    } catch {
        /* the record is lost, the read is not */
    }
}

/** Send what is waiting — after a SYNC, say. Never throws. */
export async function flushReadRecords(): Promise<number> {
    if (!canSync()) return 0;
    if (pending.length > 0) await flush();
    return box.flush(send);
}

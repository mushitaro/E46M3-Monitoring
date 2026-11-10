/**
 * A read record: one read the WORKS build sent to the car, and what came back — the policy's
 * 「読み取りの記録」. Sent by the app itself, success or failure, so the operator can see which reads
 * a module answers, parked or moving, and fix the tool where it does not.
 *
 * The shape is shared by the tab (lib/sync/readRecords), the route that stores it
 * (functions/api/reads) and the desk Worker that reads it back, so all three agree on it. Pure.
 */
import type { Motion } from '../vehicleState';

export type ReadOutcome = 'ok' | 'rejected' | 'failed';

export interface ReadRecord {
    id: string;
    /** ms since the epoch, on the tab's clock. */
    at: number;
    /** Module id (`mss54`, `dsc_e46`). */
    module: string;
    /** The job, `IDENT`, `FS_LESEN`, `LIVE_19`, or a catalogue job id. */
    job: string;
    /** The frame sent, hex. */
    request: string | null;
    /** The bytes that came back, hex; null when nothing did. */
    response: string | null;
    outcome: ReadOutcome;
    /** The ECU's status or the transport's message, when not ok. */
    reason: string | null;
    /** The DME's speed as last read before this, km/h; null when it was not read. */
    speedKmh: number | null;
    motion: Motion;
}

export const READ_LIMITS = { batch: 200, hex: 4000, reason: 300, job: 64 } as const;

const ID = /^[A-Za-z0-9_-]{8,64}$/;
const MODULE = /^[a-z0-9_]{2,32}$/;
const HEX = /^[0-9a-f ]*$/i;

/** What is wrong with a record, in a sentence — or null. */
export function readRecordProblem(r: unknown): string | null {
    if (!r || typeof r !== 'object') return 'not a read record';
    const x = r as Partial<ReadRecord>;
    if (typeof x.id !== 'string' || !ID.test(x.id)) return 'id must be 8-64 letters, digits, dashes or underscores';
    if (typeof x.at !== 'number' || !Number.isFinite(x.at) || x.at < 1) return 'at must be a time in ms';
    if (typeof x.module !== 'string' || !MODULE.test(x.module)) return 'module must be a module id';
    if (typeof x.job !== 'string' || x.job.length === 0 || x.job.length > READ_LIMITS.job) return 'job is required';
    for (const k of ['request', 'response'] as const) {
        const v = x[k];
        if (v !== null && (typeof v !== 'string' || v.length > READ_LIMITS.hex || !HEX.test(v))) return `${k} must be hex or null`;
    }
    if (x.outcome !== 'ok' && x.outcome !== 'rejected' && x.outcome !== 'failed') return 'outcome must be ok, rejected or failed';
    if (x.reason !== null && (typeof x.reason !== 'string' || x.reason.length > READ_LIMITS.reason)) return 'reason must be a short line or null';
    if (x.speedKmh !== null && (typeof x.speedKmh !== 'number' || !Number.isFinite(x.speedKmh))) return 'speedKmh must be a number or null';
    if (x.motion !== 'parked' && x.motion !== 'moving' && x.motion !== 'unknown') return 'motion must be parked, moving or unknown';
    return null;
}

/**
 * Whether a read like this one was recorded in the last `windowMs`: the same module, job, frame,
 * outcome and motion. A PROBE run or a recording repeats the same read many times a second; one of
 * each kind a minute says everything the record is for.
 */
export function readKey(r: Pick<ReadRecord, 'module' | 'job' | 'request' | 'outcome' | 'motion'>): string {
    return [r.module, r.job, r.request ?? '', r.outcome, r.motion].join('|');
}

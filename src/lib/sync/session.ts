/**
 * What a saved session IS — the record the SESSIONS tab keeps on the device and SYNC sends.
 *
 * Pure: no IndexedDB, no fetch. The store (`sessionStore.ts`) and the cloud client (`cloud.ts`)
 * both move this shape around unchanged, so a session restored on another device is byte for byte
 * the one that was saved, and this file is where its meaning is written down.
 *
 * ## What goes in, and why each part
 *
 *   - the ECU identity and the fault read — the evidence a repair decision rests on, and the thing
 *     a clear destroys. Kept as the decoder produced it, not re-rendered text, so the viewer can
 *     name codes again with whatever catalogue it has;
 *   - the datalog as CSV — the exact text EXPORT CSV writes (`datalogCsv`), not the sample objects,
 *     so the saved copy and the downloaded file cannot disagree about a column;
 *   - the comms log AROUND FAILURES — not the whole ring buffer. A 5,000-line log is mostly
 *     keep-alives; the lines that matter are the ones just before something went wrong, and those
 *     are what an error record carries too.
 */
import type { ErrorMemoryEntry } from '@tsunagi/ds2-mss54';
import type { CommsLogLine } from '@/hooks/useDs2Link';
import { logLine } from '@/lib/download';

/** How many comms-log lines are kept before (and including) a failure. */
export const EXCERPT_LINES = 40;

export interface FailureNote {
    at: number;
    /** What was being attempted, in the caller's words — "Read fault memory", "Connect". */
    job: string;
    error: string;
    errorKind: string | null;
    /** The comms-log lines up to and including the failure, formatted as the exported file is. */
    excerpt: string[];
}

export interface SavedSession {
    v: 1;
    id: string;
    label: string;
    createdAt: number;
    /** Last change on this device. SYNC sends a session whose `updatedAt` is past its `syncedAt`. */
    updatedAt: number;
    /** The `updatedAt` that last reached the account, or null if it never has. */
    syncedAt: number | null;
    appBuild: string | null;
    /** The module selected when it was saved (`mss54`, `smg2`, …). */
    ecu: string;
    /** PRACTICE: the values are the simulator's. Said everywhere the session is listed. */
    mock: boolean;
    ident: { hex: string; length: number } | null;
    /** Null = not read in this session, which is not the same as zero faults. */
    faults: ErrorMemoryEntry[] | null;
    datalog: { channels: string[]; samples: number; csv: string } | null;
    failures: FailureNote[];
}

/** The lines a failure is judged by: the tail of the log at the moment it happened. */
export function excerpt(log: readonly CommsLogLine[], n = EXCERPT_LINES): string[] {
    return log.slice(-n).map(logLine);
}

/** Whether SYNC still has to send this one. */
export function needsSync(s: Pick<SavedSession, 'syncedAt' | 'updatedAt'>): boolean {
    return s.syncedAt === null || s.syncedAt < s.updatedAt;
}

/** What the list and the cloud row say about a session without opening it. */
export function summarise(s: SavedSession) {
    return {
        faultCount: s.faults === null ? null : s.faults.length,
        sampleCount: s.datalog?.samples ?? 0,
        failureCount: s.failures.length,
    };
}

/** Whether there is anything worth saving: a read, a recording, or a failure to keep. */
export function hasContent(s: {
    ident: SavedSession['ident'];
    faults: SavedSession['faults'];
    samples: number;
    failures: number;
}): boolean {
    return s.ident !== null || s.faults !== null || s.samples > 0 || s.failures > 0;
}

/**
 * A name a person can pick out of a list: local date and time, the module, and PRACTICE when it
 * was. Local time for the reason `stamp()` gives — it is read by whoever stood at the car.
 */
export function sessionLabel(createdAt: number, ecu: string, mock: boolean): string {
    const d = new Date(createdAt);
    const p = (n: number) => String(n).padStart(2, '0');
    const when = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
    return `${when} ${ecu.toUpperCase()}${mock ? ' PRACTICE' : ''}`;
}

/**
 * The shape check a restore runs before a cloud copy is written into the local store. The blob
 * came back from the owner's own rows, but a record from an older build must fail here, loudly,
 * rather than as a viewer that throws on a missing field.
 */
export function isSavedSession(x: unknown): x is SavedSession {
    if (!x || typeof x !== 'object') return false;
    const s = x as Partial<SavedSession>;
    return (
        s.v === 1 &&
        typeof s.id === 'string' &&
        typeof s.label === 'string' &&
        typeof s.createdAt === 'number' &&
        typeof s.updatedAt === 'number' &&
        typeof s.ecu === 'string' &&
        Array.isArray(s.failures) &&
        (s.faults === null || Array.isArray(s.faults))
    );
}

/** The saved CSV back into a header and rows, for the read-only viewer. */
export function parseCsv(csv: string): { header: string[]; rows: string[][] } {
    const lines = csv.split(/\r?\n/).filter((l) => l.length > 0);
    return { header: (lines[0] ?? '').split(','), rows: lines.slice(1).map((l) => l.split(',')) };
}

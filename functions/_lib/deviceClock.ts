import { PLAUSIBLE_FROM } from '../../src/lib/clock';
import type { NotebookEntry } from '../../src/lib/notebook/rules';

/**
 * The device's clock, put right on the way in.
 *
 * The head unit's clock is not the owner's to set: it boots at 2006 and GPS may leave it in 2007
 * (a week-number rollover). An entry it writes then carries 2007, and a mandate given that day ends
 * in 2007 — the desk reads it as long expired, and nothing the owner asked for is handed over.
 *
 * The tab sends its own `Date.now()` as `clientNow` with every batch. When that is more than a day
 * from the server's, every time in the batch moves by the same difference, so the record keeps its
 * order and a mandate keeps its length. Within a day nothing moves (the same tolerance the gate uses).
 * The device keeps its own copy as written; only the stored copy is put right.
 */

export const CLOCK_TOLERANCE_MS = 86_400_000;

/** How far to move the batch's times: 0 when the device's clock agrees, or was not sent. */
export function clockShift(clientNow: unknown, now: number): number {
    if (typeof clientNow !== 'number' || !Number.isFinite(clientNow) || clientNow <= 0) return 0;
    const d = now - clientNow;
    return Math.abs(d) > CLOCK_TOLERANCE_MS ? d : 0;
}

/**
 * Entries still dated before the WORKS build existed once the batch's shift is applied. They were
 * written in a page that never heard the server's time and sent from a later one that had (lib/clock):
 * the batch's `clientNow` is right, and theirs is not, by an amount nobody recorded. They are moved
 * together so the last of them is now — their order and a mandate's length kept — rather than stored
 * twenty years in the past, where a mandate given today has long ended.
 */
export function settleUndated(entries: NotebookEntry[], now: number): NotebookEntry[] {
    const old = entries.filter((e) => e && typeof e.at === 'number' && e.at < PLAUSIBLE_FROM);
    if (old.length === 0) return entries;
    const shift = now - Math.max(...old.map((e) => e.at));
    return entries.map((e) => (old.includes(e) ? shiftEntry(e, shift) : e));
}

/** The entry with its times moved by `shift`: when it was written, and a mandate's end. */
export function shiftEntry(e: NotebookEntry, shift: number): NotebookEntry {
    if (shift === 0 || !e || typeof e.at !== 'number') return e;
    const body = e.body?.kind === 'mandate' && typeof e.body.until === 'number' ? { ...e.body, until: e.body.until + shift } : e.body;
    return { ...e, at: e.at + shift, body };
}

/**
 * MEMORY's journal on THIS device, in IndexedDB (lib/journal.ts says what it is).
 *
 * Appends only: an event is never changed once written. What goes is whole episodes past their
 * seven days (`prune`). The two small facts the owner adds — which episodes they joined, and which
 * they kept as which saved session — live beside it in `journalMeta`.
 *
 * Preview-only, like everything under lib/sync (lib/features.ts). The append is quiet on failure —
 * a journal that cannot be written must not stop a read — but listing rejects, because MEMORY says
 * what is there and must not say it from nothing.
 */
import type { JournalEvent } from '@tsunagi/monitoring-engine';
import { inTransaction, JOURNAL, JOURNAL_META } from './db';

export interface JournalMeta {
    /** Starts of episodes joined to the one before (lib/journal `episodes`). */
    joins: number[];
    /** Episode start → the saved session it was kept as. */
    kept: Record<string, string>;
    /** Undated episode start → when a page with the right time first found it (lib/journal `expired`). */
    found?: Record<string, number>;
}

const META_KEY = 'meta';

/** Appends an event; its key in the store (`seq`), or null when it could not be written. */
export async function appendEvent(e: JournalEvent): Promise<number | null> {
    try {
        return await inTransaction<number | null>(JOURNAL, 'readwrite', (s, done) => {
            const req = s.add(e);
            req.onsuccess = () => done(typeof req.result === 'number' ? req.result : null);
        });
    } catch {
        // Quiet: the read it records has already happened, and saying so is the screen's job.
        return null;
    }
}

/** Every event, with its key in the store (`seq`). */
export function listEvents(): Promise<JournalEvent[]> {
    return inTransaction<JournalEvent[]>(JOURNAL, 'readonly', (s, done) => {
        const req = s.index('t').getAll();
        req.onsuccess = () => done(req.result as JournalEvent[]);
    });
}

/** Deletes these events (by `seq`). */
export function deleteEvents(seqs: readonly number[]): Promise<void> {
    return inTransaction<void>(JOURNAL, 'readwrite', (s, done) => {
        for (const seq of seqs) s.delete(seq);
        done(undefined);
    });
}

/**
 * Puts the clock right on events this page timed before it heard the server's time: each moves by
 * `step` and is no longer loose. Returns each one's old time and new.
 */
export function rebaseEvents(seqs: readonly number[], step: number): Promise<Map<number, number>> {
    return inTransaction<Map<number, number>>(JOURNAL, 'readwrite', (s, done) => {
        const moved = new Map<number, number>();
        let pending = seqs.length;
        if (pending === 0) return done(moved);
        for (const seq of seqs) {
            const req = s.get(seq);
            req.onsuccess = () => {
                const e = req.result as JournalEvent | undefined;
                if (e) {
                    const next = { ...e, t: e.t + step };
                    delete next.loose;
                    moved.set(e.t, next.t);
                    s.put(next);
                }
                if (--pending === 0) done(moved);
            };
        }
    });
}

export function getMeta(): Promise<JournalMeta> {
    return inTransaction<JournalMeta>(JOURNAL_META, 'readonly', (s, done) => {
        const req = s.get(META_KEY);
        req.onsuccess = () => {
            const m = req.result as (JournalMeta & { key: string }) | undefined;
            done({ joins: m?.joins ?? [], kept: m?.kept ?? {}, found: m?.found ?? {} });
        };
    });
}

export function putMeta(m: JournalMeta): Promise<void> {
    return inTransaction<void>(JOURNAL_META, 'readwrite', (s, done) => {
        s.put({ key: META_KEY, ...m }).onsuccess = () => done(undefined);
    });
}

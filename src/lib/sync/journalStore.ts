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
import type { JournalEvent } from '../journal';
import { inTransaction, JOURNAL, JOURNAL_META } from './db';

export interface JournalMeta {
    /** Starts of episodes joined to the one before (lib/journal `episodes`). */
    joins: number[];
    /** Episode start → the saved session it was kept as. */
    kept: Record<string, string>;
}

const META_KEY = 'meta';

export async function appendEvent(e: JournalEvent): Promise<void> {
    try {
        await inTransaction<void>(JOURNAL, 'readwrite', (s, done) => {
            s.add(e).onsuccess = () => done(undefined);
        });
    } catch {
        // Quiet: the read it records has already happened, and saying so is the screen's job.
    }
}

export function listEvents(): Promise<JournalEvent[]> {
    return inTransaction<JournalEvent[]>(JOURNAL, 'readonly', (s, done) => {
        const req = s.index('t').getAll();
        // `seq` is the store's own key, not part of the event.
        req.onsuccess = () =>
            done(
                (req.result as Array<JournalEvent & { seq?: number }>).map((e) => {
                    const copy = { ...e };
                    delete copy.seq;
                    return copy as JournalEvent;
                }),
            );
    });
}

/** Deletes every event before `t`. */
export function pruneBefore(t: number): Promise<void> {
    return inTransaction<void>(JOURNAL, 'readwrite', (s, done) => {
        s.index('t').openCursor(IDBKeyRange.upperBound(t, true)).onsuccess = function () {
            const cur = this.result;
            if (!cur) return done(undefined);
            cur.delete();
            cur.continue();
        };
    });
}

export function getMeta(): Promise<JournalMeta> {
    return inTransaction<JournalMeta>(JOURNAL_META, 'readonly', (s, done) => {
        const req = s.get(META_KEY);
        req.onsuccess = () => {
            const m = req.result as (JournalMeta & { key: string }) | undefined;
            done({ joins: m?.joins ?? [], kept: m?.kept ?? {} });
        };
    });
}

export function putMeta(m: JournalMeta): Promise<void> {
    return inTransaction<void>(JOURNAL_META, 'readwrite', (s, done) => {
        s.put({ key: META_KEY, ...m }).onsuccess = () => done(undefined);
    });
}

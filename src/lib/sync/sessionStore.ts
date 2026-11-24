/**
 * The sessions saved on THIS device, in IndexedDB.
 *
 * SAVE writes here; SYNC reads from here and sends; a restore writes a cloud copy back here. The
 * store is the half of SYNC that works in a garage with no signal — a session is saved whether or
 * not it can be sent, and it stays after it has been.
 *
 * Preview-only, like everything under lib/sync (lib/features.ts): a production build never opens
 * this database. Unlike the error-record outbox, these calls DO reject — a SAVE that did not happen
 * must say so, because the owner is about to rely on it.
 */
import { inTransaction as transact, SESSIONS } from './db';
import type { SavedSession } from '@tsunagi/monitoring-engine';

export function sessionStore(name?: string) {
    const inTransaction: typeof transact = (store, mode, op) => transact(store, mode, op, name);
    function run<T>(mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
        return inTransaction<T>(SESSIONS, mode, (s, done) => {
            const req = op(s);
            req.onsuccess = () => done(req.result);
        });
    }

    /** Every saved session, newest first. */
    async function listLocal(): Promise<SavedSession[]> {
        const all = await run('readonly', (s) => s.getAll() as IDBRequest<SavedSession[]>);
        return all.sort((a, b) => b.createdAt - a.createdAt);
    }

    function getLocal(id: string): Promise<SavedSession | undefined> {
        return run('readonly', (s) => s.get(id) as IDBRequest<SavedSession | undefined>);
    }

    async function putLocal(session: SavedSession): Promise<void> {
        await run('readwrite', (s) => s.put(session));
    }

    async function deleteLocal(id: string): Promise<void> {
        await run('readwrite', (s) => s.delete(id));
    }
    /** A network acknowledgement can arrive after a local edit or deletion in another tab. */
    function acknowledge(id: string, revision: number): Promise<void> {
        return inTransaction<void>(SESSIONS, 'readwrite', (store, done) => {
            const req = store.get(id);
            req.onsuccess = () => {
                const latest = req.result as SavedSession | undefined;
                if (latest && latest.updatedAt >= revision && (latest.syncedAt ?? 0) < revision) {
                    store.put({ ...latest, syncedAt: revision });
                }
                done(undefined);
            };
        });
    }

    function restoreCopy(copy: SavedSession): Promise<boolean> {
        return inTransaction<boolean>(SESSIONS, 'readwrite', (store, done) => {
            const req = store.get(copy.id);
            req.onsuccess = () => {
                const latest = req.result as SavedSession | undefined;
                if (latest && (latest.updatedAt > copy.updatedAt || (latest.syncedAt ?? 0) < latest.updatedAt)) {
                    done(false);
                    return;
                }
                store.put({ ...copy, syncedAt: copy.updatedAt });
                done(true);
            };
        });
    }
    return { listLocal, getLocal, putLocal, deleteLocal, acknowledge, restoreCopy };
}

export const { listLocal, getLocal, putLocal, deleteLocal } = sessionStore();

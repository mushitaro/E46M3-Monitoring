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
import { inTransaction, SESSIONS } from './db';
import type { SavedSession } from './session';

function run<T>(mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    return inTransaction<T>(SESSIONS, mode, (s, done) => {
        const req = op(s);
        req.onsuccess = () => done(req.result);
    });
}

/** Every saved session, newest first. */
export async function listLocal(): Promise<SavedSession[]> {
    const all = await run('readonly', (s) => s.getAll() as IDBRequest<SavedSession[]>);
    return all.sort((a, b) => b.createdAt - a.createdAt);
}

export function getLocal(id: string): Promise<SavedSession | undefined> {
    return run('readonly', (s) => s.get(id) as IDBRequest<SavedSession | undefined>);
}

export async function putLocal(session: SavedSession): Promise<void> {
    await run('readwrite', (s) => s.put(session));
}

export async function deleteLocal(id: string): Promise<void> {
    await run('readwrite', (s) => s.delete(id));
}

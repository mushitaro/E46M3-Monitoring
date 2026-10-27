/**
 * The one IndexedDB database the WORKS build keeps on the device, and its stores.
 *
 * One `open`, so every store is created by the same upgrade: a second module opening the database
 * at an older version would fail with VersionError the moment this one had upgraded it.
 *
 *   - `sessions` — saved sessions (sessionStore.ts). Version 1.
 *   - `notebook` — CO-WORK entries, keyed by entry id, indexed by the record they belong to
 *     (notebook/store.ts). Version 2.
 *
 * WORKS-only, like everything under lib/sync (lib/features.ts): a production build never opens it.
 */
export const DB = 'e46m3-monitoring';
export const VERSION = 2;
export const SESSIONS = 'sessions';
export const NOTEBOOK = 'notebook';

export function openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB, VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(SESSIONS)) db.createObjectStore(SESSIONS, { keyPath: 'id' });
            if (!db.objectStoreNames.contains(NOTEBOOK)) {
                db.createObjectStore(NOTEBOOK, { keyPath: 'id' }).createIndex('sessionId', 'sessionId');
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

/**
 * Run `op` in one transaction and resolve when it COMMITS — not when the request succeeds: a write
 * is not durable until then, and "saved" said a moment early is the one lie this must not tell.
 */
export async function inTransaction<T>(
    store: string,
    mode: IDBTransactionMode,
    op: (s: IDBObjectStore, done: (value: T) => void, fail: (reason: Error) => void) => void,
): Promise<T> {
    const db = await openDb();
    try {
        return await new Promise<T>((resolve, reject) => {
            const tx = db.transaction(store, mode);
            let value: T;
            let refused: Error | null = null;
            op(
                tx.objectStore(store),
                (v) => {
                    value = v;
                },
                (e) => {
                    refused = e;
                    tx.abort();
                },
            );
            tx.oncomplete = () => resolve(value);
            tx.onerror = () => reject(refused ?? tx.error);
            tx.onabort = () => reject(refused ?? tx.error);
        });
    } finally {
        db.close();
    }
}

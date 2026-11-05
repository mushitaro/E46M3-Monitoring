import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import type { SavedSession } from './session';

beforeEach(() => { vi.resetModules(); vi.stubGlobal('indexedDB', new IDBFactory()); });
afterEach(() => vi.unstubAllGlobals());
const session = (): SavedSession => ({ v: 1, id: 'run-00001', label: 'drive', createdAt: 1, updatedAt: 1, syncedAt: null,
    appBuild: null, ecu: 'mss54', mock: true, ident: null, faults: [], failures: [], datalog: { channels: ['3:n'], samples: 0, csv: '' } });

it('recovers all committed chunks after a page loss without duplicating samples', async () => {
    const { RecordingWriter, recoverRecordings } = await import('./recordingStore');
    const { listLocal } = await import('./sessionStore');
    const failed = vi.fn();
    const writer = new RecordingWriter({ id: 'run-00001', kind: 'datalog', data: session(), count: 0, complete: false }, failed);
    writer.sample({ time: 0, values: { '3:n': 800 } });
    await writer.flush();
    writer.sample({ time: 1, values: { '3:n': 900 } });
    await writer.flush();
    await recoverRecordings();
    await recoverRecordings();
    const saved = await listLocal();
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ id: 'run-00001', mock: true, label: 'drive [INTERRUPTED]', datalog: { samples: 2 } });
    expect(saved[0].datalog!.csv).toContain('900');
    expect(failed).not.toHaveBeenCalled();
});

it('preserves existing version 3 sessions during the checkpoint-store upgrade', async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open('e46m3-monitoring', 3);
        req.onupgradeneeded = () => req.result.createObjectStore('sessions', { keyPath: 'id' });
        req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
    });
    await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('sessions', 'readwrite'); tx.objectStore('sessions').put(session());
        tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
    });
    db.close();
    const { openDb } = await import('./db');
    const upgraded = await openDb();
    expect(upgraded.version).toBe(4);
    expect(upgraded.objectStoreNames.contains('recordingChunks')).toBe(true);
    upgraded.close();
    const { listLocal } = await import('./sessionStore');
    expect((await listLocal())[0].id).toBe('run-00001');
});

it('a failed chunk does not advance the durable header or report success', async () => {
    const { RecordingWriter } = await import('./recordingStore');
    const { openDb } = await import('./db');
    const failed = vi.fn();
    const writer = new RecordingWriter({ id: 'run-00001', kind: 'datalog', data: session(), count: 0, complete: false }, failed);
    writer.sample(() => 1); // Functions cannot be structured-cloned into IndexedDB.
    await expect(writer.flush()).rejects.toBeDefined();
    expect(failed).toHaveBeenCalled();
    const db = await openDb();
    const header = await new Promise(resolve => { const req = db.transaction('recordingHeaders').objectStore('recordingHeaders').get('run-00001'); req.onsuccess = () => resolve(req.result); });
    db.close();
    expect(header).toBeUndefined();
});

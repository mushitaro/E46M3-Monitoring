import { openDb } from './db';
import { appNow, anchoredTime } from '../clock';
import { datalogCsv } from '../download';
import { listLocal, putLocal } from './sessionStore';
import { sessionLabel, type SavedSession } from './session';
import { putRun, type StoredRun } from '../probe/runStore';
import type { LiveSample } from '@/hooks/useDs2Link';
import type { ChannelId } from '@tsunagi/ds2-mss54';

export const HEADERS = 'recordingHeaders';
export const CHUNKS = 'recordingChunks';
let recovery: Promise<void> | null = null;
type Header = { id: string; kind: 'datalog' | 'probe'; data: SavedSession | StoredRun; count: number; complete: boolean };
type Chunk<T = unknown> = { id: string; index: number; samples: T[] };

async function transaction<T>(mode: IDBTransactionMode, op: (h: IDBObjectStore, c: IDBObjectStore, done: (v: T) => void) => void): Promise<T> {
    const db = await openDb();
    try {
        return await new Promise<T>((resolve, reject) => {
            const tx = db.transaction([HEADERS, CHUNKS], mode);
            let result: T;
            tx.oncomplete = () => resolve(result);
            tx.onerror = tx.onabort = () => reject(tx.error ?? new Error('Recording transaction aborted'));
            try { op(tx.objectStore(HEADERS), tx.objectStore(CHUNKS), v => { result = v; }); }
            catch (error) { tx.abort(); reject(error); }
        });
    } finally { db.close(); }
}

/** Serial, incremental commits: neither a clock change nor a page-exit event is required. */
export class RecordingWriter<T> {
    private queue: Promise<void> = Promise.resolve();
    private pending: T[] = [];
    private count = 0;
    private lastFlush = -Infinity;
    private releaseLock = () => {};
    error: unknown = null;
    constructor(private header: Header, private onError: () => void) {
        this.queue = recovery ?? Promise.resolve();
        if (typeof navigator !== 'undefined' && navigator.locks) {
            this.queue = this.queue.then(() => new Promise<void>((resolve, reject) => {
                const held = new Promise<void>(release => { this.releaseLock = release; });
                void navigator.locks.request(`monitoring-recording:${header.id}`, async () => {
                    resolve();
                    await held;
                }).catch(reject);
            }));
        }
    }
    sample(value: T): void {
        this.pending.push(value);
        if (performance.now() - this.lastFlush >= 1000) void this.flush();
    }
    flush(data?: Header['data'], complete = false): Promise<void> {
        if (data) this.header = { ...this.header, data };
        this.lastFlush = performance.now();
        const samples = this.pending.splice(0);
        const index = this.count;
        this.count += samples.length;
        const dataAtCommit = this.header.kind === 'probe'
            ? { ...this.header.data, startedAt: anchoredTime((this.header.data as StoredRun).startedAt) }
            : { ...this.header.data, createdAt: anchoredTime((this.header.data as SavedSession).createdAt),
                label: anchoredTime((this.header.data as SavedSession).createdAt) === (this.header.data as SavedSession).createdAt ? (this.header.data as SavedSession).label : sessionLabel(anchoredTime((this.header.data as SavedSession).createdAt), (this.header.data as SavedSession).ecu, (this.header.data as SavedSession).mock) };
        const header = { ...this.header, data: dataAtCommit, count: this.count, complete } as Header;
        const work = this.queue.then(() => transaction<void>('readwrite', (h, c, done) => {
            if (samples.length) c.put({ id: header.id, index, samples } satisfies Chunk<T>);
            h.put(header);
            done(undefined);
        }));
        // A failed chunk is never skipped by later commits. The UI reports the failure.
        this.queue = work;
        if (complete) void work.then(() => this.releaseLock(), () => this.releaseLock());
        void work.catch(e => { this.error = e; this.onError(); });
        return work;
    }
}

/** Recover durable chunks after page/process loss. Upserts use the original run id. */
export function recoverRecordings(): Promise<void> {
    return recovery ??= recover();
}

async function recover(): Promise<void> {
    const all = await transaction<{ headers: Header[]; chunks: Chunk[] }>('readonly', (h, c, done) => {
        const headers = h.getAll(), chunks = c.getAll();
        chunks.onsuccess = () => done({ headers: headers.result, chunks: chunks.result });
    });
    const local = await listLocal();
    for (const h of all.headers) {
        const recoverOne = async () => {
        const samples = all.chunks.filter(c => c.id === h.id).sort((a, b) => a.index - b.index).flatMap(c => c.samples);
        if (samples.length !== h.count) throw new Error('Recording checkpoint is incomplete');
        if (h.kind === 'datalog') {
            const base = h.data as SavedSession;
            const prior = local.find(s => s.id === h.id);
            await putLocal({ ...base, ...prior, id: h.id, updatedAt: appNow(),
                label: h.complete ? (prior?.label ?? base.label) : `${base.label} [INTERRUPTED]`,
                datalog: { id: h.id, channels: base.datalog!.channels, samples: samples.length,
                    csv: datalogCsv(base.datalog!.channels as ChannelId[], samples as LiveSample[]) } });
        } else {
            const base = h.data as StoredRun;
            const recovered = samples as StoredRun['samples'];
            await putRun({ ...base, samples: recovered, endedAt: h.complete ? base.endedAt : base.startedAt + (recovered.at(-1)?.t ?? 0) * 1000, end: h.complete ? base.end : 'interrupted' });
        }
        // Delete only after the recovered record has committed. Repeating after a crash is safe.
        await transaction<void>('readwrite', (headers, chunks, done) => {
            headers.delete(h.id);
            for (const c of all.chunks.filter(c => c.id === h.id)) chunks.delete([c.id, c.index]);
            done(undefined);
        });
        };
        if (typeof navigator !== 'undefined' && navigator.locks) {
            // Another open page may still be recording. Never consume its live checkpoint.
            await navigator.locks.request(`monitoring-recording:${h.id}`, { ifAvailable: true }, lock => lock ? recoverOne() : undefined);
        } else await recoverOne();
    }
}

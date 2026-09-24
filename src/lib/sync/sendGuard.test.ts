import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FailureReport } from './errorRecords';
import type { SavedSession } from './session';

/**
 * Nothing leaves the device before the owner has acknowledged what the preview sends.
 *
 * Asserted where the requests are made — lib/sync — rather than through the dialog, because the
 * dialog is only what an owner sees; this is what the code does. The browser is stood in for by
 * the few globals the sync code touches: the app-variant tag, localStorage, fetch, and an
 * IndexedDB just large enough for the outbox.
 */

type Row = Record<string, unknown> & { key: number };

/** An IndexedDB with one object store per database — the outbox's whole use of it. */
function memoryIndexedDB() {
    const dbs = new Map<string, { rows: Map<number, Row>; next: number }>();
    const request = <T>(run: () => T) => {
        const r: { result?: T; error: unknown; onsuccess: null | (() => void); onerror: null | (() => void) } = {
            error: null,
            onsuccess: null,
            onerror: null,
        };
        queueMicrotask(() => {
            try {
                r.result = run();
                r.onsuccess?.();
            } catch (e) {
                r.error = e;
                r.onerror?.();
            }
        });
        return r;
    };
    const store = (d: { rows: Map<number, Row>; next: number }) => ({
        add: (v: Record<string, unknown>) =>
            request(() => {
                const key = d.next++;
                d.rows.set(key, { ...v, key });
                return key;
            }),
        getAllKeys: () => request(() => [...d.rows.keys()]),
        getAll: () => request(() => [...d.rows.values()]),
        delete: (k: number) => request(() => void d.rows.delete(k)),
        count: () => request(() => d.rows.size),
    });
    const opened: string[] = [];
    return {
        opened,
        rows: (name: string) => [...(dbs.get(name)?.rows.values() ?? [])],
        open(name: string) {
            opened.push(name);
            const r: {
                result?: unknown;
                error: unknown;
                onupgradeneeded: null | (() => void);
                onsuccess: null | (() => void);
                onerror: null | (() => void);
            } = { error: null, onupgradeneeded: null, onsuccess: null, onerror: null };
            queueMicrotask(() => {
                const created = !dbs.has(name);
                if (created) dbs.set(name, { rows: new Map(), next: 1 });
                const d = dbs.get(name)!;
                r.result = { createObjectStore: () => ({}), transaction: () => ({ objectStore: () => store(d) }), close: () => {} };
                if (created) r.onupgradeneeded?.();
                r.onsuccess?.();
            });
            return r;
        },
    };
}

function memoryStorage() {
    const m = new Map<string, string>();
    return {
        getItem: (k: string) => (m.has(k) ? (m.get(k) as string) : null),
        setItem: (k: string, v: string) => void m.set(k, String(v)),
        removeItem: (k: string) => void m.delete(k),
    };
}

/** The document's two tags the sync code reads: which build this is, and its id. */
function documentOf(variant: string | null) {
    return {
        querySelector: (sel: string) => {
            if (sel === 'meta[name="app-variant"]') return variant === null ? null : { getAttribute: () => variant };
            if (sel === 'meta[name="build-id"]') return { getAttribute: () => '118.test' };
            return null;
        },
    };
}

const ACCOUNT = '#T0';

/** The preview's own origin: the gate says who is signed in, and the API takes what it is sent. */
function server() {
    return vi.fn(async (input: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        const body = (data: unknown) => new Response(JSON.stringify(data), { status: 200 });
        if (input === '/_gate/status') return body({ state: 'active', account_label: ACCOUNT });
        if (input === '/api/diagnostics' && method === 'POST') return body({ ok: true });
        if (input === '/api/sessions' && method === 'POST') return body({ id: 'x', storedBytes: 1 });
        if (input === '/api/sessions') return body({ sessions: [] });
        if (input === '/api/diagnostics') return body({ diagnostics: [] });
        return new Response('not found', { status: 404 });
    });
}

const session = (): SavedSession => ({
    v: 1,
    id: '00000000-0000-4000-8000-000000000001',
    label: '2026-09-24 12:00 MSS54 PRACTICE',
    createdAt: 1,
    updatedAt: 2,
    syncedAt: null,
    appBuild: '118.test',
    ecu: 'mss54',
    mock: true,
    ident: null,
    faults: [],
    datalog: null,
    failures: [],
});

const failure: FailureReport = {
    ecu: 'mss54',
    job: 'Read fault memory',
    error: 'timeout',
    errorKind: 'timeout',
    transport: 'practice',
    mock: true,
    ident: null,
    excerpt: ['1970-01-01T00:00:00.000Z TX    12 04 04 12'],
};

/** Fresh modules, so the acknowledgement held in lib/previewNotice starts unset in every case. */
async function load() {
    vi.resetModules();
    return {
        cloud: await import('./cloud'),
        records: await import('./errorRecords'),
        notice: await import('@/lib/previewNotice'),
    };
}

let fetch: ReturnType<typeof server>;
let idb: ReturnType<typeof memoryIndexedDB>;
let storage: ReturnType<typeof memoryStorage>;

beforeEach(() => {
    fetch = server();
    idb = memoryIndexedDB();
    storage = memoryStorage();
    vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('indexedDB', idb);
    vi.stubGlobal('localStorage', storage);
    // This device confirmed its account before: a record queued now is stamped with it.
    storage.setItem('owner-sync:account', ACCOUNT);
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('the preview, before its notice is acknowledged', () => {
    beforeEach(() => {
        vi.stubGlobal('document', documentOf('preview'));
        // Agreed to the disclaimer long ago — that is not the notice.
        storage.setItem('e46m3.disclaimer', '1');
    });

    it('makes no request at all', async () => {
        const { cloud, records } = await load();
        expect(cloud.canSync()).toBe(false);

        expect((await cloud.sendSession(session())).ok).toBe(false);
        expect((await cloud.listCloudSessions()).ok).toBe(false);
        expect((await cloud.listDiagnostics()).ok).toBe(false);
        expect((await cloud.fetchCloudSession('x')).session).toBeNull();
        expect((await cloud.deleteCloudSession('x')).ok).toBe(false);
        expect((await cloud.deleteDiagnostic('x')).ok).toBe(false);
        // Not even the /_gate/status question a flush starts with.
        expect(await records.flushErrorRecords()).toBe(0);
        expect(await records.waitingErrorRecords()).toBe(0);

        expect(fetch).not.toHaveBeenCalled();
    });

    it('keeps an error record in the outbox, unsent, and sends it with the first flush after AGREE', async () => {
        const { cloud, records, notice } = await load();

        records.reportFailure(failure);
        await vi.waitFor(() => expect(idb.rows('monitoring-outbox')).toHaveLength(1));
        expect(fetch).not.toHaveBeenCalled();
        const [queued] = idb.rows('monitoring-outbox');
        expect(queued.account).toBe(ACCOUNT);

        notice.agreeToFirstRun(true);
        expect(cloud.canSync()).toBe(true);

        expect(await records.flushErrorRecords()).toBe(1);
        expect(fetch.mock.calls.map(([url, init]) => `${init?.method ?? 'GET'} ${url}`)).toEqual([
            'GET /_gate/status',
            'POST /api/diagnostics',
        ]);
        const sent = JSON.parse(String(fetch.mock.calls[1][1]?.body));
        expect(sent.id).toBe((queued.record as { id: string }).id);
        expect(sent.job).toBe('Read fault memory');
        expect(idb.rows('monitoring-outbox')).toHaveLength(0);
    });

    it('after AGREE, SYNC sends and an error record goes at once', async () => {
        const { cloud, records, notice } = await load();
        notice.agreeToFirstRun(true);

        expect((await cloud.sendSession(session())).ok).toBe(true);

        records.reportFailure(failure);
        // Sent, then the outbox flushed behind it — which is where /_gate/status is asked.
        await vi.waitFor(() => expect(fetch.mock.calls.map(([url]) => url)).toContain('/_gate/status'));
        await new Promise((r) => setTimeout(r, 20));
        expect(fetch.mock.calls.map(([url, init]) => `${init?.method ?? 'GET'} ${url}`)).toEqual([
            'POST /api/sessions',
            'POST /api/diagnostics',
            'GET /_gate/status',
        ]);
        expect(idb.rows('monitoring-outbox')).toHaveLength(0);
    });

    it('storage that throws is not an acknowledgement: nothing is sent', async () => {
        const no = () => {
            throw new DOMException('The operation is insecure.', 'SecurityError');
        };
        vi.stubGlobal('localStorage', { getItem: no, setItem: no, removeItem: no });
        const { cloud, records } = await load();
        expect(cloud.canSync()).toBe(false);
        expect((await cloud.sendSession(session())).ok).toBe(false);
        expect(await records.flushErrorRecords()).toBe(0);
        expect(fetch).not.toHaveBeenCalled();
    });
});

describe('production and next dev (no app-variant tag)', () => {
    beforeEach(() => {
        vi.stubGlobal('document', documentOf(null));
        // Even a device that once acknowledged a preview's notice on this origin.
        storage.setItem('preview-notice:v1', '2026-09-24T00:00:00.000Z');
    });

    it('sends nothing and keeps nothing, as before', async () => {
        const { cloud, records } = await load();
        expect(cloud.canSync()).toBe(false);
        expect((await cloud.sendSession(session())).ok).toBe(false);
        expect(await records.flushErrorRecords()).toBe(0);

        records.reportFailure(failure);
        await new Promise((r) => setTimeout(r, 20));

        expect(fetch).not.toHaveBeenCalled();
        expect(idb.opened).toEqual([]);
    });
});

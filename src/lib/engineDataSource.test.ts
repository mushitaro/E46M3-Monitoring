/**
 * functions/_lib/engineData.ts — the module data from M's platform, held in this server's memory
 * (operator, 2026-11-14). A fake platform answers the bundle; nothing real is reached.
 */
import { describe, expect, it } from 'vitest';
import { CHECK_EVERY_MS, engineDataSource } from '../../functions/_lib/engineData';

const KEY = 'k'.repeat(43);
const ENV = { M_ENGINE_DATA_URL: 'https://platform.test/engine/data/', M_MAINSTAY: 'm3', M_ENGINE_DATA_KEY: KEY };
const enc = new TextEncoder();

function bundle(version: string, files: Record<string, string>): Uint8Array<ArrayBuffer> {
    const parts = Object.entries(files).map(([name, text]) => ({ name, bytes: enc.encode(text) }));
    const header = {
        v: 1,
        dataset: 'e46-diagnosis',
        version,
        files: parts.map((p) => ({ name: p.name, sha256: '0'.repeat(64), bytes: p.bytes.length })),
    };
    const head = enc.encode(JSON.stringify(header) + '\n');
    const out = new Uint8Array(head.length + parts.reduce((n, p) => n + p.bytes.length, 0));
    out.set(head, 0);
    let at = head.length;
    for (const p of parts) {
        out.set(p.bytes, at);
        at += p.bytes.length;
    }
    return out;
}

type Answer = { status: number; body?: Uint8Array<ArrayBuffer> | string };

function platform(answers: Answer[]) {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const fetcher = (async (url: string, init?: RequestInit) => {
        calls.push({ url, headers: { ...(init?.headers as Record<string, string>) } });
        const a = answers.shift();
        if (!a) throw new Error('offline');
        return new Response(a.status === 304 ? null : (a.body ?? ''), { status: a.status });
    }) as typeof fetch;
    return { fetcher, calls };
}

const text = (b: Uint8Array) => new TextDecoder().decode(b);
const V1 = bundle('v1', { 'index.json': '{"modules":[1]}', 'mss54.jobs.json': '{"jobs":1}', 'mss54.jobtext.json': '{"texts":1}' });
const V2 = bundle('v2', { 'index.json': '{"modules":[2]}', 'mss54.jobs.json': '{"jobs":2}' });

describe('engineDataSource', () => {
    it('is not configured without the door and a usable key, and then reads nothing', async () => {
        const { fetcher, calls } = platform([]);
        expect(engineDataSource({}, fetcher).configured).toBe(false);
        expect(engineDataSource({ ...ENV, M_ENGINE_DATA_KEY: 'short' }, fetcher).configured).toBe(false);
        expect(engineDataSource({ ...ENV, M_MAINSTAY: '' }, fetcher).configured).toBe(false);
        expect(calls).toHaveLength(0);
    });

    it('fetches the bundle once with a v2 engine-data ticket, and cuts files from memory', async () => {
        const { fetcher, calls } = platform([{ status: 200, body: V1 }]);
        const data = engineDataSource(ENV, fetcher);
        const a = await data.file('index.json', 0);
        const b = await data.file('mss54.jobtext.json', 1);
        expect(a).toMatchObject({ kind: 'file', version: 'v1' });
        expect(a.kind === 'file' && text(a.bytes)).toBe('{"modules":[1]}');
        expect(b.kind === 'file' && text(b.bytes)).toBe('{"texts":1}');
        expect(calls).toHaveLength(1);
        expect(calls[0].url).toBe('https://platform.test/engine/data/_bundle');
        expect(calls[0].headers.authorization).toMatch(/^Bearer v2\./);
        const claims = JSON.parse(atob(calls[0].headers.authorization.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
        expect(claims).toMatchObject({ s: 'm3', a: 'engine-data' });
        expect(calls[0].headers['if-none-match']).toBeUndefined();
    });

    it('asks "changed?" only for index.json, at most once a minute; 304 keeps, 200 replaces', async () => {
        const { fetcher, calls } = platform([{ status: 200, body: V1 }, { status: 304 }, { status: 200, body: V2 }]);
        const data = engineDataSource(ENV, fetcher);
        await data.file('index.json', 0);
        await data.file('index.json', CHECK_EVERY_MS - 1);
        await data.file('mss54.jobs.json', CHECK_EVERY_MS * 5);
        expect(calls).toHaveLength(1);
        await data.file('index.json', CHECK_EVERY_MS);
        expect(calls[1].headers['if-none-match']).toBe('"v1"');
        expect((await data.file('index.json', CHECK_EVERY_MS + 1)).kind === 'file').toBe(true);
        const replaced = await data.file('index.json', CHECK_EVERY_MS * 2);
        expect(replaced).toMatchObject({ kind: 'file', version: 'v2' });
        expect(await data.file('mss54.jobtext.json', CHECK_EVERY_MS * 2)).toEqual({ kind: 'not_found', version: 'v2' });
    });

    it('keeps serving what it holds when the platform cannot be asked', async () => {
        const { fetcher } = platform([{ status: 200, body: V1 }, { status: 503, body: '{"error":"x"}' }]);
        const data = engineDataSource(ENV, fetcher);
        await data.file('index.json', 0);
        expect(await data.file('index.json', CHECK_EVERY_MS)).toMatchObject({ kind: 'file', version: 'v1' });
        expect(await data.file('index.json', CHECK_EVERY_MS * 2)).toMatchObject({ kind: 'file', version: 'v1' }); // offline
    });

    it('with nothing held, says why: the day spent, could not ask, a page that is not a bundle', async () => {
        const limited = platform([{ status: 429, body: '{"error":"temporarily_unavailable","retry_after_s":120}' }]);
        expect(await engineDataSource(ENV, limited.fetcher).file('index.json', 0)).toEqual({ kind: 'failed', failure: { kind: 'limited', retryAfterS: 120 } });
        const auth = platform([{ status: 401, body: '{"error":"auth"}' }]);
        expect(await engineDataSource(ENV, auth.fetcher).file('index.json', 0)).toEqual({ kind: 'failed', failure: { kind: 'auth' } });
        const junk = platform([{ status: 200, body: 'not a bundle' }]);
        expect(await engineDataSource(ENV, junk.fetcher).file('index.json', 0)).toEqual({ kind: 'failed', failure: { kind: 'unavailable' } });
        const offline = platform([]);
        expect(await engineDataSource(ENV, offline.fetcher).file('index.json', 0)).toEqual({ kind: 'failed', failure: { kind: 'unavailable' } });
    });

    it('answers a name outside the data\'s pattern with not_found and asks nobody', async () => {
        const { fetcher, calls } = platform([]);
        const data = engineDataSource(ENV, fetcher);
        for (const name of ['../secrets.json', 'mss54.prg', 'INDEX.JSON', 'a/index.json']) {
            expect((await data.file(name, 0)).kind).toBe('not_found');
        }
        expect(calls).toHaveLength(0);
    });
});

describe('the /ecu-data/<file> route', async () => {
    const { onRequestGet } = await import('../../functions/ecu-data/[[path]]');
    const ctx = (env: Record<string, string>, file: string, headers: Record<string, string> = {}) => ({
        request: new Request(`https://w.test/ecu-data/${file}`, { headers }),
        env,
        params: { path: file.split('/') },
        next: async () => new Response('the build\'s own copy', { status: 200 }),
    });

    it('hands the request to the build\'s own copy until the door is configured', async () => {
        const res = await onRequestGet(ctx({}, 'index.json'));
        expect(await res.text()).toBe('the build\'s own copy');
    });

    it('serves the platform\'s file with its version, 304 for the version held, private and noindex', async () => {
        const real = globalThis.fetch;
        globalThis.fetch = (async () => new Response(V1, { status: 200 })) as typeof fetch;
        try {
            const env = { ...ENV, M_ENGINE_DATA_URL: 'https://route-a.test/engine/data' };
            const res = await onRequestGet(ctx(env, 'mss54.jobtext.json'));
            expect(res.status).toBe(200);
            expect(await res.text()).toBe('{"texts":1}');
            expect(res.headers.get('x-m-dataset-version')).toBe('v1');
            expect(res.headers.get('etag')).toBe('"v1"');
            expect(res.headers.get('cache-control')).toBe('private, no-cache');
            expect(res.headers.get('x-robots-tag')).toContain('noindex');
            expect((await onRequestGet(ctx(env, 'mss54.jobs.json', { 'if-none-match': '"v1"' }))).status).toBe(304);
            expect((await onRequestGet(ctx(env, 'dsc.jobs.json'))).status).toBe(404);
        } finally {
            globalThis.fetch = real;
        }
    });

    it('says 429 with retry_after_s when the platform\'s day is spent, 503 when it cannot be asked', async () => {
        const real = globalThis.fetch;
        try {
            globalThis.fetch = (async () => new Response('{"error":"temporarily_unavailable","retry_after_s":60}', { status: 429 })) as typeof fetch;
            const limited = await onRequestGet(ctx({ ...ENV, M_ENGINE_DATA_URL: 'https://route-b.test/engine/data' }, 'index.json'));
            expect(limited.status).toBe(429);
            expect(await limited.json()).toEqual({ error: 'temporarily_unavailable', retry_after_s: 60 });
            globalThis.fetch = (async () => {
                throw new Error('offline');
            }) as typeof fetch;
            const down = await onRequestGet(ctx({ ...ENV, M_ENGINE_DATA_URL: 'https://route-c.test/engine/data' }, 'index.json'));
            expect(down.status).toBe(503);
        } finally {
            globalThis.fetch = real;
        }
    });
});

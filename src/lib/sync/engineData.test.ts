import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ENGINE_DATA_SCOPE, engineDataFile, forgetEngineDataAnswers, serveEngineData } from '../../../functions/_lib/engineData';
import { onRequest as middleware } from '../../../functions/_middleware';

/**
 * `/api/engine-data/<file>`: the engine's private data for another app's server, on an m3 token for
 * this app with the `monitoring_engine` right (docs/ENGINE.md §4). What it refuses, what it asks m3,
 * and that the owner gate's cookie is skipped for the data's own file names and nothing else.
 */

const TOKEN = 'A'.repeat(43);
const URL_OF = (file: string) => `https://e46m3-monitoring-preview.pages.dev/api/engine-data/${file}`;
const req = (file: string, init: RequestInit = {}) => new Request(URL_OF(file), { headers: { authorization: `Bearer ${TOKEN}` }, ...init });

const assets = {
    fetch: vi.fn(async (r: Request | string) => {
        const path = new URL(typeof r === 'string' ? r : r.url).pathname;
        return path === '/ecu-data/index.json' ? new Response('{"modules":[]}', { status: 200 }) : new Response('nope', { status: 404 });
    }),
};
const env = { M3_CLIENT_SECRET: 'secret', ASSETS: assets };

const m3 = (body: unknown, status = 200) =>
    vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
const holder = () => m3({ active: true, account_id: 'acct-1', scopes: ['owner_preview', ENGINE_DATA_SCOPE] });

beforeEach(() => {
    forgetEngineDataAnswers();
    assets.fetch.mockClear();
});

describe('which paths are the data’s', () => {
    it('the index, the variant rules, and a module’s catalogue and telegram table — nothing else', () => {
        expect(engineDataFile('/api/engine-data/index.json')).toBe('index.json');
        expect(engineDataFile('/api/engine-data/variants.json')).toBe('variants.json');
        expect(engineDataFile('/api/engine-data/mss54.jobs.json')).toBe('mss54.jobs.json');
        expect(engineDataFile('/api/engine-data/kombi46r.telegrams.json')).toBe('kombi46r.telegrams.json');
        for (const p of ['/api/engine-data/', '/api/engine-data/a/b.jobs.json', '/api/engine-data/x.jobtext.json', '/api/engine-data/..%2findex.json', '/ecu-data/index.json', '/api/engine-data/INDEX.JSON']) {
            expect(engineDataFile(p), p).toBeNull();
        }
    });
});

describe('serving a file', () => {
    it('asks m3 with this app’s client, and serves the file to a token whose account holds the right', async () => {
        const f = holder();
        const res = await serveEngineData(req('index.json'), env, { fetch: f });
        expect(res.status).toBe(200);
        expect(await res.text()).toBe('{"modules":[]}');
        expect(res.headers.get('cache-control')).toBe('private, no-store');
        expect(res.headers.get('access-control-allow-origin')).toBeNull();
        const [url, init] = f.mock.calls[0] as [string, RequestInit];
        expect(url).toBe('https://tsunagi-m3.pages.dev/api/access/introspect');
        expect((init.headers as Record<string, string>).authorization).toBe(`Basic ${btoa('monitoring-preview:secret')}`);
        expect(JSON.parse(init.body as string)).toEqual({ token: TOKEN });
    });

    it('refuses without a token, with an inactive one, and without the right — m3 says which', async () => {
        expect((await serveEngineData(new Request(URL_OF('index.json')), env, { fetch: holder() })).status).toBe(401);
        expect((await serveEngineData(req('index.json'), env, { fetch: m3({ active: false }) })).status).toBe(401);
        const owner = await serveEngineData(req('index.json'), env, { fetch: m3({ active: true, account_id: 'acct-1', scopes: ['owner_preview'] }) });
        expect(owner.status).toBe(403);
        expect(assets.fetch).not.toHaveBeenCalled();
    });

    it('fails closed when it cannot ask: no secret, m3 down, an answer it does not understand', async () => {
        expect((await serveEngineData(req('index.json'), { ASSETS: assets }, { fetch: holder() })).status).toBe(503);
        expect((await serveEngineData(req('index.json'), env, { fetch: m3({ error: 'x' }, 503) })).status).toBe(503);
        const down = vi.fn(async () => {
            throw new Error('offline');
        }) as unknown as typeof fetch;
        expect((await serveEngineData(req('index.json'), env, { fetch: down })).status).toBe(503);
        expect((await serveEngineData(req('index.json'), env, { fetch: m3({ nope: true }) })).status).toBe(503);
        expect(assets.fetch).not.toHaveBeenCalled();
    });

    it('keeps a yes for a minute and never a no', async () => {
        let t = 1_000;
        const now = () => t;
        const f = holder();
        await serveEngineData(req('index.json'), env, { fetch: f, now });
        await serveEngineData(req('index.json'), env, { fetch: f, now });
        expect(f).toHaveBeenCalledTimes(1);
        t += 61_000;
        await serveEngineData(req('index.json'), env, { fetch: f, now });
        expect(f).toHaveBeenCalledTimes(2);
        const no = m3({ active: false });
        await serveEngineData(new Request(URL_OF('variants.json'), { headers: { authorization: `Bearer ${'B'.repeat(43)}` } }), env, { fetch: no, now });
        await serveEngineData(new Request(URL_OF('variants.json'), { headers: { authorization: `Bearer ${'B'.repeat(43)}` } }), env, { fetch: no, now });
        expect(no).toHaveBeenCalledTimes(2);
    });

    it('serves only reads, and says not found for a file the deployment does not hold', async () => {
        expect((await serveEngineData(req('index.json', { method: 'POST' }), env, { fetch: holder() })).status).toBe(405);
        expect((await serveEngineData(req('nothere.jobs.json'), env, { fetch: holder() })).status).toBe(404);
        const head = await serveEngineData(req('index.json', { method: 'HEAD' }), env, { fetch: holder() });
        expect(head.status).toBe(200);
        expect(await head.text()).toBe('');
    });
});

describe('the owner gate around it', () => {
    const context = (path: string) => {
        const next = vi.fn(async () => new Response('route', { status: 200 }));
        return { next, ctx: { request: new Request(`https://e46m3-monitoring-preview.pages.dev${path}`), env: {}, next, data: {} } };
    };

    it('lets the data’s own file names past the cookie, to the route that checks the token', async () => {
        const { ctx, next } = context('/api/engine-data/index.json');
        expect(await (await middleware(ctx)).text()).toBe('route');
        expect(next).toHaveBeenCalledTimes(1);
    });

    it('keeps every other path behind the gate, under the same prefix too', async () => {
        for (const path of ['/api/engine-data/a/b.json', '/api/engine-data/x.txt', '/ecu-data/index.json']) {
            const { ctx, next } = context(path);
            const res = await middleware(ctx);
            expect(next, path).not.toHaveBeenCalled();
            expect(res.status, path).not.toBe(200);
        }
    });
});

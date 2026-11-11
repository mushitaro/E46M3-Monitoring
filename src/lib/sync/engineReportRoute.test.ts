import { afterEach, describe, expect, it, vi } from 'vitest';
import { sqliteD1 } from '../testing/sqliteD1';
import { deskProblem, standingMandates } from '../investigation/share';
import { recordEntries } from '../../../functions/_lib/investigation';
import { secretNameOf } from '../../../functions/_lib/engineReportTicket';
import * as route from '../../../functions/api/bridge/engine-report';
import type { NotebookEntry } from '../notebook/rules';

/**
 * A Mainstay's door to the desk (functions/api/bridge/engine-report.ts). The ticket is signed here
 * exactly as GREN BLUE signs it (tsunagi_gren-blue packages/api-kit/src/engineReport/ticket.ts), so a
 * change to either side's format fails this file.
 */

const STORE = 'gren-blue-auto';
const SECRET = 's'.repeat(48);
const VIN = 'WBABN12345JX00001';
const FP = 'ab'.repeat(16);
const enc = new TextEncoder();
const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function ticket(body: string, claims: Record<string, unknown> = {}, secret = SECRET) {
    const h = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(body))));
    const n = b64url(crypto.getRandomValues(new Uint8Array(18)));
    const payload = b64url(enc.encode(JSON.stringify({ s: STORE, a: 'engine-report', e: Math.floor(Date.now() / 1000) + 60, n, h, ...claims })));
    const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(`v1.${payload}`)));
    return `v1.${payload}.${b64url(sig)}`;
}

function delivery(over: Record<string, unknown> = {}, report: Record<string, unknown> = {}) {
    const total = (over.total as number) ?? 1;
    const fingerprint = (over.fingerprint as string) ?? FP;
    return {
        v: 1,
        mainstay: STORE,
        entrance: 'gren-blue-suite',
        delivery: `${fingerprint}.${total}`,
        fingerprint,
        report: {
            kind: 'exception',
            engine: { name: 'e46m3-monitoring-engine', version: '0.4.2' },
            module: { address: 0x12, variant: 'MSS54' },
            job: 'FS_LESEN',
            error: { name: 'RangeError', message: 'no text for fault 0x2A', stack: ['decodeFault@engine.js:1'] },
            ...report,
        },
        count: 1,
        total,
        firstSeen: '2026-11-11T01:00:00.000Z',
        lastSeen: '2026-11-11T01:00:00.000Z',
        ...over,
    };
}

function setup(env: Record<string, unknown> = {}) {
    const { d1 } = sqliteD1();
    const base = { RUNS_DB: d1, ENGINE_REPORT_MAINSTAYS: `${STORE}, other-store`, [secretNameOf(STORE)]: SECRET, ...env };
    const post = async (body: unknown, auth?: string | null) => {
        const raw = typeof body === 'string' ? body : JSON.stringify(body);
        const bearer = auth === undefined ? await ticket(raw) : auth;
        const res = await route.onRequestPost({
            request: new Request('https://e46m3-monitoring-preview.pages.dev/api/bridge/engine-report', {
                method: 'POST',
                headers: { 'content-type': 'application/json', ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
                body: raw,
            }),
            env: base as never,
        });
        return { status: res.status, body: (await res.json()) as Record<string, unknown> };
    };
    return { d1, post };
}

afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

describe('the store ticket', () => {
    it('lets in only a signed, fresh, unused ticket for engine-report, for this body, from a store on the roster', async () => {
        const { post } = setup();
        const body = JSON.stringify(delivery());
        expect((await post(body, null)).status).toBe(401);
        expect((await post(body, await ticket(body, {}, 'x'.repeat(48)))).body).toEqual({ error: 'auth' });
        expect((await post(body, await ticket(body, { a: 'monitoring-dev' }))).status).toBe(401);
        expect((await post(body, await ticket(body, { e: Math.floor(Date.now() / 1000) - 1 }))).status).toBe(401);
        expect((await post(body, await ticket(body, { e: Math.floor(Date.now() / 1000) + 600 }))).status).toBe(401);
        expect((await post(body, await ticket('{"another":"body"}'))).status).toBe(401);
        expect((await post(body, await ticket(body, { s: 'stranger' }))).status).toBe(401);
        // On the roster but no key set yet: refused like a stranger.
        expect((await post(body, await ticket(body, { s: 'other-store' }))).status).toBe(401);
        const once = await ticket(body);
        expect((await post(body, once)).status).toBe(200);
        expect((await post(body, once)).body).toEqual({ error: 'auth' });
    });

    it('says the door is shut when no store is on the roster', async () => {
        expect((await setup({ ENGINE_REPORT_MAINSTAYS: ' ' }).post(delivery())).body).toEqual({ error: 'engine_report_unavailable' });
    });
});

describe('POST /api/bridge/engine-report', () => {
    it('puts a new error to the desk, naming the store and the entrance, under a mandate that reads nothing from any car', async () => {
        const { d1, post } = setup();
        const r = await post(delivery());
        expect(r.status).toBe(200);
        const record = await route.engineRecordOf(STORE);
        expect(record).toMatch(/^eng-[0-9a-f]{16}$/);
        expect(r.body).toMatchObject({ received: true, record, asked: expect.stringMatching(/^eng-ask-/), duplicate: false });

        const entries = await recordEntries(d1, `mainstay:${STORE}`, record);
        const [m, ask] = entries;
        expect(m).toMatchObject({ by: 'owner', body: { kind: 'mandate', modules: ['none'] } });
        expect((m.body as { words: string }).words).toContain('2026-11-11');
        expect(ask).toMatchObject({ id: r.body.asked, by: 'chat', body: { kind: 'ask', to: 'desk' } });
        const text = (ask.body as { text: string }).text;
        expect(text).toContain('[エンジンの報告] gren-blue-auto · gren-blue-suite');
        expect(text).toContain(FP);
        expect(text).toContain('モジュール: 0x12 MSS54');
        expect(text).toContain('例外: RangeError: no text for fault 0x2A');

        const now = Date.now();
        expect(standingMandates(entries, now)).toHaveLength(1);
        const answer: NotebookEntry = { id: 'answer-000001', sessionId: record, at: now + 10, by: 'desk', body: { kind: 'answer', re: ask.id, text: '#50 で直しました' } };
        expect(deskProblem(answer, entries)).toBeNull();
        const plan: NotebookEntry = {
            id: 'plan-00000001',
            sessionId: record,
            at: now + 10,
            by: 'desk',
            body: { kind: 'plan', v: 1, mandate: m.id, purpose: 'read', steps: [{ n: 1, do: 'faults', kind: 'faults', module: 'mss54', when: 'parked' }] },
        };
        expect(deskProblem(plan, entries)).toMatch(/outside/);
    });

    it('refuses a body with anything it does not know, and never stores Japanese text, a VIN or an identification answer', async () => {
        const { d1, post } = setup();
        expect((await post(delivery({ vin: VIN }))).body).toMatchObject({ error: 'report', field: 'keys' });
        expect((await post(delivery({}, { cost: 45000 }))).body).toMatchObject({ field: 'report.keys' });
        expect((await post(delivery({}, { error: { name: 'Error', message: '田中様の車' } }))).body).toMatchObject({ field: 'report.error.message' });
        expect((await post(delivery({ mainstay: 'other-store' }))).body).toMatchObject({ field: 'mainstay' });
        expect((await post(delivery({ delivery: `${FP}.9` }))).body).toMatchObject({ field: 'delivery' });

        // Past the store's redaction anyway: this side's own catches it before anything is stored.
        const leaked = await post(delivery({ fingerprint: 'cd'.repeat(16) }, { error: { name: 'Error', message: `bad ${VIN} / JX00001` } }));
        expect(leaked.status).toBe(200);
        const ident = await post(delivery({ fingerprint: 'ef'.repeat(16) }, { kind: 'unknown_answer', job: 'IDENT', request: '12040016', response: 'a01f00' + '57424142'.repeat(4), error: undefined }));
        expect(ident.status).toBe(200);
        const rows = d1.prepare('SELECT report FROM monitoring_engine_reports');
        const all = JSON.stringify((await rows.all<{ report: string }>()).results) + JSON.stringify(await recordEntries(d1, `mainstay:${STORE}`, await route.engineRecordOf(STORE)));
        expect(all).not.toContain(VIN);
        expect(all).not.toContain('JX00001');
        expect(all).not.toContain('57424142');
        expect(all).toContain('[VIN]');
    });

    it('counts repeats without asking again, ignores a retried delivery, and asks again after a week', async () => {
        const fire = vi.fn(async () => new Response('{}', { status: 200 }));
        vi.stubGlobal('fetch', fire);
        const { d1, post } = setup({ LOOP_TRIGGER_ID: 'trig_test', LOOP_FIRE_TOKEN: 'tok' });
        const owner = `mainstay:${STORE}`;
        const record = await route.engineRecordOf(STORE);
        const asks = async () => (await recordEntries(d1, owner, record)).filter((e) => e.body.kind === 'ask');

        expect((await post(delivery())).body.asked).toBeTruthy();
        expect(fire).toHaveBeenCalledTimes(1);

        const again = delivery({ total: 4, count: 3 });
        expect((await post(again)).body).toMatchObject({ asked: null, duplicate: false });
        expect((await post(again)).body).toMatchObject({ duplicate: true });
        expect(await asks()).toHaveLength(1);
        expect(fire).toHaveBeenCalledTimes(1);
        const row = await d1.prepare('SELECT total FROM monitoring_engine_reports').first<{ total: number }>();
        expect(row?.total).toBe(4);

        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(Date.now() + route.ASK_AGAIN_MS + 60_000);
        const week = await post(delivery({ total: 9, count: 5 }));
        expect(week.body.asked).toBeTruthy();
        const all = await asks();
        expect(all).toHaveLength(2);
        expect((all[1].body as { text: string }).text).toContain('（続いている）');
        expect((all[1].body as { text: string }).text).toContain('今回 5・累計 9');
    });
});

describe('the middleware', () => {
    it('lets the engine-report path past the gate, and nothing beside it', async () => {
        const { onRequest } = await import('../../../functions/_middleware');
        const mark = new Response('route', { status: 299 });
        const at = (path: string) => onRequest({ request: new Request(`https://e46m3-monitoring-preview.pages.dev${path}`), env: {} as never, data: {}, next: async () => mark });
        expect((await at('/api/bridge/engine-report')).status).toBe(299);
        for (const p of ['/api/bridge/engine-reports', '/api/bridge/engine-report/x', '/api/notebook', '/ecu-data/mss54.json']) expect((await at(p)).status).not.toBe(299);
    });
});

describe('GET /api/bridge/engine-data/<file>', () => {
    const served: string[] = [];
    const ASSETS = {
        fetch: async (req: Request) => {
            const path = new URL(req.url).pathname;
            served.push(path);
            return path === '/ecu-data/index.json' ? new Response('{"schema":1}', { status: 200 }) : new Response('nope', { status: 404 });
        },
    };
    async function get(file: string, bearer: string | null, env: Record<string, unknown> = {}) {
        const { d1 } = sqliteD1();
        const { onRequestGet } = await import('../../../functions/api/bridge/engine-data/[file]');
        const res = await onRequestGet({
            request: new Request(`https://e46m3-monitoring-preview.pages.dev/api/bridge/engine-data/${file}`, { headers: bearer ? { authorization: `Bearer ${bearer}` } : {} }),
            env: { RUNS_DB: d1, ENGINE_REPORT_MAINSTAYS: STORE, [secretNameOf(STORE)]: SECRET, ASSETS, ...env } as never,
            params: { file },
        });
        return { status: res.status, text: await res.text(), cache: res.headers.get('cache-control') };
    }

    it('serves a file the engine reads, to a store ticket for exactly that file name, without caching', async () => {
        const ok = await get('index.json', await ticket('index.json', { a: 'engine-data' }));
        expect(ok).toEqual({ status: 200, text: '{"schema":1}', cache: 'private, no-store' });
        expect(served).toContain('/ecu-data/index.json');
    });

    it('refuses a ticket for another file, for the other use, from no one, and a name the engine does not read', async () => {
        expect((await get('index.json', await ticket('variants.json', { a: 'engine-data' }))).status).toBe(401);
        expect((await get('index.json', await ticket('index.json'))).status).toBe(401); // audience engine-report
        expect((await get('index.json', null)).status).toBe(401);
        expect((await get('mss54.prg', await ticket('mss54.prg', { a: 'engine-data' }))).status).toBe(404);
        expect((await get('mss54.jobs.json', await ticket('mss54.jobs.json', { a: 'engine-data' }))).status).toBe(404); // not in ASSETS here
    });

    it('is the only data path past the gate: /ecu-data/ itself stays behind it', async () => {
        const { onRequest, ENGINE_DATA_PATH } = await import('../../../functions/_middleware');
        const mark = new Response('route', { status: 299 });
        const at = (path: string) => onRequest({ request: new Request(`https://e46m3-monitoring-preview.pages.dev${path}`), env: {} as never, data: {}, next: async () => mark });
        expect((await at('/api/bridge/engine-data/mss54.telegrams.json')).status).toBe(299);
        expect((await at('/api/bridge/engine-data/index.json')).status).toBe(299);
        for (const p of ['/ecu-data/index.json', '/api/bridge/engine-data/', '/api/bridge/engine-data/../ecu-data/index.json', '/api/bridge/engine-data/x.prg']) {
            expect((await at(p)).status).not.toBe(299);
        }
        expect(ENGINE_DATA_PATH.test('/api/bridge/engine-data/variants.json')).toBe(true);
    });
});

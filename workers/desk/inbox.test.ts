import { afterEach, describe, expect, it, vi } from 'vitest';
import { sqliteD1 } from '../../src/lib/testing/sqliteD1';
import { deskProblem, standingMandates } from '../../src/lib/investigation/share';
import { recordEntries } from '../../functions/_lib/investigation';
import { ticketBinding } from './src/platformTicket';
import * as inbox from './src/inbox';
import { handle } from './src/index';
import type { NotebookEntry } from '../../src/lib/notebook/rules';

/**
 * The desk's inbox for the Mainstays' engine reports (workers/desk/src/inbox.ts): what M's platform
 * hands over after its engine door took a report in. Ported from the engine gateway's tests
 * (workers/engine-gateway, removed): the gateway's own door — a store's ticket, the engine's data —
 * moved to the platform and is tested there (tsunagi-m-platform services/engine); what stayed here
 * is what a report becomes.
 *
 * The ticket is signed here exactly as the platform signs it (tsunagi-m-platform
 * services/door-kit/src/ticket.ts `mintPlatformTicket`), so a change to either side's format fails
 * this file.
 */

const STORE = 'gren-blue-auto';
const KEY = 'k'.repeat(48);
const VIN = 'WBABN12345JX00001';
const FP = 'ab'.repeat(16);
const HOST = 'https://monitoring-desk.pages.dev';
const enc = new TextEncoder();
const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function ticket(body: string, claims: Record<string, unknown> = {}, key = KEY, version = 'v2', path = inbox.INBOX_PATH) {
    const h = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(ticketBinding('POST', path, body)))));
    const n = b64url(crypto.getRandomValues(new Uint8Array(12)));
    const payload = b64url(enc.encode(JSON.stringify({ s: 'm', a: 'desk-deliver', e: Math.floor(Date.now() / 1000) + 60, n, h, ...claims })));
    const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(`${version}.${payload}`)));
    return `${version}.${payload}.${b64url(sig)}`;
}

/** A delivery as the platform's door sends it (the platform contract's `engineReportDelivery`). */
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
    const base = { RUNS_DB: d1, DESK_DELIVER_KEY: KEY, ...env };
    const post = async (body: unknown, auth?: string | null, path = inbox.INBOX_PATH) => {
        const raw = typeof body === 'string' ? body : JSON.stringify(body);
        const bearer = auth === undefined ? await ticket(raw) : auth;
        const res = await handle(
            new Request(`${HOST}${path}`, {
                method: 'POST',
                headers: { 'content-type': 'application/json', ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
                body: raw,
            }),
            base as never,
        );
        return { status: res.status, body: (await res.json()) as Record<string, unknown> };
    };
    return { d1, post };
}

afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

describe('the platform’s ticket', () => {
    it('lets in only a signed, fresh, unused desk-deliver ticket of the platform, for this exact request', async () => {
        const { post } = setup();
        const body = JSON.stringify(delivery());
        expect((await post(body, null)).status).toBe(401);
        expect((await post(body, await ticket(body, {}, 'x'.repeat(48)))).body).toEqual({ error: 'auth' });
        expect((await post(body, await ticket(body, { a: 'engine-report' }))).status).toBe(401);
        expect((await post(body, await ticket(body, { a: 'operator' }))).status).toBe(401);
        // A Mainstay's ticket is the engine door's business: a store cannot reach the desk directly.
        expect((await post(body, await ticket(body, { s: STORE }))).status).toBe(401);
        expect((await post(body, await ticket(body, { s: STORE, a: 'engine-report' }))).status).toBe(401);
        expect((await post(body, await ticket(body, { e: Math.floor(Date.now() / 1000) - 1 }))).status).toBe(401);
        expect((await post(body, await ticket(body, { e: Math.floor(Date.now() / 1000) + 600 }))).status).toBe(401);
        expect((await post(body, await ticket('{"another":"body"}'))).status).toBe(401);
        expect((await post(body, await ticket(body, {}, KEY, 'v2', '/inbox/other'))).status).toBe(401);
        expect((await post(body, await ticket(body, {}, KEY, 'v1'))).status).toBe(401);
        expect((await post(body, await ticket(body, { k: 'cred_0123456789abcdef' }))).status).toBe(401);
        const once = await ticket(body);
        expect((await post(body, once)).status).toBe(200);
        expect((await post(body, once)).body).toEqual({ error: 'auth' });
    });

    it('answers 503 until the key is set, and a desk token opens nothing here', async () => {
        const body = JSON.stringify(delivery());
        expect((await setup({ DESK_DELIVER_KEY: undefined }).post(body)).body).toEqual({ error: 'unconfigured' });
        expect((await setup({ DESK_DELIVER_KEY: 'short' }).post(body)).status).toBe(503);
        expect((await setup().post(body, 'desk_' + 'a'.repeat(40))).status).toBe(401);
    });

    it('is one route and one method; the rest of the desk still asks for its own token', async () => {
        const { d1 } = setup();
        const env = { RUNS_DB: d1, DESK_DELIVER_KEY: KEY } as never;
        expect((await handle(new Request(`${HOST}${inbox.INBOX_PATH}`), env)).status).toBe(405);
        const body = JSON.stringify(delivery());
        for (const path of ['/inbox', '/inbox/engine-report/x', '/engine-report', '/engine-data/index.json', '/investigations']) {
            const res = await handle(new Request(`${HOST}${path}`, { method: 'POST', headers: { authorization: `Bearer ${await ticket(body, {}, KEY, 'v2', path)}` }, body }), env);
            expect(res.status, path).toBe(401);
        }
    });
});

describe('POST /inbox/engine-report', () => {
    it('puts a new error to the desk, naming the store and the entrance, under a mandate that reads nothing from any car', async () => {
        const { d1, post } = setup();
        const r = await post(delivery());
        expect(r.status).toBe(200);
        const record = await inbox.engineRecordOf(STORE);
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
        expect((await post(delivery({ mainstay: 'Not A Slug' }))).body).toMatchObject({ field: 'mainstay' });
        expect((await post(delivery({ delivery: `${FP}.9` }))).body).toMatchObject({ field: 'delivery' });
        expect((await post('not json')).body).toEqual({ error: 'body' });

        // Past the store's redaction and the door's anyway: this side's own catches it before anything is stored.
        const leaked = await post(delivery({ fingerprint: 'cd'.repeat(16) }, { error: { name: 'Error', message: `bad ${VIN} / JX00001` } }));
        expect(leaked.status).toBe(200);
        const ident = await post(delivery({ fingerprint: 'ef'.repeat(16) }, { kind: 'unknown_answer', job: 'IDENT', request: '12040016', response: 'a01f00' + '57424142'.repeat(4), error: undefined }));
        expect(ident.status).toBe(200);
        // And what the door has already redacted passes as it is: `[VIN]` in a message, `VIN` in a name, `2a` bytes.
        const redacted = await post(delivery({ fingerprint: '01'.repeat(16) }, { job: 'READ_VIN', response: 'a0' + '2a'.repeat(17), error: { name: 'Error', message: 'car [VIN]' } }));
        expect(redacted.status).toBe(200);
        const rows = d1.prepare('SELECT report FROM monitoring_engine_reports');
        const all = JSON.stringify((await rows.all<{ report: string }>()).results) + JSON.stringify(await recordEntries(d1, `mainstay:${STORE}`, await inbox.engineRecordOf(STORE)));
        expect(all).not.toContain(VIN);
        expect(all).not.toContain('JX00001');
        expect(all).not.toContain('57424142');
        expect(all).toContain('[VIN]');
    });

    it('counts repeats without asking again, ignores a delivery sent twice, and asks again after a week', async () => {
        const fire = vi.fn(async () => new Response('{}', { status: 200 }));
        vi.stubGlobal('fetch', fire);
        const { d1, post } = setup({ LOOP_TRIGGER_ID: 'trig_test', LOOP_FIRE_TOKEN: 'tok' });
        const owner = `mainstay:${STORE}`;
        const record = await inbox.engineRecordOf(STORE);
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
        vi.setSystemTime(Date.now() + inbox.ASK_AGAIN_MS + 60_000);
        const week = await post(delivery({ total: 9, count: 5 }));
        expect(week.body.asked).toBeTruthy();
        const all = await asks();
        expect(all).toHaveLength(2);
        expect((all[1].body as { text: string }).text).toContain('（続いている）');
        expect((all[1].body as { text: string }).text).toContain('今回 5・累計 9');
    });

    it('counts a store’s entrances apart, and asks the desk once for the same error from both', async () => {
        const { d1, post } = setup();
        const suite = await post(delivery());
        const demo = await post(delivery({ entrance: 'gren-blue-suite-demo' }));
        // The same fingerprint and the same total from another entrance is another row, not a duplicate…
        expect(demo.body).toMatchObject({ received: true, duplicate: false, asked: null });
        expect(suite.body.asked).toBeTruthy();
        const rows = (await d1.prepare('SELECT entrance, total FROM monitoring_engine_reports ORDER BY entrance').all<{ entrance: string; total: number }>()).results;
        expect(rows).toEqual([{ entrance: 'gren-blue-suite', total: 1 }, { entrance: 'gren-blue-suite-demo', total: 1 }]);
        // …and the desk has one question for it, not two.
        const entries = await recordEntries(d1, `mainstay:${STORE}`, await inbox.engineRecordOf(STORE));
        expect(entries.filter((e) => e.body.kind === 'ask')).toHaveLength(1);
        // Another store has a record of its own.
        const other = await post(delivery({ mainstay: 'other-store' }));
        expect(other.body.record).not.toBe(suite.body.record);
        expect(other.body.asked).toBeTruthy();
    });
});

describe('the WORKS build', () => {
    it('serves none of the Mainstay doors: they are the platform’s, deployed apart', async () => {
        const { onRequest } = await import('../../functions/_middleware');
        const mark = new Response('route', { status: 299 });
        const at = (path: string) => onRequest({ request: new Request(`https://e46m3-monitoring-preview.pages.dev${path}`), env: {} as never, data: {}, next: async () => mark });
        for (const p of ['/api/bridge/engine-report', '/api/bridge/engine-data/index.json', '/engine/report', '/engine/data/index.json', '/inbox/engine-report', '/ecu-data/index.json']) {
            expect((await at(p)).status, p).not.toBe(299);
        }
    });
});

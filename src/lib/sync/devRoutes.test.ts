import { describe, expect, it } from 'vitest';
import { sqliteD1 } from '../testing/sqliteD1';
import { deskProblem, standingMandates } from '../investigation/share';
import { recordEntries } from '../../../functions/_lib/investigation';
import { devRecordOf } from '../../../functions/_lib/devTicket';
import * as devRequest from '../../../functions/api/bridge/dev-request';
import * as devStatus from '../../../functions/api/bridge/dev-status';
import type { NotebookEntry } from '../notebook/rules';

/**
 * The relay's door to the development desk (functions/api/bridge/dev-*): the ticket is signed here
 * exactly as matrix-tsunagi/bridge signs it, so a change to either side's format fails this file.
 */

const SECRET = 'x'.repeat(40);
const ME = 'acct-00000001';
const OTHER = 'acct-00000002';
const enc = new TextEncoder();
const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function ticket(claims: Record<string, unknown>, secret = SECRET) {
    const payload = b64url(enc.encode(JSON.stringify(claims)));
    const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(`v1.${payload}`)));
    return `v1.${payload}.${b64url(sig)}`;
}
let nonce = 0;
const fresh = (o = ME, extra: Record<string, unknown> = {}) => ticket({ o, a: 'monitoring-dev', e: Math.floor(Date.now() / 1000) + 60, n: `nonce-${String(++nonce).padStart(6, '0')}`, ...extra });

function setup(env: Record<string, unknown> = {}) {
    const { d1 } = sqliteD1();
    const base = { RUNS_DB: d1, RELAY_DEV_SECRET: SECRET, DEV_REQUEST_OWNERS: `${ME}, acct-99999999`, ...env };
    const post = async (bearer: string | null, body: unknown) => {
        const res = await devRequest.onRequestPost({
            request: new Request('https://e46m3-monitoring-preview.pages.dev/api/bridge/dev-request', {
                method: 'POST',
                headers: { 'content-type': 'application/json', ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
                body: JSON.stringify(body),
            }),
            env: base as never,
        });
        return { status: res.status, body: (await res.json()) as Record<string, unknown> };
    };
    const get = async (bearer: string, q = '') => {
        const res = await devStatus.onRequestGet({
            request: new Request(`https://e46m3-monitoring-preview.pages.dev/api/bridge/dev-status${q}`, { headers: { authorization: `Bearer ${bearer}` } }),
            env: base as never,
        });
        return { status: res.status, body: (await res.json()) as { record: string; items: Record<string, unknown>[] } };
    };
    return { d1, post, get };
}

describe('the ticket', () => {
    it('lets in only a signed, fresh, unused ticket for monitoring-dev from an allowed account', async () => {
        const { post } = setup();
        const words = { words: 'ヘッダの AI ボタンが消えた' };
        expect((await post(null, words)).status).toBe(401);
        expect((await post(await ticket({ o: ME, a: 'monitoring-dev', e: Date.now() / 1000 + 60, n: 'nonce-a00001' }, 'y'.repeat(40)), words)).body).toEqual({ error: 'auth' });
        expect((await post(await fresh(ME, { a: 'monitoring' }), words)).status).toBe(401);
        expect((await post(await fresh(ME, { e: Math.floor(Date.now() / 1000) - 1 }), words)).status).toBe(401);
        expect((await post(await fresh(OTHER), words)).body).toEqual({ error: 'not_allowed' });
        const once = await fresh();
        expect((await post(once, words)).status).toBe(200);
        expect((await post(once, words)).body).toEqual({ error: 'auth' });
    });

    it('says the door is shut when the secret or the list is not set', async () => {
        expect((await setup({ RELAY_DEV_SECRET: undefined }).post(await fresh(), { words: 'x' })).body).toEqual({ error: 'dev_unavailable' });
        expect((await setup({ DEV_REQUEST_OWNERS: ' ' }).post(await fresh(), { words: 'x' })).status).toBe(503);
    });
});

describe('POST /api/bridge/dev-request', () => {
    it('writes the words as an ask to the desk, under a mandate that reads nothing from the car', async () => {
        const { d1, post } = setup();
        const r = await post(await fresh(), { words: '  DSC MK60 が読めない  ', context: 'DIAGNOSIS で READ、21:04、停車中' });
        expect(r.status).toBe(200);
        const record = await devRecordOf(ME);
        expect(r.body).toMatchObject({ record, entry: expect.stringMatching(/^dev-ask-/), at: expect.any(String), say: expect.stringContaining('開発に送りました') });
        expect(record).toMatch(/^dev-[0-9a-f]{16}$/);

        const entries = await recordEntries(d1, ME, record);
        const [m, ask] = entries;
        expect(m).toMatchObject({ by: 'owner', body: { kind: 'mandate', words: 'DSC MK60 が読めない', modules: ['none'] } });
        expect(ask).toMatchObject({ id: r.body.entry, by: 'chat', body: { kind: 'ask', to: 'desk', text: 'DSC MK60 が読めない\n\n（補足）DIAGNOSIS で READ、21:04、停車中' } });

        // The desk sees the record and may answer it; it may not plan a read under this mandate.
        const now = Date.now();
        expect(standingMandates(entries, now)).toHaveLength(1);
        const answer: NotebookEntry = { id: 'answer-000001', sessionId: record, at: now + 10, by: 'desk', body: { kind: 'answer', re: ask.id, text: '#42 で直しました' } };
        expect(deskProblem(answer, entries)).toBeNull();
        const plan: NotebookEntry = {
            id: 'plan-00000001',
            sessionId: record,
            at: now + 10,
            by: 'desk',
            body: { kind: 'plan', v: 1, mandate: m.id, purpose: 'read', steps: [{ n: 1, do: 'faults', kind: 'faults', module: 'mss54', when: 'parked' }] },
        };
        expect(deskProblem(plan, entries)).toMatch(/outside/);

        // A second request goes into the same record, under the same mandate.
        await post(await fresh(), { words: '二件目' });
        const after = await recordEntries(d1, ME, record);
        expect(after.filter((e) => e.body.kind === 'mandate')).toHaveLength(1);
        expect(after.filter((e) => e.body.kind === 'ask')).toHaveLength(2);
    });

    it('refuses empty or long words and a long context, and keeps every word when the two do not fit together', async () => {
        const { d1, post } = setup();
        expect((await post(await fresh(), { words: '   ' })).body).toEqual({ error: 'words' });
        expect((await post(await fresh(), { words: 'a'.repeat(2001) })).body).toEqual({ error: 'words' });
        expect((await post(await fresh(), { words: 'a', context: 'c'.repeat(2001) })).body).toEqual({ error: 'context' });
        const r = await post(await fresh(), { words: 'w'.repeat(1500), context: 'c'.repeat(1500) });
        expect(r.status).toBe(200);
        const ask = (await recordEntries(d1, ME, await devRecordOf(ME))).find((e) => e.id === r.body.entry)!;
        const text = (ask.body as { text: string }).text;
        expect(text.startsWith('w'.repeat(1500))).toBe(true);
        expect(text.length).toBeLessThanOrEqual(2000);
        expect(text.endsWith('…（以下略）')).toBe(true);
    });
});

describe('GET /api/bridge/dev-status', () => {
    it('answers with the requests and the desk’s replies, newest first, for this owner only', async () => {
        const { d1, post, get } = setup({ DEV_REQUEST_OWNERS: `${ME},${OTHER}` });
        expect((await get(await fresh())).body).toEqual({ record: await devRecordOf(ME), items: [] });

        const a = await post(await fresh(), { words: '一件目' });
        await post(await fresh(OTHER), { words: '別の人' });
        const record = await devRecordOf(ME);
        const answer: NotebookEntry = { id: 'answer-000001', sessionId: record, at: Date.now() + 1000, by: 'desk', body: { kind: 'answer', re: a.body.entry as string, text: '直しました' } };
        await d1
            .prepare('INSERT INTO monitoring_notebook (id, owner, record, at, by, kind, entry, synced_at) VALUES (?,?,?,?,?,?,?,?)')
            .bind(answer.id, ME, record, answer.at, 'desk', 'answer', JSON.stringify(answer), Date.now())
            .run();

        const r = await get(await fresh(), '?limit=99');
        expect(r.body.items.map((i) => [i.by, i.kind, i.text, i.re])).toEqual([
            ['desk', 'answer', '直しました', a.body.entry],
            ['chat', 'ask', '一件目', undefined],
        ]);
        expect((await get(await fresh(), '?limit=1')).body.items).toHaveLength(1);
    });
});

describe('the middleware', () => {
    it('lets the two dev paths past the gate, and nothing beside them', async () => {
        const { onRequest } = await import('../../../functions/_middleware');
        const mark = new Response('route', { status: 299 });
        const at = (path: string) => onRequest({ request: new Request(`https://e46m3-monitoring-preview.pages.dev${path}`), env: {} as never, data: {}, next: async () => mark });
        expect((await at('/api/bridge/dev-request')).status).toBe(299);
        expect((await at('/api/bridge/dev-status?limit=3')).status).toBe(299);
        for (const p of ['/api/bridge/dev-requests', '/api/bridge/dev-status/x', '/api/notebook', '/ecu-data/mss54.json']) expect((await at(p)).status).not.toBe(299);
    });
});

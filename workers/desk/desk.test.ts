import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { NotebookEntry } from '../../src/lib/notebook/rules';
import { sqliteD1 } from '../../src/lib/testing/sqliteD1';
import { handle, sha256Hex } from './src/index';

/**
 * The desk Worker against the real schema: who it answers, what of an owner's records it shows,
 * that the VIN and the owner never leave it, what it writes, and that every call is on record.
 */

const NOW = 1_800_000_000_000;
const D = 86_400_000;
const TOKEN = 'desk_' + 'a'.repeat(40);
const OWNER = 'acct-00000001';
const REC = 'rec-00000001';
const VIN = 'TESTV93061JR12345';
const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join(' ');

const entry = (id: string, at: number, by: NotebookEntry['by'], body: NotebookEntry['body'], sessionId = REC): NotebookEntry => ({ id, sessionId, at, by, body });
const mandate = entry('mandate-000001', NOW - D, 'driver', { kind: 'mandate', words: `DSC が早い。車台番号 ${VIN}`, modules: ['dsc_e46'], until: NOW + 6 * D });
const STEPS = [{ n: 1, do: 'DSC faults', kind: 'faults' as const, module: 'dsc_e46', when: 'parked' as const }];
const plan = entry('plan-00000001', NOW - D + 1000, 'chat', { kind: 'plan', v: 1, mandate: mandate.id, purpose: 'DSC early', steps: STEPS });

async function world() {
    const { d1, db } = sqliteD1();
    db.prepare('INSERT INTO monitoring_desk_tokens (id, hash, label, created_at, expires_at, revoked_at) VALUES (?,?,?,?,?,?)').run('tok-loop', await sha256Hex(TOKEN), 'loop', NOW - D, NOW + 30 * D, null);
    const put = (e: NotebookEntry, owner = OWNER) =>
        db.prepare('INSERT INTO monitoring_notebook (id, owner, record, at, by, kind, entry, synced_at) VALUES (?,?,?,?,?,?,?,?)').run(e.id, owner, e.sessionId, e.at, e.by, e.body.kind, JSON.stringify(e), NOW);
    const read = (id: string, at: number, module: string, job: string, response: string) =>
        db.prepare('INSERT INTO monitoring_reads (id, owner, at, synced_at, module, job, request, response, outcome, reason, speed_kmh, motion, app_build) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id, OWNER, at, NOW, module, job, '56 04 00 52', response, 'ok', null, 0, 'parked', '142');
    put(mandate);
    put(plan);
    read('read-in-window', NOW - 1000, 'dsc_e46', 'FS_LESEN', `a0 ${ascii(VIN)}`);
    read('read-ident', NOW - 900, 'dsc_e46', 'IDENT', 'a0 01 02 03');
    read('read-other-mod', NOW - 800, 'smg2', 'FS_LESEN', 'a0 00');
    read('read-before', NOW - 2 * D, 'dsc_e46', 'FS_LESEN', 'a0 00');
    const run = { n: 1, samples: [{ t: 0, values: { '19:v': 12 } }], exchanges: [{ what: 'IDENT', response: 'a0 11 22' }] };
    db.prepare('INSERT INTO monitoring_runs (id, owner, record, n, plan_v, started_at, ended_at, end_reason, sample_count, mock, app_build, synced_at, run_gz) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run(
        `${REC}-run-1`, OWNER, REC, 1, 1, NOW - 5000, NOW - 1000, 'done', 1, 0, '142', NOW, gzipSync(JSON.stringify(run)),
    );
    const call = async (method: string, path: string, body?: unknown, token: string | null = TOKEN, at = NOW) => {
        const r = await handle(
            new Request(`https://monitoring-desk.example.workers.dev${path}`, {
                method,
                headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
                body: body === undefined ? undefined : JSON.stringify(body),
            }),
            { RUNS_DB: d1 },
            at,
        );
        return { status: r.status, body: (await r.json()) as Record<string, unknown>, text: '' };
    };
    return { db, put, call };
}

describe('who the desk answers', () => {
    it('a token that stands, and nobody else', async () => {
        const w = await world();
        expect((await w.call('GET', '/investigations', undefined, null)).status).toBe(401);
        expect((await w.call('GET', '/investigations', undefined, 'desk_' + 'b'.repeat(40))).status).toBe(401);
        expect((await w.call('GET', '/investigations', undefined, TOKEN, NOW + 31 * D)).status).toBe(401);
        w.db.prepare('UPDATE monitoring_desk_tokens SET revoked_at = ?').run(NOW - 1);
        expect((await w.call('GET', '/investigations')).status).toBe(401);
    });
});

describe('what the desk reads', () => {
    it('lists the investigations whose mandate stands, with no owner and no VIN', async () => {
        const w = await world();
        w.put(entry('mandate-other', NOW - 20 * D, 'driver', { kind: 'mandate', words: '前の調査', modules: [], until: NOW - 13 * D }, 'rec-expired1'));
        const r = await w.call('GET', '/investigations');
        expect(r.status).toBe(200);
        const list = r.body.investigations as Record<string, unknown>[];
        expect(list.map((x) => x.record)).toEqual([REC]);
        expect(list[0]).toMatchObject({ entries: 2, runs: 1, openAsks: 0 });
        expect(JSON.stringify(r.body)).not.toContain(OWNER);
        expect(JSON.stringify(r.body)).not.toContain(VIN);
        expect(JSON.stringify(r.body)).toContain('[VIN]');
    });

    it('shows a record’s reads inside its mandate only, for its modules, with the VIN taken out', async () => {
        const w = await world();
        const r = await w.call('GET', `/investigations/${REC}`);
        expect(r.status).toBe(200);
        const reads = r.body.reads as { job: string; response: string | null; redacted?: string; module: string }[];
        expect(reads.map((x) => x.job)).toEqual(['FS_LESEN', 'IDENT']);
        expect(reads.every((x) => x.module === 'dsc_e46')).toBe(true);
        expect(reads[0]).toMatchObject({ redacted: 'VIN masked' });
        expect(reads[1]).toMatchObject({ response: null, redacted: 'withheld: identification (4 bytes)' });
        expect(JSON.stringify(r.body)).not.toContain(ascii(VIN));
        expect(JSON.stringify(r.body)).not.toContain(OWNER);
    });

    it('gives one run whole, its identity exchanges withheld', async () => {
        const w = await world();
        const r = await w.call('GET', `/investigations/${REC}/runs/1`);
        expect(r.status).toBe(200);
        expect(r.body.samples).toEqual([{ t: 0, values: { '19:v': 12 } }]);
        expect(r.body.exchanges).toEqual([{ what: 'IDENT', response: null, redacted: 'withheld: identification (3 bytes)' }]);
    });

    it('answers a withdrawn or unknown record as not delegated, the same way', async () => {
        const w = await world();
        w.put(entry('status-000001', NOW - 10, 'driver', { kind: 'status', re: mandate.id, to: 'withdrawn' }));
        expect((await w.call('GET', `/investigations/${REC}`)).status).toBe(404);
        expect((await w.call('GET', '/investigations/rec-unknown01')).status).toBe(404);
        expect(((await w.call('GET', '/investigations')).body.investigations as unknown[]).length).toBe(0);
    });

    it('serves no record that two owners share', async () => {
        const w = await world();
        w.put(entry('mandate-twin01', NOW - D, 'driver', { kind: 'mandate', words: '別の人', modules: [], until: NOW + D }), 'acct-00000002');
        expect((await w.call('GET', `/investigations/${REC}`)).status).toBe(404);
    });
});

describe('what the desk writes', () => {
    it('adds entries as the desk, on its own clock, and the record keeps them', async () => {
        const w = await world();
        const r = await w.call('POST', `/investigations/${REC}/entries`, {
            entries: [
                { body: { kind: 'read', text: 'ヨーのゼロ点ずれを疑う', sure: 'low' } },
                { body: { kind: 'plan', v: 2, re: plan.id, mandate: mandate.id, purpose: 'v2', steps: STEPS } },
            ],
        });
        expect(r.status).toBe(200);
        expect(r.body.written).toBe(2);
        const rows = w.db.prepare("SELECT by, at, owner FROM monitoring_notebook WHERE by = 'desk' ORDER BY at").all();
        expect(rows).toEqual([
            { by: 'desk', at: NOW, owner: OWNER },
            { by: 'desk', at: NOW + 1, owner: OWNER },
        ]);
    });

    it('writes nothing when one entry is refused, and says which and why', async () => {
        const w = await world();
        const r = await w.call('POST', `/investigations/${REC}/entries`, {
            entries: [
                { body: { kind: 'read', text: 'ok', sure: 'low' } },
                { body: { kind: 'note', run: null, t: null, text: '運転手は急いでいた', via: 'screen' } },
            ],
        });
        expect(r.status).toBe(422);
        expect(r.body).toMatchObject({ index: 1, written: 0 });
        expect(w.db.prepare("SELECT COUNT(*) AS n FROM monitoring_notebook WHERE by = 'desk'").get()).toEqual({ n: 0 });
    });

    it('refuses a plan outside the mandate', async () => {
        const w = await world();
        const smg = [{ n: 1, do: 'SMG faults', kind: 'faults', module: 'smg2', when: 'parked' }];
        const r = await w.call('POST', `/investigations/${REC}/entries`, { entries: [{ body: { kind: 'plan', v: 2, mandate: mandate.id, purpose: 'SMG', steps: smg } }] });
        expect(r.status).toBe(422);
        expect(String(r.body.reason)).toMatch(/outside it/);
    });
});

describe('the record of what the desk did', () => {
    it('is a row per call answered, refusals included', async () => {
        const w = await world();
        await w.call('GET', '/investigations');
        await w.call('GET', `/investigations/${REC}`);
        await w.call('GET', '/investigations/rec-unknown01');
        await w.call('POST', `/investigations/${REC}/entries`, { entries: [{ body: { kind: 'ask', to: 'driver', text: '雨でしたか？' } }] });
        expect(w.db.prepare('SELECT token, action, record FROM monitoring_desk_audit ORDER BY id').all()).toEqual([
            { token: 'tok-loop', action: 'list', record: null },
            { token: 'tok-loop', action: 'read', record: REC },
            { token: 'tok-loop', action: 'refused', record: 'rec-unknown01' },
            { token: 'tok-loop', action: 'write', record: REC },
        ]);
    });
});

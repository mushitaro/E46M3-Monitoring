import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { NotebookEntry } from '../notebook/rules';
import type { ReadRecord } from '../investigation/readRecord';
import { sqliteD1 } from '../testing/sqliteD1';
import * as notebook from '../../../functions/api/notebook/index';
import * as reads from '../../../functions/api/reads/index';
import * as runs from '../../../functions/api/runs/index';

/**
 * The three routes the WORKS build sends to by itself (functions/api/notebook, /runs, /reads),
 * against the real schema (migrations/),
 * through the owner the gate resolved: what each keeps, what it refuses, and that one owner never
 * reaches another's rows. Here rather than beside them: Pages makes a route of every file under
 * functions/, a test file included.
 */

const ME = { id: 'acct-00000001', label: '#T0' };
const OTHER = { id: 'acct-00000002', label: '#T1' };
const T0 = Date.now() - 3_600_000;
const REC = 'rec-00000001';

function call(d1: ReturnType<typeof sqliteD1>['d1'], owner: typeof ME | null, method: string, url: string, body?: unknown) {
    return {
        request: new Request(`https://e46m3-monitoring-preview.pages.dev${url}`, {
            method,
            body: body === undefined ? undefined : JSON.stringify(body),
            headers: body === undefined ? undefined : { 'content-type': 'application/json' },
        }),
        env: { RUNS_DB: d1 },
        data: owner ? { owner } : {},
        params: {},
    };
}

const entry = (id: string, at: number, by: NotebookEntry['by'], body: NotebookEntry['body'], sessionId = REC): NotebookEntry => ({ id, sessionId, at, by, body });
const mandate = entry('mandate-000001', T0, 'driver', { kind: 'mandate', words: 'DSC が早く効く。原因を', modules: ['dsc_e46'], until: T0 + 7 * 86_400_000 });
const STEPS = [{ n: 1, do: 'DSC faults', kind: 'faults' as const, module: 'dsc_e46', when: 'parked' as const }];
const plan = entry('plan-00000001', T0 + 1000, 'chat', { kind: 'plan', v: 1, mandate: mandate.id, purpose: 'DSC early', steps: STEPS });

describe('/api/notebook', () => {
    it('keeps a delegated record, the mandate first, and gives it back to its owner only', async () => {
        const { d1 } = sqliteD1();
        const r = await notebook.onRequestPost(call(d1, ME, 'POST', '/api/notebook', { entries: [plan, mandate] }));
        expect(await r.json()).toEqual({ stored: 2, refused: [] });

        const mine = (await (await notebook.onRequestGet(call(d1, ME, 'GET', `/api/notebook?record=${REC}`))).json()) as { entries: NotebookEntry[] };
        expect(mine.entries.map((e) => e.id)).toEqual([mandate.id, plan.id]);
        const theirs = (await (await notebook.onRequestGet(call(d1, OTHER, 'GET', `/api/notebook?record=${REC}`))).json()) as { entries: NotebookEntry[] };
        expect(theirs.entries).toEqual([]);
    });

    it('refuses what was not delegated, what the rules refuse, and anything written as the desk', async () => {
        const { d1 } = sqliteD1();
        const loose = entry('note-00000001', T0, 'driver', { kind: 'note', run: null, t: null, text: '独り言', via: 'voice' }, 'rec-00000002');
        const noMandate = entry('plan-00000002', T0, 'chat', { kind: 'plan', v: 1, purpose: 'x', steps: STEPS });
        const asDesk = entry('read-00000001', T0 + 2000, 'desk', { kind: 'read', text: 'x', sure: 'low' });
        const r = (await (await notebook.onRequestPost(call(d1, ME, 'POST', '/api/notebook', { entries: [mandate, loose, noMandate, asDesk] }))).json()) as {
            stored: number;
            refused: { id: string; reason: string }[];
        };
        expect(r.stored).toBe(1);
        expect(Object.fromEntries(r.refused.map((x) => [x.id, x.reason]))).toEqual({
            'note-00000001': expect.stringMatching(/not delegated/),
            'plan-00000002': expect.stringMatching(/acts under a mandate/),
            'read-00000001': expect.stringMatching(/desk writes through the desk/),
        });
    });

    it('stores the same entry twice as once, and never under another owner', async () => {
        const { d1 } = sqliteD1();
        await notebook.onRequestPost(call(d1, ME, 'POST', '/api/notebook', { entries: [mandate] }));
        expect(await (await notebook.onRequestPost(call(d1, ME, 'POST', '/api/notebook', { entries: [mandate] }))).json()).toEqual({ stored: 1, refused: [] });
        const r = (await (await notebook.onRequestPost(call(d1, OTHER, 'POST', '/api/notebook', { entries: [mandate] }))).json()) as { refused: { reason: string }[] };
        expect(r.refused).toEqual([{ id: mandate.id, reason: 'id_taken' }]);
    });

    it('answers 401 without an owner', async () => {
        const { d1 } = sqliteD1();
        expect((await notebook.onRequestGet(call(d1, null, 'GET', `/api/notebook?record=${REC}`))).status).toBe(401);
        expect((await notebook.onRequestPost(call(d1, null, 'POST', '/api/notebook', { entries: [mandate] }))).status).toBe(401);
    });
});

describe('/api/runs', () => {
    const run = (startedAt: number) => ({
        id: `${REC}-run-1-${startedAt}`,
        record: REC,
        n: 1,
        planV: 1,
        startedAt,
        endedAt: startedAt + 60_000,
        end: 'done',
        sampleCount: 0,
        mock: false,
        appBuild: '142.test',
        runGz: gzipSync(JSON.stringify({ samples: [] })).toString('base64'),
    });

    it('keeps a run that started while the record was delegated, and lists it without its data', async () => {
        const { d1 } = sqliteD1();
        await notebook.onRequestPost(call(d1, ME, 'POST', '/api/notebook', { entries: [mandate] }));
        expect((await runs.onRequestPost(call(d1, ME, 'POST', '/api/runs', run(T0 + 5000)))).status).toBe(200);
        const listed = (await (await runs.onRequestGet(call(d1, ME, 'GET', `/api/runs?record=${REC}`))).json()) as { runs: Record<string, unknown>[] };
        expect(listed.runs).toHaveLength(1);
        expect(listed.runs[0]).toMatchObject({ n: 1, end_reason: 'done' });
        expect(listed.runs[0]).not.toHaveProperty('run_gz');
    });

    it('refuses a run of a record that was not delegated when it started', async () => {
        const { d1 } = sqliteD1();
        await notebook.onRequestPost(call(d1, ME, 'POST', '/api/notebook', { entries: [mandate] }));
        expect((await runs.onRequestPost(call(d1, ME, 'POST', '/api/runs', run(T0 - 5000)))).status).toBe(422);
        expect((await runs.onRequestPost(call(d1, OTHER, 'POST', '/api/runs', run(T0 + 5000)))).status).toBe(422);
    });
});

describe('/api/reads', () => {
    const read = (id: string, over: Partial<ReadRecord> = {}): ReadRecord => ({
        id,
        at: T0,
        module: 'dsc_e46',
        job: 'FS_LESEN',
        request: '56 04 04 00 56',
        response: '00',
        outcome: 'ok',
        reason: null,
        speedKmh: 0,
        motion: 'parked',
        ...over,
    });

    it('keeps each read once, and refuses a malformed one without holding back the rest', async () => {
        const { d1, db } = sqliteD1();
        const body = { reads: [read('read-0000001'), read('read-0000002', { outcome: 'rejected', reason: 'status 0xb0' }), read('read-0000003', { request: 'zz' })], appBuild: '142.test' };
        expect(await (await reads.onRequestPost(call(d1, ME, 'POST', '/api/reads', body))).json()).toEqual({
            stored: 2,
            refused: [{ id: 'read-0000003', reason: 'request must be hex or null' }],
        });
        expect(await (await reads.onRequestPost(call(d1, ME, 'POST', '/api/reads', { reads: [read('read-0000001')] }))).json()).toEqual({ stored: 0, refused: [] });
        expect(db.prepare('SELECT owner, app_build FROM monitoring_reads ORDER BY id').all()).toEqual([
            { owner: ME.id, app_build: '142.test' },
            { owner: ME.id, app_build: '142.test' },
        ]);
    });
});

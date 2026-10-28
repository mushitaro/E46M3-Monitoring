import { describe, expect, it, vi } from 'vitest';
import { WAKES_PER_HOUR, WAKE_EVERY_MS, wakeDesk, wakeWorthy } from '../../../functions/_lib/wake';
import type { NotebookEntry } from '../notebook/rules';
import { sqliteD1 } from '../testing/sqliteD1';
import * as notebook from '../../../functions/api/notebook/index';

/**
 * Waking the loop when a delegated investigation asks something of it: what wakes it, how often,
 * and that only the record id leaves.
 */

const NOW = 1_800_000_000_000;
const OWNER = 'acct-00000001';
const REC = 'rec-00000001';
const e = (id: string, by: NotebookEntry['by'], body: NotebookEntry['body'], at = NOW): NotebookEntry => ({ id, sessionId: REC, at, by, body });

const okFetch = () => vi.fn(async () => new Response('{}', { status: 200 })) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
const env = (d1: ReturnType<typeof sqliteD1>['d1'], token: string | undefined = 'sk-ant-oat01-test') => ({ RUNS_DB: d1, LOOP_TRIGGER_ID: 'trig_01test', LOOP_FIRE_TOKEN: token });

describe('what wakes the loop', () => {
    const ask = e('ask-desk-01', 'chat', { kind: 'ask', to: 'driver', text: '雨でしたか？' });
    it('is a mandate, a question put to the desk, or the owner’s answer to a question asked of them', () => {
        expect(wakeWorthy(e('m-00000001', 'driver', { kind: 'mandate', words: '調べて', modules: [], until: NOW + 1 }), [])).toBe(true);
        expect(wakeWorthy(e('a-00000001', 'chat', { kind: 'ask', to: 'desk', text: '基準値は？' }), [])).toBe(true);
        expect(wakeWorthy(e('a-00000002', 'driver', { kind: 'answer', re: ask.id, text: '晴れ' }), [ask])).toBe(true);
    });
    it('is not a note, a reading, or a question put to the driver', () => {
        expect(wakeWorthy(e('n-00000001', 'driver', { kind: 'note', run: null, t: null, text: 'ここ', via: 'voice' }), [])).toBe(false);
        expect(wakeWorthy(e('r-00000001', 'chat', { kind: 'read', text: 'x', sure: 'low' }), [])).toBe(false);
        expect(wakeWorthy(ask, [])).toBe(false);
    });
});

describe('firing', () => {
    it('sends the record id and the reason to the task’s fire URL, with its own token, and nothing else', async () => {
        const { d1 } = sqliteD1();
        const f = okFetch();
        expect(await wakeDesk(env(d1), OWNER, REC, 'mandate', NOW, f)).toBe('fired');
        const [url, init] = f.mock.calls[0] as [string, RequestInit];
        expect(url).toBe('https://api.anthropic.com/v1/claude_code/routines/trig_01test/fire');
        expect((init.headers as Record<string, string>).authorization).toBe('Bearer sk-ant-oat01-test');
        expect(JSON.parse(String(init.body))).toEqual({ text: `MONITORING record ${REC}: mandate` });
    });

    it('fires a record once in ten minutes, and again after', async () => {
        const { d1 } = sqliteD1();
        const f = okFetch();
        expect(await wakeDesk(env(d1), OWNER, REC, 'mandate', NOW, f)).toBe('fired');
        expect(await wakeDesk(env(d1), OWNER, REC, 'run 1', NOW + 60_000, f)).toBe('recent');
        expect(await wakeDesk(env(d1), OWNER, REC, 'run 2', NOW + WAKE_EVERY_MS, f)).toBe('fired');
        expect(f).toHaveBeenCalledTimes(2);
    });

    it('keeps to its share of the task’s hourly fires', async () => {
        const { d1 } = sqliteD1();
        const f = okFetch();
        for (let i = 0; i < WAKES_PER_HOUR; i++) expect(await wakeDesk(env(d1), OWNER, `rec-${String(i).padStart(8, '0')}`, 'mandate', NOW + i, f)).toBe('fired');
        expect(await wakeDesk(env(d1), OWNER, 'rec-overflow1', 'mandate', NOW + 100, f)).toBe('recent');
    });

    it('does nothing without its token, and says so; a refused fire never throws', async () => {
        const { d1 } = sqliteD1();
        const f = okFetch();
        expect(await wakeDesk(env(d1, ''), OWNER, REC, 'mandate', NOW, f)).toBe('off');
        expect(f).not.toHaveBeenCalled();
        const refused = vi.fn(async () => new Response('{}', { status: 401 })) as unknown as typeof fetch;
        expect(await wakeDesk(env(d1), OWNER, REC, 'mandate', NOW, refused)).toBe('failed');
    });
});

describe('the route', () => {
    it('wakes the loop after storing a mandate, without holding up the answer', async () => {
        const { d1 } = sqliteD1();
        const waited: Promise<unknown>[] = [];
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
        try {
            const mandate = e('mandate-000001', 'driver', { kind: 'mandate', words: '調べて', modules: [], until: Date.now() + 86_400_000 }, Date.now() - 1000);
            const r = await notebook.onRequestPost({
                request: new Request('https://x.pages.dev/api/notebook', { method: 'POST', body: JSON.stringify({ entries: [mandate] }) }),
                env: env(d1),
                data: { owner: { id: OWNER, label: '#T0' } },
                params: {},
                waitUntil: (p) => void waited.push(p),
            });
            expect(r.status).toBe(200);
            expect(waited).toHaveLength(1);
            expect(await waited[0]).toBe('fired');
            expect(JSON.parse(String((fetchSpy.mock.calls[0][1] as RequestInit).body)).text).toBe(`MONITORING record ${REC}: mandate`);
        } finally {
            fetchSpy.mockRestore();
        }
    });
});

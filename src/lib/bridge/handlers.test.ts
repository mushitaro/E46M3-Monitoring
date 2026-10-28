import { describe, expect, it, vi } from 'vitest';
import { addProblem, mergeEntries, runnablePlan, type NotebookEntry } from '../notebook/rules';
import type { ProbeLive, StoredRun } from '../probe/runStore';
import { bridgeHandlers, pickRecord, type TabFacade } from './handlers';
import { MONITORING_TOOLS } from './tools';

/**
 * The handlers over a facade that keeps CO-WORK in memory under the same rules as the device store
 * (every write through addProblem). What is checked is what the assistant can and cannot make the
 * tab do, and who each entry is written as.
 */

const T0 = 1_800_000_000_000;

function tab(over: Partial<TabFacade> = {}) {
    let now = T0;
    let seq = 0;
    let entries: NotebookEntry[] = [];
    let live: ProbeLive | null = null;
    const f: TabFacade = {
        now: () => now,
        newId: () => `id-${String(++seq).padStart(6, '0')}`,
        status: () => ({ device: 'ナビ', link: 'connected' }),
        faults: () => [],
        refreshFaults: async () => null,
        catalog: async () => [],
        entries: async () => entries,
        add: async (es) => {
            for (const e of es) {
                const record = entries.filter((x) => x.sessionId === e.sessionId);
                const problem = addProblem(e, record);
                if (problem) throw new Error(problem);
            }
            entries = mergeEntries(entries, es);
        },
        live: () => live,
        lastRun: () => null,
        ledger: () => [],
        sessions: async () => [],
        display: vi.fn(),
        stage: async () => ({}),
        startLog: () => null,
        stopLog: () => 'recording',
        save: async () => ({ saved: true }),
        sync: async () => ({ sent: 0 }),
        openTuner: (discard) => ({ opened: discard }),
        connect: async () => ({ connected: true }),
        disconnect: async (stop) => ({ disconnected: true, stopped: stop }),
        ...over,
    };
    return {
        f,
        h: bridgeHandlers(f),
        tick: (ms: number) => (now += ms),
        setLive: (l: ProbeLive | null) => (live = l),
        entries: () => entries,
    };
}

const STEPS = [{ n: 1, do: 'DSC faults, parked', kind: 'faults', module: 'dsc_e46', when: 'parked' }];

describe('every tool the tab names has an answer', () => {
    it('one handler per tool', () => {
        expect(Object.keys(bridgeHandlers(tab().f)).sort()).toEqual(Object.keys(MONITORING_TOOLS).sort());
    });
});

describe('an investigation is the owner’s, and the assistant works inside it', () => {
    it('starts with the owner’s words as the mandate, and a plan under it runs', async () => {
        const t = tab();
        const inv = (await t.h.monitoring_investigate({ words: '低速カーブで DSC が早く効く', modules: ['dsc_e46', 'mss54'], days: 7 })) as { record: string; mandate: string };
        const mandate = t.entries().find((e) => e.id === inv.mandate)!;
        expect(mandate.by).toBe('driver');
        await t.h.monitoring_plan({ record: inv.record, mandate: inv.mandate, purpose: 'DSC early', steps: STEPS });
        const plan = t.entries().find((e) => e.body.kind === 'plan')!;
        expect(plan.by).toBe('chat');
        const r = runnablePlan(t.entries(), T0 + 1000);
        expect(r.ok && r.entry.id).toBe(plan.id);
    });

    it('refuses a plan with no mandate, or outside it, with the rule’s sentence', async () => {
        const t = tab();
        const inv = (await t.h.monitoring_investigate({ words: 'DSC だけ見て', modules: ['dsc_e46'], days: 3 })) as { record: string; mandate: string };
        await expect(t.h.monitoring_plan({ record: inv.record, purpose: 'x', steps: STEPS })).rejects.toThrow(/acts under a mandate/);
        const smg = [{ n: 1, do: 'SMG faults', kind: 'faults', module: 'smg2', when: 'parked' }];
        await expect(t.h.monitoring_plan({ record: inv.record, mandate: inv.mandate, purpose: 'x', steps: smg })).rejects.toThrow(/outside it/);
    });

    it('holds a mandate to at most 30 days', async () => {
        const t = tab();
        await t.h.monitoring_investigate({ words: 'ずっと見てて', modules: [], days: 365 });
        const m = t.entries()[0];
        expect(m.body.kind === 'mandate' && m.body.until - m.at).toBe(30 * 86_400_000);
    });

    it('withdraws a mandate as the owner, and the plan stops being runnable', async () => {
        const t = tab();
        const inv = (await t.h.monitoring_investigate({ words: '調べて', modules: [], days: 7 })) as { record: string; mandate: string };
        await t.h.monitoring_plan({ record: inv.record, mandate: inv.mandate, purpose: 'x', steps: STEPS });
        await t.h.monitoring_finding({ record: inv.record, kind: 'status', re: inv.mandate, status: 'withdrawn' });
        expect(t.entries().at(-1)!.by).toBe('driver');
        expect(runnablePlan(t.entries(), T0 + 1000).ok).toBe(false);
    });
});

describe('the driver’s words and the assistant’s own', () => {
    it('keeps a note as the driver’s, on the clock of the run in progress', async () => {
        const t = tab();
        const inv = (await t.h.monitoring_investigate({ words: '調べて', modules: [], days: 7 })) as { record: string };
        t.setLive({ sessionId: inv.record, n: 2, startedAt: T0, planV: 1, samples: [] });
        t.tick(12_300);
        const r = (await t.h.monitoring_note({ text: '今効いた' })) as { run: number; t: number };
        expect(r).toMatchObject({ run: 2, t: 12.3 });
        expect(t.entries().at(-1)!.by).toBe('driver');
    });

    it('writes an answer as the person’s words, and a reading as its own', async () => {
        const t = tab();
        const inv = (await t.h.monitoring_investigate({ words: '調べて', modules: [], days: 7 })) as { record: string };
        const ask = (await t.h.monitoring_finding({ record: inv.record, kind: 'ask', to: 'driver', text: '雨でしたか？' })) as { id: string };
        await t.h.monitoring_finding({ record: inv.record, kind: 'answer', re: ask.id, text: '晴れ' });
        await t.h.monitoring_finding({ record: inv.record, kind: 'read', sure: 'low', text: 'ゼロ点ずれの可能性' });
        expect(t.entries().slice(-3).map((e) => e.by)).toEqual(['chat', 'driver', 'chat']);
    });

    it('refuses a fact without evidence', async () => {
        const t = tab();
        await t.h.monitoring_investigate({ words: '調べて', modules: [], days: 7 });
        await expect(t.h.monitoring_finding({ kind: 'fact', text: '舵角 3°' })).rejects.toThrow(/evidence/);
    });

    it('marks a step only on a run of that record', async () => {
        const t = tab();
        await t.h.monitoring_investigate({ words: '調べて', modules: [], days: 7 });
        await expect(t.h.monitoring_mark({ n: 1 })).rejects.toThrow(/No PROBE run/);
    });
});

describe('what loses something waits for a yes', () => {
    it('stops a recording only when confirmed', async () => {
        const stopLog = vi.fn(() => 'recording' as const);
        const t = tab({ stopLog });
        await expect(t.h.monitoring_stop_log({})).rejects.toThrow(/confirmed: true/);
        expect(stopLog).not.toHaveBeenCalled();
        await expect(t.h.monitoring_stop_log({ confirmed: true })).resolves.toEqual({ stopped: 'recording' });
    });

    it('saves and sends on the owner’s word', async () => {
        const t = tab();
        await expect(t.h.monitoring_save({})).rejects.toThrow(/confirmed/);
        await expect(t.h.monitoring_save({ confirmed: true })).resolves.toEqual({ saved: true });
        await expect(t.h.monitoring_sync_upload({ confirmed: true })).resolves.toEqual({ sent: 0 });
    });

    it('opens TUNER on the owner’s word, and passes on whether unsaved work may go', async () => {
        const openTuner = vi.fn((discard: boolean) => ({ opened: discard }));
        const t = tab({ openTuner });
        await expect(t.h.monitoring_open_tuner({})).rejects.toThrow(/confirmed/);
        expect(openTuner).not.toHaveBeenCalled();
        await expect(t.h.monitoring_open_tuner({ confirmed: true })).resolves.toEqual({ opened: false });
        await expect(t.h.monitoring_open_tuner({ confirmed: true, discard_unsaved: true })).resolves.toEqual({ opened: true });
    });

    it('connects again and lets the cable go on the owner’s word, and passes on a confirmed stop', async () => {
        const t = tab();
        await expect(t.h.monitoring_connect({})).rejects.toThrow(/confirmed/);
        await expect(t.h.monitoring_connect({ confirmed: true })).resolves.toEqual({ connected: true });
        await expect(t.h.monitoring_disconnect({})).rejects.toThrow(/confirmed/);
        await expect(t.h.monitoring_disconnect({ confirmed: true })).resolves.toEqual({ disconnected: true, stopped: false });
        await expect(t.h.monitoring_disconnect({ confirmed: true, stop_recording: true })).resolves.toEqual({ disconnected: true, stopped: true });
    });

    it('passes a refusal to start through as the answer’s error', async () => {
        const t = tab({ startLog: () => 'Only the MSS54 has a live-block layout.' });
        await expect(t.h.monitoring_start_log({})).rejects.toThrow(/MSS54/);
    });
});

describe('a moment', () => {
    const run = (samples: number, hz = 5): StoredRun => ({
        id: 'r1', sessionId: 'rec-0001', n: 1, planId: 'p', planV: 1, startedAt: T0, endedAt: T0 + (samples / hz) * 1000, end: 'stopped',
        samples: Array.from({ length: samples }, (_, i) => ({ t: i / hz, values: { '19:v': i } })),
        exchanges: [], captures: [], steps: [], judges: [],
    });

    it('is the window around the time asked, counted back from the call', async () => {
        const t = tab({ lastRun: () => run(600) });
        t.tick(120_000); // the run lasted 120 s and ended now
        const m = (await t.h.monitoring_moment({ seconds_ago: 10, window_s: 4 })) as { recorded: boolean; window: { centre: number }; samples: { t: number }[] };
        expect(m.recorded).toBe(true);
        expect(m.window.centre).toBe(110);
        expect(m.samples[0].t).toBeGreaterThanOrEqual(108);
        expect(m.samples.at(-1)!.t).toBeLessThanOrEqual(112);
    });

    it('says so when nothing was recorded then', async () => {
        const t = tab({ lastRun: () => run(10) });
        t.tick(3_600_000);
        const m = (await t.h.monitoring_moment({})) as { recorded: boolean; reason: string };
        expect(m.recorded).toBe(false);
        expect(m.reason).toMatch(/No samples/);
    });

    it('thins a wide window', async () => {
        const t = tab({ lastRun: () => run(1000, 10) });
        t.tick(100_000);
        const m = (await t.h.monitoring_moment({ seconds_ago: 50, window_s: 60 })) as { samples: unknown[] };
        expect(m.samples.length).toBeLessThanOrEqual(120);
    });
});

describe('which record a call means', () => {
    it('is the one named, or the one with the newest plan', () => {
        const e = (id: string, sessionId: string, at: number, body: NotebookEntry['body'], by: NotebookEntry['by'] = 'owner'): NotebookEntry => ({ id, sessionId, at, by, body });
        const entries = [
            e('a-000001', 'rec-aaaa', T0, { kind: 'plan', v: 1, purpose: 'a', steps: STEPS as never }),
            e('b-000001', 'rec-bbbb', T0 + 5, { kind: 'note', run: null, t: null, text: 'x', via: 'voice' }, 'driver'),
        ];
        expect(pickRecord(entries, undefined).id).toBe('rec-aaaa');
        expect(pickRecord(entries, 'rec-bbbb').id).toBe('rec-bbbb');
        expect(() => pickRecord(entries, 'rec-cccc')).toThrow(/no record/);
        expect(() => pickRecord([], undefined)).toThrow(/monitoring_investigate/);
    });
});

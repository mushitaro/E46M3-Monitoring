import { describe, expect, it } from 'vitest';
import type { NotebookEntry } from '../notebook/rules';
import { delegatedWindows, deskProblem, sendableEntry, sendableRun } from './share';

/**
 * What of an investigation leaves the device, and what the desk may write into one: the policy's
 * 「調査の委任」 as rules, checked against one record written over a week.
 */

const T0 = 1_800_000_000_000;
const H = 3_600_000;
const D = 24 * H;
const REC = 'rec-00000001';

let seq = 0;
const e = (at: number, by: NotebookEntry['by'], body: NotebookEntry['body'], id = `e-${String(++seq).padStart(6, '0')}`): NotebookEntry => ({ id, sessionId: REC, at, by, body });

const before = e(T0 - H, 'driver', { kind: 'note', run: null, t: null, text: '前から気になっていた', via: 'voice' });
const mandate = e(T0, 'driver', { kind: 'mandate', words: '低速カーブで DSC が早く効く。原因と対策を', modules: ['dsc_e46', 'mss54'], until: T0 + 7 * D }, 'mandate-01');
const STEPS = [{ n: 1, do: 'DSC faults, parked', kind: 'faults' as const, module: 'dsc_e46', when: 'parked' as const }];
const plan = e(T0 + H, 'chat', { kind: 'plan', v: 1, mandate: mandate.id, purpose: 'DSC early', steps: STEPS }, 'plan-0001');
const withdrawal = e(T0 + 2 * D, 'driver', { kind: 'status', re: mandate.id, to: 'withdrawn' });
const after = e(T0 + 3 * D, 'driver', { kind: 'note', run: null, t: null, text: 'もう直った', via: 'voice' });
const open = [before, mandate, plan];
const record = [before, mandate, plan, withdrawal, after];

describe('what of a record leaves the device', () => {
    it('is what was written while a mandate stood, the mandate included', () => {
        expect(sendableEntry(open, mandate)).toBe(true);
        expect(sendableEntry(open, plan)).toBe(true);
    });

    it('is not what was written before it was handed over', () => {
        expect(sendableEntry(open, before)).toBe(false);
    });

    it('once it is withdrawn, is the withdrawal and nothing more — not even what had not gone yet', () => {
        expect(sendableEntry(record, withdrawal)).toBe(true);
        expect(sendableEntry(record, plan)).toBe(false);
        expect(sendableEntry(record, after)).toBe(false);
    });

    it('stops at the mandate’s own end', () => {
        const short = e(T0, 'owner', { kind: 'mandate', words: '一日だけ見て', modules: [], until: T0 + D }, 'mandate-02');
        const inside = e(T0 + H, 'driver', { kind: 'note', run: null, t: null, text: '当日', via: 'voice' });
        const late = e(T0 + 2 * D, 'driver', { kind: 'note', run: null, t: null, text: '翌々日', via: 'voice' });
        expect(sendableEntry([short, inside, late], inside)).toBe(true);
        expect(sendableEntry([short, inside, late], late)).toBe(false);
    });

    it('sends a run only when a mandate stood as it started, and not once it is withdrawn', () => {
        expect(sendableRun(open, { startedAt: T0 + 2 * H })).toBe(true);
        expect(sendableRun(open, { startedAt: T0 - 1 })).toBe(false);
        expect(sendableRun(record, { startedAt: T0 + 2 * H })).toBe(false);
    });

    it('gives the desk the windows of the mandates not taken back, clipped to their end and to now', () => {
        expect(delegatedWindows(open, T0 + D)).toEqual([{ from: T0, to: T0 + D, modules: ['dsc_e46', 'mss54'] }]);
        expect(delegatedWindows(open, T0 + 30 * D)).toEqual([{ from: T0, to: T0 + 7 * D, modules: ['dsc_e46', 'mss54'] }]);
        expect(delegatedWindows(record, T0 + 30 * D)).toEqual([]);
    });
});

describe('what the desk may write', () => {
    const now = T0 + D;
    const desk = (body: NotebookEntry['body']) => e(now, 'desk', body);

    it('writes a reading, a question and a plan inside the mandate', () => {
        expect(deskProblem(desk({ kind: 'read', text: 'ヨーのゼロ点ずれの可能性', sure: 'low' }), open)).toBeNull();
        expect(deskProblem(desk({ kind: 'ask', to: 'driver', text: '雨の日でしたか？' }), open)).toBeNull();
        expect(deskProblem(desk({ kind: 'plan', v: 2, re: plan.id, mandate: mandate.id, purpose: 'v2', steps: STEPS }), open)).toBeNull();
    });

    it('never a mandate or a note, and never a plan outside the mandate', () => {
        expect(deskProblem(desk({ kind: 'mandate', words: '自分で調べる', modules: [], until: now + D }), open)).toMatch(/plan, fact, read/);
        expect(deskProblem(desk({ kind: 'note', run: null, t: null, text: '運転手は急いでいた', via: 'screen' }), open)).toMatch(/plan, fact, read/);
        const smg = [{ n: 1, do: 'SMG faults', kind: 'faults' as const, module: 'smg2', when: 'parked' as const }];
        expect(deskProblem(desk({ kind: 'plan', v: 2, mandate: mandate.id, purpose: 'SMG', steps: smg }), open)).toMatch(/outside it/);
    });

    it('nothing once the mandate is withdrawn', () => {
        expect(deskProblem(e(T0 + 2 * D + 1, 'desk', { kind: 'read', text: '遅すぎた', sure: 'low' }), record)).toMatch(/no mandate stands/);
    });

    it('answers only a question put to the desk, and sets the status of its own entries only', () => {
        const toDesk = e(now - 1, 'chat', { kind: 'ask', to: 'desk', text: 'ヨーレートの基準値は？' }, 'ask-desk-1');
        const toDriver = e(now - 1, 'chat', { kind: 'ask', to: 'driver', text: '雨でしたか？' }, 'ask-drv-1');
        const withAsks = [...open, toDesk, toDriver];
        expect(deskProblem(desk({ kind: 'answer', re: toDesk.id, text: '0 ± 0.5 °/s' }), withAsks)).toBeNull();
        expect(deskProblem(desk({ kind: 'answer', re: toDriver.id, text: '晴れ' }), withAsks)).toMatch(/put to the desk/);
        expect(deskProblem(desk({ kind: 'status', re: mandate.id, to: 'withdrawn' }), open)).toMatch(/its own entries/);
        const own = e(now - 1, 'desk', { kind: 'read', text: '仮説 A', sure: 'mid' }, 'desk-read-1');
        expect(deskProblem(desk({ kind: 'status', re: own.id, to: 'withdrawn' }), [...open, own])).toBeNull();
    });

    it('as itself only', () => {
        expect(deskProblem({ ...desk({ kind: 'read', text: 'x', sure: 'low' }), by: 'chat' }, open)).toMatch(/as desk/);
    });
});

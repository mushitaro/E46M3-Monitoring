import { describe, expect, it } from 'vitest';
import { addProblem, currentPlan, entryProblem, liveMandate, mergeEntries, notebookLine, openAsks, statusOf, type NotebookEntry } from './rules';
import { ramSegment, stepsProblem, type ProbeStep } from '../probe/plan';

const T0 = 1_800_000_000_000;
let seq = 0;
const entry = (by: NotebookEntry['by'], body: NotebookEntry['body'], at = T0 + seq): NotebookEntry => ({
    id: `entry-${String(++seq).padStart(4, '0')}`,
    sessionId: 'session-0001',
    at,
    by,
    body,
});

const STEPS: ProbeStep[] = [
    { n: 1, do: 'Read DSC fault memory while parked', kind: 'faults', module: 'dsc_e46', when: 'parked' },
    { n: 2, do: 'Keep speed and throttle', kind: 'sample', channels: ['19:v', '3:wdk1'] },
    { n: 3, do: 'Mark slow corners', kind: 'capture', condition: [{ channel: '19:v', op: '<=', value: 40 }], preS: 5, postS: 5 },
];
const mandate = (modules: string[] = ['dsc_e46', 'mss54'], by: NotebookEntry['by'] = 'driver', until = T0 + 86_400_000) =>
    entry(by, { kind: 'mandate', words: '低速カーブで DSC が早く効く気がする。原因と対策を考えて', modules, until });
const plan = (by: NotebookEntry['by'], m?: string, steps = STEPS) => entry(by, { kind: 'plan', v: 1, mandate: m, purpose: 'DSC early in slow corners', steps });

describe('a mandate is the owner’s, and the desk acts inside it', () => {
    it('can be given only by the driver or the owner', () => {
        expect(entryProblem(mandate([], 'desk'))).toMatch(/owner's own words/);
        expect(entryProblem(mandate([], 'chat'))).toMatch(/owner's own words/);
        expect(entryProblem(mandate([], 'driver'))).toBeNull();
    });

    it('lasts at most 30 days', () => {
        expect(entryProblem(mandate([], 'owner', T0 + 31 * 86_400_000))).toMatch(/within 30 days/);
    });

    it('is required for a plan by the assistant or the desk, and must still stand', () => {
        const m = mandate();
        expect(addProblem(plan('desk'), [m])).toMatch(/acts under a mandate/);
        expect(addProblem(plan('desk', m.id), [m])).toBeNull();
        const withdrawn = entry('owner', { kind: 'status', re: m.id, to: 'withdrawn' });
        expect(addProblem(plan('desk', m.id), [m, withdrawn])).toMatch(/not standing/);
        const late = { ...plan('desk', m.id), at: T0 + 2 * 86_400_000 };
        expect(addProblem(late, [m])).toMatch(/not standing/);
    });

    it('limits a plan to the modules it names, and says to ask for the rest', () => {
        const m = mandate(['dsc_e46']);
        // The sample and capture steps are the DME's, which this mandate does not name.
        expect(addProblem(plan('chat', m.id), [m])).toMatch(/mss54 is outside it/);
        const anyModule = mandate([]);
        expect(addProblem(plan('chat', anyModule.id), [anyModule])).toBeNull();
    });

    it('is not needed when the driver or the owner writes the plan themselves', () => {
        expect(addProblem(plan('owner'), [])).toBeNull();
    });

    it('stands only between when it was given and its end', () => {
        const m = mandate();
        expect(liveMandate([m], m.id, m.at - 1)).toBeNull();
        expect(liveMandate([m], m.id, m.at + 1)?.id).toBe(m.id);
    });
});

describe('TUNER’s rules, kept', () => {
    it('lets only the driver or the owner write a note', () => {
        expect(entryProblem(entry('desk', { kind: 'note', run: null, t: null, text: 'x', via: 'voice' }))).toMatch(/ask instead/);
        expect(entryProblem(entry('driver', { kind: 'note', run: 1, t: 12, text: '今ランプ点いた', via: 'voice' }))).toBeNull();
    });

    it('refuses a fact without evidence', () => {
        expect(entryProblem(entry('desk', { kind: 'fact', text: 'x' } as never))).toMatch(/evidence is required/);
    });

    it('keeps a disagreement beside what it disagrees with, and a fork for the driver', () => {
        const a = entry('desk', { kind: 'read', text: 'LWS offset', sure: 'mid' });
        const b = entry('chat', { kind: 'read', text: 'tyre size', sure: 'low', re: a.id });
        expect(statusOf([a, b], a.id)).toBe('disputed');
        const p1 = plan('owner');
        const p2 = { ...plan('owner'), body: { ...(plan('owner').body as object), re: p1.id } } as NotebookEntry;
        const p3 = { ...plan('owner'), body: { ...(plan('owner').body as object), re: p1.id } } as NotebookEntry;
        expect(currentPlan([p1, p2, p3]).forked).toBe(true);
        expect(notebookLine([p1, p2, p3])).toMatch(/×2/);
    });

    it('merges two copies of the same record without duplicates, in time order', () => {
        const a = entry('driver', { kind: 'note', run: null, t: null, text: 'a', via: 'screen' }, T0 + 5);
        const b = entry('desk', { kind: 'ask', to: 'driver', text: 'b?' }, T0 + 1);
        expect(mergeEntries([a], [b, a]).map((e) => e.id)).toEqual([b.id, a.id]);
        expect(openAsks([a, b])).toHaveLength(1);
    });
});

describe('plan steps are reads, and say so in a form the tab can check', () => {
    it('accepts the plan shape and refuses unknown kinds and malformed channels', () => {
        expect(stepsProblem(STEPS)).toBeNull();
        expect(stepsProblem([{ n: 1, do: 'x', kind: 'actuate', module: 'dsc_e46' }])).toMatch(/kind must be/);
        expect(stepsProblem([{ n: 1, do: 'x', kind: 'sample', channels: ['v'] }])).toMatch(/selection:symbol/);
    });

    it('reads RAM only inside the DME master windows, as TUNER measured them', () => {
        expect(ramSegment('FFD1A2', 2)).toBe(0x04);
        expect(ramSegment('FF8010', 1)).toBe(0x01);
        expect(ramSegment('FF9000', 1)).toBeNull(); // the low window ends at FF8FFF
        expect(ramSegment('FFEFFF', 2)).toBeNull(); // straddles the high window's end
        expect(stepsProblem([{ n: 1, do: 'x', kind: 'ram', address: '7F0000', bytes: 2, every: 1 }])).toMatch(/master RAM windows/);
    });
});

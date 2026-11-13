import { describe, expect, it } from 'vitest';
import { diffForms, formItems, judgeKey, measures, type Form } from './items';
import type { Judge, ProbeStep } from '@tsunagi/monitoring-engine';

const steps = (channels: string[]): ProbeStep[] => [
    { n: 1, do: 'faults', kind: 'faults', module: 'mss54', when: 'parked' },
    { n: 2, do: 'sample', kind: 'sample', channels },
];
const j = (id: string, where?: Judge['where']): Judge => ({ id, channel: '3:tmot', stat: 'max', op: '<', value: 110, provenance: 'authored', ...(where ? { where } : {}) });

describe('the items of a form', () => {
    it('names each value, read and judgement once', () => {
        const items = formItems({ steps: steps(['3:n', '3:tmot', '3:n']), judge: [j('hot')] });
        expect(items.map((i) => i.key)).toEqual(['faults:mss54', 'value:3:n', 'value:3:tmot', judgeKey(j('hot'))]);
    });

    it('makes a judgement whose condition changed a new item, and one whose threshold changed the same', () => {
        const a = j('hot');
        const b = { ...j('hot'), value: 105 };
        const c = j('hot', [{ channel: '19:v', op: '>', value: 30 }]);
        expect(judgeKey(a)).toBe(judgeKey(b));
        expect(judgeKey(a)).not.toBe(judgeKey(c));
    });
});

describe('two versions of a form', () => {
    const v1: Form = { v: 1, steps: steps(['3:n', '3:tmot']), judge: [j('hot')] };
    const v2: Form = { v: 2, steps: steps(['3:n', '3:toel']), judge: [j('hot', [{ channel: '19:v', op: '>', value: 30 }])] };

    it('says what was added, what was removed and what both measured', () => {
        const d = diffForms(v1, v2);
        expect([d.from, d.to]).toEqual([1, 2]);
        expect(d.common.map((i) => i.key)).toEqual(['faults:mss54', 'value:3:n']);
        expect(d.added.map((i) => i.label)).toEqual(['3:toel', 'hot']);
        expect(d.removed.map((i) => i.label)).toEqual(['3:tmot', 'hot']);
    });

    it('reads a whole block as sampling each of its values', () => {
        expect(measures({ steps: steps(['19:*']) }, '19:v')).toBe(true);
        expect(measures({ steps: steps(['19:*']) }, '3:n')).toBe(false);
        expect(measures({ steps: [{ n: 1, do: 'ram', kind: 'ram', address: 'FFD1A2', bytes: 2, every: 1 }] }, 'ram:FFD1A2')).toBe(true);
    });
});

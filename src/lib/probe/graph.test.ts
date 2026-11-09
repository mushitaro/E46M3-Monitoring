import { describe, expect, it } from 'vitest';
import { graphOf } from './graph';

const run = (n: number, f: (t: number) => Record<string, number | null>) => Array.from({ length: n }, (_, i) => ({ t: i, values: f(i) }));

describe('the graph part', () => {
    it('shows the last seconds of the value and its target, the newest at the right', () => {
        const g = graphOf(run(100, (t) => ({ '35:evan1_ist': t, '35:evan1_soll': t + 1 })), { value: '35:evan1_ist', target: '35:evan1_soll', seconds: 30 });
        expect(g.from).toBe(69);
        expect(g.to).toBe(99);
        expect(g.points[0]).toEqual({ t: 69, value: 69, target: 70 });
        expect(g.points.at(-1)).toEqual({ t: 99, value: 99, target: 100 });
        expect([g.min, g.max]).toEqual([69, 100]);
        expect(g.latest).toEqual({ value: 99, target: 100, deviation: -1, t: 99 });
    });

    it('keeps the newest at the right edge when the run is shorter than the window', () => {
        const g = graphOf(run(8, (t) => ({ a: t })), { value: 'a', seconds: 30 });
        expect([g.from, g.to]).toEqual([-23, 7]);
        expect(g.points).toHaveLength(8);
    });

    it('colours by the distance from the target only when a band was given, and says which way', () => {
        const at = (v: number, band?: number) => graphOf([{ t: 0, values: { a: v, b: 10 } }], { value: 'a', target: 'b', seconds: 30, band }).tone;
        expect(at(13)).toBe('none');
        expect(at(11, 2)).toBe('within');
        expect(at(13, 2)).toBe('above');
        expect(at(7, 2)).toBe('below');
        expect(graphOf([{ t: 0, values: { a: 5 } }], { value: 'a', seconds: 30, band: 1 }).tone).toBe('none');
    });

    it('skips samples that did not read the value, and draws nothing when none did', () => {
        const g = graphOf(run(10, (t) => ({ a: t % 2 ? t : null })), { value: 'a', seconds: 30 });
        expect(g.points.map((p) => p.t)).toEqual([1, 3, 5, 7, 9]);
        expect(graphOf(run(5, () => ({ a: null })), { value: 'a', seconds: 30 }).latest).toBeNull();
    });

    it('gives the context values as last read, and null for one never read', () => {
        const g = graphOf(run(5, (t) => ({ a: t, '3:n': t < 3 ? 800 + t : null })), { value: 'a', seconds: 30, context: ['3:n', '3:wdk1'] });
        expect(g.context).toEqual([
            { channel: '3:n', value: 802 },
            { channel: '3:wdk1', value: null },
        ]);
    });

    it('thins a long window evenly, keeping both ends', () => {
        const g = graphOf(run(1000, (t) => ({ a: t })), { value: 'a', seconds: 300 }, 50);
        expect(g.points).toHaveLength(50);
        expect(g.points[0].t).toBe(699);
        expect(g.points.at(-1)!.t).toBe(999);
    });
});

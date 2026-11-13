import { describe, expect, it } from 'vitest';
import { runStats } from './runStats';

const samples = [
    { t: 0, values: { '3:ub': 13.6, '35:evan1_ist': 10 } },
    { t: 1, values: { '3:ub': 12.9 } },
    { t: 2, values: { '3:ub': 13.7, '35:evan1_ist': 30 } },
    { t: 3, values: { '3:ub': 12.9, '35:evan1_ist': null } },
];

describe("a run's spread for the assistant", () => {
    it('gives min, max with the second each came at, and the mean, for the channels asked only', () => {
        expect(runStats(samples, ['3:ub', '35:evan1_ist'])).toEqual({
            '3:ub': { n: 4, min: 12.9, minAt: 1, max: 13.7, maxAt: 2, mean: 13.275 },
            '35:evan1_ist': { n: 2, min: 10, minAt: 0, max: 30, maxAt: 2, mean: 20 },
        });
    });

    it('keeps to the seconds asked', () => {
        expect(runStats(samples, ['3:ub'], { from: 2, to: 3 })['3:ub']).toEqual({ n: 2, min: 12.9, minAt: 3, max: 13.7, maxAt: 2, mean: 13.3 });
    });

    it('says a channel never read is null, not zero', () => {
        expect(runStats(samples, ['3:n'])).toEqual({ '3:n': null });
    });
});

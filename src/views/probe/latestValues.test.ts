import { describe, expect, it } from 'vitest';
import { latestValues } from './BoardView';

describe('latestValues', () => {
    it('takes the newest number of each channel and skips non-numbers', () => {
        const m = latestValues({
            samples: [
                { t: 0, values: { rpm: 800, v: 13.3 } },
                { t: 1, values: { rpm: 2500, v: NaN } },
                { t: 2, values: { rpm: 3000 } },
            ],
        });
        expect(m.get('rpm')).toBe(3000);
        expect(m.get('v')).toBe(13.3);
    });

    it('follows a run in progress as its samples grow in place', () => {
        const samples: Array<{ t: number; values: Record<string, number | null> }> = [{ t: 0, values: { rpm: 800 } }];
        expect(latestValues({ samples }).get('rpm')).toBe(800);
        samples.push({ t: 1, values: { rpm: 1200, v: 13.9 } });
        const m = latestValues({ samples });
        expect([m.get('rpm'), m.get('v')]).toEqual([1200, 13.9]);
        samples.push({ t: 2, values: { rpm: null } });
        expect(latestValues({ samples }).get('rpm')).toBe(1200);
    });
});

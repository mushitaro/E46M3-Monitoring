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
});

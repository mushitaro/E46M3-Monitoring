import { describe, expect, it } from 'vitest';
import { probeKept } from './probeKept';

describe('what SAVE says about PROBE runs', () => {
    it('says nothing with no investigation open, or none run', () => {
        expect(probeKept(null, [{ samples: [1] }])).toBeNull();
        expect(probeKept('rec', [])).toBeNull();
    });

    it('counts the runs and their samples, and says they are kept with the investigation', () => {
        const k = probeKept('rec', [{ samples: new Array(425) }, { samples: new Array(221) }]);
        expect(k).toMatchObject({ record: 'rec', runs: 2, samples: 646 });
        expect(k?.note).toMatch(/2 runs, 646 samples/);
        expect(k?.note).toMatch(/not part of this save/);
    });

    it('one run is one run', () => {
        expect(probeKept('rec', [{ samples: [] }])?.note).toMatch(/1 run, 0 samples/);
    });
});

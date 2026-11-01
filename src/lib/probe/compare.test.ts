import { describe, expect, it } from 'vitest';
import { compareRuns, trend } from './compare';
import type { ProbeRun } from './executor';

/** Two observations of the same car, as PROBE keeps them, and what changed between them. */
const run = (n: number, values: Array<Record<string, number | null>>, extra: Partial<ProbeRun> = {}) => ({
    planId: 'p',
    planV: 1,
    startedAt: n * 1000,
    endedAt: n * 1000 + values.length * 250,
    end: 'stopped' as const,
    samples: values.map((v, i) => ({ t: i / 4, values: v })),
    exchanges: [],
    captures: [],
    steps: [],
    judges: [],
    sessionId: 'rec-0001',
    n,
    ...extra,
});

describe('comparing two observations', () => {
    it('puts the value that moved most for its own spread first', () => {
        const a = run(1, [{ '3:n': 800, '3:tmot': 90 }, { '3:n': 820, '3:tmot': 90 }]);
        const b = run(2, [{ '3:n': 805, '3:tmot': 95 }, { '3:n': 815, '3:tmot': 95 }]);
        const c = compareRuns(a, b);
        expect(c.channels[0].channel).toBe('3:tmot');
        expect(c.channels[0].delta).toBe(5);
        expect(c.channels[1]).toMatchObject({ channel: '3:n', delta: 0 });
        expect(c.a).toMatchObject({ record: 'rec-0001', n: 1, samples: 2 });
    });

    it('says which channels only one run has, and leaves out values that were not read', () => {
        const c = compareRuns(run(1, [{ '3:n': 800, '19:v': null }]), run(2, [{ '3:n': 800, '22:ti': 3 }]));
        expect(c.onlyIn).toEqual({ a: [], b: ['22:ti'] });
        expect(c.channels.map((x) => x.channel)).toEqual(['3:n']);
    });

    it('compares learned values and every module’s fault answer', () => {
        const ex = (response: string) => [{ t: 0, step: 1, module: 'dsc_e46', what: 'FS_LESEN', request: '56 05 04 01 56', response, outcome: 'ok' as const, motion: 'parked' as const }];
        const a = run(1, [], { adaptations: { 'adapt:6:lu_adapt': 1.2 }, exchanges: ex('00') });
        const b = run(2, [], { adaptations: { 'adapt:6:lu_adapt': 1.7 }, exchanges: ex('01 5d 20') });
        const c = compareRuns(a, b);
        expect(c.adaptations).toEqual([{ key: 'adapt:6:lu_adapt', a: 1.2, b: 1.7, delta: 0.5 }]);
        expect(c.faults).toEqual([{ module: 'dsc_e46', what: 'FS_LESEN', a: '00', b: '01 5d 20', same: false }]);
    });
});

describe('one value across the history', () => {
    it('gives each run’s statistics, oldest first, and null where a run did not read it', () => {
        const t = trend([run(1, [{ '3:tmot': 88 }]), run(2, []), run(3, [{ '3:tmot': 91 }])], ['3:tmot']);
        expect(t[0].points.map((p) => p.stats?.mean ?? null)).toEqual([88, null, 91]);
    });
});

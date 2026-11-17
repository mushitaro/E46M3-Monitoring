import { describe, expect, it } from 'vitest';
import type { AgreedFrame, CatalogJob, JobOperation } from '@tsunagi/monitoring-engine';
import { agreedChoices } from './agreedChoices';

const f = (args: string[], jobId = 'STEUERN_STELLGLIED'): AgreedFrame => ({ moduleId: 'smg2', jobId, args, hex: args.join('|') }) as unknown as AgreedFrame;
const job = { id: 'STEUERN_STELLGLIED', args: [{ name: 'STELLGL' }, { name: 'STEUERART1' }, { name: 'STEUERART2' }] } as unknown as CatalogJob;
const hold = { kind: 'hold', stopJob: 'STEUERN_STELLGLIED', stopArgs: { STEUERART1: 'INAKTIV' } } as Pick<JobOperation, 'kind' | 'stopJob' | 'startArgs' | 'stopArgs'>;

describe('the sets of values a job that takes them is offered with', () => {
    const cases = [
        f(['HYDROPUMPE', 'AKTIV', '0']),
        f(['HYDROPUMPE', 'INAKTIV', '0']),
        f(['SHIFTLOCK', 'AKTIV', '1']), // its stop (INAKTIV, 1) was not agreed
        f(['SHIFTLOCK', 'INAKTIV', '0']),
    ];

    it('offers a start only with its stop agreed, over the same values', () => {
        const c = agreedChoices(job, hold, cases, cases);
        expect(c.map((x) => x.label)).toEqual(['HYDROPUMPE · AKTIV · 0']);
        expect(c[0].stop?.args).toEqual(['HYDROPUMPE', 'INAKTIV', '0']);
        expect(c[0].values).toEqual({ STELLGL: 'HYDROPUMPE', STEUERART1: 'AKTIV', STEUERART2: '0' });
    });

    it('never offers the stop itself as a start', () => {
        expect(agreedChoices(job, hold, cases, cases).some((x) => x.start.args[1] === 'INAKTIV')).toBe(false);
    });

    it('offers every agreed set for a job run once, with no stop', () => {
        const once = { kind: 'pulse' } as Pick<JobOperation, 'kind' | 'stopJob' | 'startArgs' | 'stopArgs'>;
        expect(agreedChoices(job, once, cases, []).map((x) => x.stop)).toEqual([undefined, undefined, undefined, undefined]);
    });

    it('offers nothing to hold when the stop is another job: its values would need comparing too', () => {
        expect(agreedChoices(job, { ...hold, stopJob: 'TESTPRG_STOP' }, cases, cases)).toEqual([]);
    });

    it('keeps to what the start imposes', () => {
        const imposed = { ...hold, startArgs: { STEUERART1: 'AKTIV' } };
        expect(agreedChoices(job, imposed, [...cases, f(['HYDROPUMPE', 'STROMVORGABE', '0'])], cases).map((x) => x.label)).toEqual(['HYDROPUMPE · AKTIV · 0']);
    });
});

import { describe, expect, it } from 'vitest';
import { mayActuate } from '../actuationGate.ts';
import type { CatalogJob, EcuProfile } from '../ecuCatalog.ts';
import { EMPTY_LEDGER, recordPracticeRun } from '../ledger.ts';
import { mayRun } from '../runGate.ts';
import { HAVE_SHIPPED_DATA, readShipped } from '../testing/shipped.ts';
import { agreedCasesFrom, agreedFrameFrom, isAgreedFor, runName, telegramOfAgreed, type JobFramesOracle } from './agreedFrame.ts';
import type { SgbdResultsTable } from './results.ts';

describe('the name a run of a job that takes values goes by', () => {
    it('is the job and the part it drives, as a procedure is called by its program', () => {
        expect(runName('STEUERN_STELLGLIED', ['HYDROPUMPE', 'AKTIV', '0'])).toBe('STEUERN_STELLGLIED(HYDROPUMPE)');
        expect(runName('STEUERN_EKP', [])).toBe('STEUERN_EKP');
        expect(runName('STEUERN_EKP', undefined)).toBe('STEUERN_EKP');
    });
});

describe.skipIf(!HAVE_SHIPPED_DATA)('the frames a job that takes values may send: the app and EdiabasLib alike', () => {
    const oracle = () => readShipped<JobFramesOracle>('job-frames.oracle.json');
    const smg2 = () => readShipped<SgbdResultsTable>('smg2.results.json');
    const job = () => readShipped<EcuProfile>('smg2.jobs.json').jobs.find((j) => j.id === 'STEUERN_STELLGLIED') as CatalogJob;
    const HYDRO = ['HYDROPUMPE', 'AKTIV', '0'];

    it('agrees on a set EdiabasLib was run with and the app builds alike', () => {
        const r = agreedFrameFrom(oracle(), smg2(), 'smg2', 0x32, 'STEUERN_STELLGLIED', HYDRO);
        expect(r).toMatchObject({ ok: true, frame: { moduleId: 'smg2', jobId: 'STEUERN_STELLGLIED', args: HYDRO, hex: '32 07 0c 05 01 00 3d' } });
    });

    it('agrees on nothing EdiabasLib was not run with, or sent nothing for', () => {
        // A PIN in place of the name: EdiabasLib's job refuses it.
        expect(agreedFrameFrom(oracle(), smg2(), 'smg2', 0x32, 'STEUERN_STELLGLIED', ['0x05', 'AKTIV', '0']).ok).toBe(false);
        // A number outside every stretch EdiabasLib was run with, and a fraction where only whole numbers were.
        expect(agreedFrameFrom(oracle(), smg2(), 'smg2', 0x32, 'STEUERN_STELLGLIED', ['HYDROPUMPE', 'AKTIV', '70000']).ok).toBe(false);
        expect(agreedFrameFrom(oracle(), smg2(), 'smg2', 0x32, 'STEUERN_STELLGLIED', ['HYDROPUMPE', 'AKTIV', '7.5']).ok).toBe(false);
        // A word nobody tried.
        expect(agreedFrameFrom(oracle(), smg2(), 'smg2', 0x32, 'STEUERN_STELLGLIED', ['HYDROPUMPE', 'HALB', '0']).ok).toBe(false);
        // No oracle at all.
        expect(agreedFrameFrom(null, smg2(), 'smg2', 0x32, 'STEUERN_STELLGLIED', HYDRO).ok).toBe(false);
    });

    it('opens a number between two tried values only where every tried value between them agreed', () => {
        // 0, 1, 2, 10, 100, 127, 128, 200, 254, 255 were tried; 77 lies between 10 and 100.
        const r = agreedFrameFrom(oracle(), smg2(), 'smg2', 0x32, 'STEUERN_STELLGLIED', ['MAGNETVENTIL_KUPPLUNG', 'POSITIONSVORGABE', '77']);
        expect(r).toMatchObject({ ok: true, frame: { basis: 'range', args: ['MAGNETVENTIL_KUPPLUNG', 'POSITIONSVORGABE', '77'], hex: '32 07 0c 0a 00 4d 7e' } });
    });

    it('lists only agreed sets, all for this job', () => {
        const all = agreedCasesFrom(oracle(), smg2(), 'smg2', 0x32, 'STEUERN_STELLGLIED');
        expect(all.length).toBeGreaterThan(0);
        expect(all.every((f) => f.jobId === 'STEUERN_STELLGLIED' && !f.args[0].startsWith('0x'))).toBe(true);
    });

    it('opens the gate only for its own job, values and bytes', () => {
        const r = agreedFrameFrom(oracle(), smg2(), 'smg2', 0x32, 'STEUERN_STELLGLIED', HYDRO);
        if (!r.ok) throw new Error(r.why);
        const f = r.frame;
        expect(isAgreedFor(f, 'smg2', 'STEUERN_STELLGLIED', HYDRO, f.hex)).toBe(true);
        expect(isAgreedFor(f, 'smg2', 'STEUERN_STELLGLIED', ['HYDROPUMPE', 'AKTIV', '1'], f.hex)).toBe(false);
        expect(isAgreedFor(f, 'smg2', 'STEUERN_STELLGLIED', HYDRO, '32 07 0c 0a 01 00 32')).toBe(false);
        expect(isAgreedFor(f, 'mss54', 'STEUERN_STELLGLIED', HYDRO, f.hex)).toBe(false);
        expect(isAgreedFor(undefined, 'smg2', 'STEUERN_STELLGLIED', HYDRO, f.hex)).toBe(false);

        const ctx = { moduleId: 'smg2', mode: 'practice' as const, motion: 'parked' as const, group: 'drivetrain' };
        // Without an agreed frame: refused, as every job that takes values was.
        expect(mayActuate(job(), telegramOfAgreed(f), EMPTY_LEDGER, ctx)).toMatchObject({ allowed: false, reason: 'run_block_needsArgs' });
        // With it, for these values: PRACTICE runs it, with its terms.
        expect(mayActuate(job(), telegramOfAgreed(f), EMPTY_LEDGER, { ...ctx, args: HYDRO, agreed: f })).toMatchObject({
            allowed: true,
            telegram: { hex: f.hex },
            actuation: { nature: 'a_smg' },
        });
        // Handed for other values than it was agreed for: refused.
        expect(mayActuate(job(), telegramOfAgreed(f), EMPTY_LEDGER, { ...ctx, args: ['HYDROPUMPE', 'AKTIV', '1'], agreed: f }).allowed).toBe(false);
    });

    it('on a car, wants this part practised, not another', () => {
        const r = agreedFrameFrom(oracle(), smg2(), 'smg2', 0x32, 'STEUERN_STELLGLIED', HYDRO);
        if (!r.ok) throw new Error(r.why);
        const f = r.frame;
        const ctx = { moduleId: 'smg2', motion: 'parked' as const, group: 'drivetrain', args: HYDRO, agreed: f };
        expect(mayRun(job(), telegramOfAgreed(f), EMPTY_LEDGER, ctx)).toMatchObject({ allowed: false, reason: 'run_block_practiceFirst' });
        const other = recordPracticeRun(EMPTY_LEDGER, 'smg2:STEUERN_STELLGLIED(MAGNETVENTIL_KUPPLUNG)', '2026-11-17T00:00:00Z');
        expect(mayRun(job(), telegramOfAgreed(f), other, ctx)).toMatchObject({ allowed: false, reason: 'run_block_practiceFirst' });
        const practised = recordPracticeRun(EMPTY_LEDGER, 'smg2:STEUERN_STELLGLIED(HYDROPUMPE)', '2026-11-17T00:00:00Z');
        expect(mayRun(job(), telegramOfAgreed(f), practised, ctx)).toMatchObject({ allowed: true, requires: 'parked' });
        expect(mayRun(job(), telegramOfAgreed(f), practised, { ...ctx, motion: 'moving' })).toMatchObject({ allowed: false, reason: 'run_block_moving' });
    });
});

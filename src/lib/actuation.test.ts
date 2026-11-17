import { describe, expect, it, vi } from 'vitest';
import type { AgreedFrame, CatalogJob, RunVerdict, TelegramTable } from '@tsunagi/monitoring-engine';
import { assistantMayStart, startActuation } from './actuation';

const job = (id: string, cls: CatalogJob['class'] = 'test', stopJob?: string): CatalogJob =>
    ({ id, class: cls, args: [], op: stopJob ? { stopJob } : {} }) as unknown as CatalogJob;

describe('assistantMayStart: the owner\'s table says who, and a moving car is read only', () => {
    it('opens what the table gives the assistant, parked, with the owner\'s words', () => {
        expect(assistantMayStart('radio', job('STEUERN_SEEK_UP'), 'comm', 'parked', 'いいよ')).toEqual({ ok: true });
        expect(assistantMayStart('radio', job('STEUERN_SEEK_UP'), 'comm', 'unknown', 'いいよ')).toEqual({ ok: true });
    });

    it('refuses while the car moves, without the owner\'s words, and reads', () => {
        expect(assistantMayStart('radio', job('STEUERN_SEEK_UP'), 'comm', 'moving', 'いいよ').ok).toBe(false);
        expect(assistantMayStart('radio', job('STEUERN_SEEK_UP'), 'comm', 'parked', '  ').ok).toBe(false);
        expect(assistantMayStart('radio', job('STATUS_LESEN', 'read'), 'comm', 'parked', 'いいよ').ok).toBe(false);
    });

    it('leaves what the table keeps for the screen to the screen, and what it keeps off, off', () => {
        const writes = assistantMayStart('mss54', job('SPEICHER_SCHREIBEN', 'programming'), 'engine', 'parked', 'いいよ');
        expect(writes.ok).toBe(false);
        // The radio's fault memory clear: c_clear, a person on the screen until the owner's table says otherwise.
        const clear = assistantMayStart('radio', job('FS_LOESCHEN'), 'comm', 'parked', 'いいよ');
        if (!clear.ok) expect(clear.reason).toMatch(/monitoring_stage|screen/);
    });
});

describe('startActuation: one path from an allowed verdict to a sent frame and an armed output', () => {
    const verdict = { allowed: true, telegram: { hex: '68 04 0c 01 61', confidence: 'single' }, control: 0x0c, requires: 'parked' } as unknown as Extract<RunVerdict, { allowed: true }>;
    const telegrams = { jobs: {} } as unknown as TelegramTable;

    it('sends the gate\'s bytes with its requirement, and arms nothing for a pulse', async () => {
        const send = vi.fn(async () => ({ ok: true }));
        const arm = vi.fn();
        const r = await startActuation({ moduleId: 'radio', job: job('STEUERN_SEEK_UP'), phase: 'pulse', verdict, telegrams, send, arm, now: 1 });
        expect(send).toHaveBeenCalledWith('STEUERN_SEEK_UP', '68 04 0c 01 61', 'parked', undefined);
        expect(arm).not.toHaveBeenCalled();
        expect(r).toEqual({ sent: true, armed: false, timeoutS: null });
    });

    it('arms nothing when the link did not send', async () => {
        const arm = vi.fn();
        const r = await startActuation({ moduleId: 'radio', job: job('STEUERN_FADER_LV'), phase: 'start', verdict, telegrams, send: async () => null, arm, now: 1 });
        expect(r.sent).toBe(false);
        expect(arm).not.toHaveBeenCalled();
    });

    it('arms a start with its stop resolved first, and the time-out that ends it', async () => {
        const arm = vi.fn();
        const withStop = { jobs: { STEUERN_ENDE: [{ hex: '68 03 0d 66', confidence: 'single' }] } } as unknown as TelegramTable;
        const r = await startActuation({ moduleId: 'radio', job: job('STEUERN_FADER_LV', 'test', 'STEUERN_ENDE'), phase: 'start', verdict, telegrams: withStop, send: async () => ({}), arm, now: 7 });
        expect(r).toEqual({ sent: true, armed: true, timeoutS: 10 });
        expect(arm).toHaveBeenCalledWith(expect.objectContaining({ jobId: 'STEUERN_FADER_LV', stopJobId: 'STEUERN_ENDE', stopHex: '68 03 0d 66', at: 7, timeoutS: 10 }));
    });

    it('never arms a start whose stop cannot be found', async () => {
        const arm = vi.fn();
        const r = await startActuation({ moduleId: 'radio', job: job('STEUERN_FADER_LV', 'test', 'STEUERN_ENDE'), phase: 'start', verdict, telegrams: null, send: async () => ({}), arm, now: 1 });
        expect(r).toEqual({ sent: true, armed: false, timeoutS: null });
        expect(arm).not.toHaveBeenCalled();
    });
});

describe('startActuation with values: per part, and never without its stop in hand', () => {
    const vjob = {
        id: 'STEUERN_STELLGLIED',
        class: 'test',
        args: [{ name: 'STELLGL' }, { name: 'STEUERART1' }, { name: 'STEUERART2' }],
        op: { stopJob: 'STEUERN_STELLGLIED', stopArgs: { STEUERART1: 'INAKTIV' } },
    } as unknown as CatalogJob;
    const verdict = {
        allowed: true,
        telegram: { hex: '32 07 0c 05 01 00 3d', confidence: 'single' },
        control: 0x0c,
        requires: 'parked',
        actuation: { nature: 'a_smg', who: 'screen', engine: null, timeoutS: 10, stopJob: 'STEUERN_STELLGLIED' },
    } as unknown as Extract<RunVerdict, { allowed: true }>;
    const stop = { moduleId: 'smg2', jobId: 'STEUERN_STELLGLIED', args: ['HYDROPUMPE', 'INAKTIV', '0'], hex: '32 07 0c 05 00 00 3c' } as unknown as AgreedFrame;
    const args = ['HYDROPUMPE', 'AKTIV', '0'];

    it('sends nothing to start a part whose stop is not in hand', async () => {
        const send = vi.fn(async () => ({}));
        const r = await startActuation({ moduleId: 'smg2', job: vjob, phase: 'start', verdict, telegrams: null, args, send, arm: vi.fn(), now: 1 });
        expect(r.sent).toBe(false);
        expect(send).not.toHaveBeenCalled();
    });

    it("sends and permits under the part's name, and arms its agreed stop", async () => {
        const send = vi.fn(async () => ({}));
        const arm = vi.fn();
        const r = await startActuation({ moduleId: 'smg2', job: vjob, phase: 'start', verdict, telegrams: null, args, stop, send, arm, now: 5 });
        expect(r).toEqual({ sent: true, armed: true, timeoutS: 10 });
        expect(send).toHaveBeenCalledWith('STEUERN_STELLGLIED(HYDROPUMPE)', '32 07 0c 05 01 00 3d', 'parked', expect.objectContaining({ jobId: 'STEUERN_STELLGLIED(HYDROPUMPE)' }));
        expect(arm).toHaveBeenCalledWith(
            expect.objectContaining({
                jobId: 'STEUERN_STELLGLIED',
                stopJobId: 'STEUERN_STELLGLIED(HYDROPUMPE)',
                stopHex: '32 07 0c 05 00 00 3c',
                stopPermit: expect.objectContaining({ kind: 'stop', jobId: 'STEUERN_STELLGLIED(HYDROPUMPE)', hex: '32 07 0c 05 00 00 3c' }),
            }),
        );
    });

    it('refuses a stop for another module', async () => {
        const send = vi.fn(async () => ({}));
        const r = await startActuation({ moduleId: 'mss54', job: vjob, phase: 'start', verdict, telegrams: null, args, stop, send, arm: vi.fn(), now: 1 });
        expect(r.sent).toBe(false);
        expect(send).not.toHaveBeenCalled();
    });
});

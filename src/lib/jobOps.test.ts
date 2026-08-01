import { describe, expect, it } from 'vitest';
import { PROCEDURE_PREFIX, hasStopControl, jobOperation, reportsProgress } from './jobOps';
import type { CatalogJob } from './ecuCatalog';

const job = (id: string, de?: string, args?: string[]): CatalogJob => ({
    id,
    ja: '',
    en: '',
    desc: de ? { de } : undefined,
    args: args?.map((name) => ({ name })),
});

describe('operation shape', () => {
    it('classifies a read as changing nothing and needing no stop', () => {
        const op = jobOperation(job('ABGLEICHWERTE_LESEN', 'Lesen der aktuellen Abgleichwerte'), 'mss54');
        expect(op.kind).toBe('read');
        expect(hasStopControl(op)).toBe(false);
        expect(op.irreversible).toBeUndefined();
    });

    it('classifies a plain actuation as a pulse with nothing to stop', () => {
        const op = jobOperation(job('STEUERN_EV1', 'Einspritzventil 1 ansteuern'), 'mss54');
        expect(op.kind).toBe('pulse');
        expect(hasStopControl(op)).toBe(false);
    });

    // The SCHALTEN argument IS the switch, so this one holds. Getting it wrong
    // means no STOP control on a job that leaves an output energised.
    it('treats a SCHALTEN argument as a held output', () => {
        const op = jobOperation(job('STEUERN_DMTL_HEIZUNG', 'Stellgliedansteuerung DMTL-Heizung', ['SCHALTEN']), 'mss54');
        expect(op.kind).toBe('hold');
        expect(hasStopControl(op)).toBe(true);
        expect(op.stopJob).toBe('STEUERN_DMTL_HEIZUNG');
    });

    it('treats a direct pin drive as a held output, and says why it is dangerous', () => {
        const op = jobOperation(
            job('IO_STATUS_VORGEBEN', 'direkte Stellgliedansteuerung ueber Pin/Tastv./Periode', [
                'PIN_NUMMER',
                'TASTVERHAELTNIS',
                'PERIODENDAUER',
            ]),
            'mss54',
        );
        expect(op.kind).toBe('hold');
        expect(op.irreversible).toBe('irr_pin');
    });

    // DSC_SIM_* actuates and holds, and the SGBD exposes no release job. The UI
    // must not offer a STOP that cannot work.
    it('marks DSC_SIM_* as latching with NO stop control', () => {
        const op = jobOperation(job('DSC_SIM_VA', 'Ansteuern und Halten ueber digitale Ansteuerung'), 'dsc_mk60');
        expect(op.kind).toBe('latching');
        expect(hasStopControl(op)).toBe(false);
        expect(op.irreversible).toBe('irr_latching');
    });

    it('pairs the fuel-pump relay with its own off job, both directions', () => {
        expect(jobOperation(job('STEUERN_EKP', 'Kraftstoffpumpenrelais ansteuern'), 'mss54').stopJob).toBe(
            'STEUERN_EKP_AUS',
        );
        expect(jobOperation(job('STEUERN_EKP_AUS', 'Kraftstoffpumpe (Relais) ausschalten'), 'mss54').stopJob).toBe(
            'STEUERN_EKP',
        );
    });

    it('pairs the throttle-correction test run with its stop job', () => {
        const op = jobOperation(
            job('STEUERN_TI_ABGLEICH_STARTEN', 'Anstossen der automatischen Einzeldrosselklappenkorrektur (Prueflauf)'),
            'mss54',
        );
        expect(op.kind).toBe('paired');
        expect(op.stopJob).toBe('STEUERN_TI_ABGLEICH_STOPPEN');
        expect(hasStopControl(op)).toBe(true);
    });

    it('classifies a persistent write as irreversible', () => {
        const op = jobOperation(job('CODIERDATEN_SCHREIBEN', 'Codierdaten schreiben'), 'smg2');
        expect(op.kind).toBe('write');
        expect(op.irreversible).toBe('irr_write');
    });

    it('reads "anstossen" as a measurement the ECU finishes by itself', () => {
        const op = jobOperation(job('STEUERN_EVANOS1_DICHTHEIT', 'Dichtheitmessung EVANOS1 anstossen'), 'mss54');
        expect(op.kind).toBe('measurement');
        expect(hasStopControl(op)).toBe(false);
    });

    it('says "unknown" rather than guessing when the SGBD comment is silent', () => {
        const op = jobOperation(job('IRGENDWAS'), 'mss54');
        expect(op.kind).toBe('unknown');
    });
});

describe('the SMG II prepare requirement', () => {
    // Quoted from SMG2.prg: "For starter release, hydraulic pump, fault
    // indicator, and shift lock, this job must be sent beforehand!"
    it('puts ANSTEUERUNG_VORBEREITEN first and carries the ECU timings', () => {
        const op = jobOperation(job('STEUERN_STELLGLIED', 'Stellglied', ['STELLGL', 'STEUERART1', 'STEUERART2']), 'smg2');
        expect(op.kind).toBe('hold');
        expect(op.steps[0].job).toBe('ANSTEUERUNG_VORBEREITEN');
        expect(op.steps[0].required).toBe(true);
        expect(op.ecuTimeoutSec).toBe(10);
        expect(op.maxHoldSec).toBe(60);
    });

    // The rule is stated in SMG2.prg. Asserting it for a module that never
    // claimed it would be as wrong as missing it where it applies.
    it('does NOT apply the rule to another module with the same job name', () => {
        const op = jobOperation(job('STEUERN_STELLGLIED', 'Stellglied', ['STELLGL']), 'mss54');
        expect(op.steps[0].job).not.toBe('ANSTEUERUNG_VORBEREITEN');
    });
});

describe('SMG II test programs', () => {
    it('sends TESTPRG_STOP before TESTPRG_STARTEN, as the SGBD demands', () => {
        const op = jobOperation(job(`${PROCEDURE_PREFIX}0x07`), 'smg2');
        expect(op.kind).toBe('procedure');
        expect(op.steps[0].job).toBe('TESTPRG_STOP');
        expect(op.steps[1].job).toBe('TESTPRG_STARTEN');
        expect(op.stopJob).toBe('TESTPRG_STOP');
    });

    it('polls for progress and keeps the 10s session alive', () => {
        const op = jobOperation(job(`${PROCEDURE_PREFIX}0x05`), 'smg2');
        expect(op.steps.map((s) => s.job)).toContain('STATUS_TESTPRG');
        expect(op.steps.map((s) => s.job)).toContain('DIAGNOSE_ERHALTEN');
        expect(op.ecuTimeoutSec).toBe(10);
        expect(reportsProgress(op)).toBe(true);
        expect(hasStopControl(op)).toBe(true);
    });

    // A 16-minute gearbox adaptation described as "the SGBD does not say" would
    // be worse than no description at all.
    it('never falls through to unknown, whatever the program number', () => {
        for (const id of ['0x01', '0x0A', '0x15', '0xZZ']) {
            expect(jobOperation(job(`${PROCEDURE_PREFIX}${id}`), 'smg2').kind).toBe('procedure');
        }
    });
});

describe('only shapes that can genuinely be stopped offer a stop', () => {
    const stoppable: Array<[string, string | undefined, string[] | undefined]> = [
        ['STEUERN_DMTL_HEIZUNG', 'x', ['SCHALTEN']],
        ['STEUERN_EKP', 'Kraftstoffpumpenrelais ansteuern', undefined],
        [`${PROCEDURE_PREFIX}0x01`, undefined, undefined],
    ];
    const notStoppable: Array<[string, string | undefined]> = [
        ['STEUERN_EV1', 'Einspritzventil 1 ansteuern'],
        ['DSC_SIM_VA', 'halten'],
        ['ABGLEICHWERTE_LESEN', 'Lesen'],
        ['SG_RESET', 'Software-Reset'],
    ];

    it.each(stoppable)('%s offers a stop', (id, de, args) => {
        expect(hasStopControl(jobOperation(job(id, de, args), 'smg2'))).toBe(true);
    });

    it.each(notStoppable)('%s does not', (id, de) => {
        expect(hasStopControl(jobOperation(job(id, de), 'mss54'))).toBe(false);
    });
});

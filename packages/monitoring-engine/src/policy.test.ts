import { describe, expect, it } from 'vitest';
import type { EcuIndex, EcuProfile } from './ecuCatalog.ts';
import { NATURES, OWNER_DECISION, decisionFor, isReadNature, natureOf, type Nature } from './policy.ts';
import { HAVE_SHIPPED_DATA, readShipped } from './testing/shipped.ts';

const j = (id: string, cls: string) => ({ id, class: cls }) as Parameters<typeof natureOf>[1];

describe('a job’s nature (the owner’s decision, 2026-11-15, is by nature)', () => {
    it('judges the examples the decision page showed', () => {
        const cases: [string, string, string, string | undefined, Nature, string[]?][] = [
            ['smg2', 'TESTPRG_STARTEN', 'calibration', 'drivetrain', 'p_smg'],
            ['smg2', 'STEUERN_STELLGLIED', 'test', 'drivetrain', 'a_smg', ['HYDROPUMPE']],
            ['smg2', 'STEUERN_STELLGLIED', 'test', 'drivetrain', 'a_disp', ['STOERANZEIGE']],
            ['smg2', 'ANSTEUERUNG_VORBEREITEN', 'unclassified', 'drivetrain', 'a_smg'],
            ['dsc_e46', 'DRUCKHALTEN', 'test', 'chassis', 'a_brake'],
            ['dsc_mk60', 'STEUERN_DIGITAL_WARNLAMPEN', 'test', 'chassis', 'a_disp'],
            ['dsc_mk60', 'LENKWINKEL_DSC_ABGLEICHEN', 'calibration', 'chassis', 'c_adapt'],
            ['kombi46', 'STEUERN_GONG3', 'test', 'body', 'a_disp'],
            ['ihka46', 'STEUERN_GEBLAESE', 'test', 'comfort', 'a_comfort'],
            ['radio', 'STEUERN_VOL_UP', 'test', 'comm', 'a_av'],
            ['mss54', 'STEUERN_EKP', 'test', 'engine', 'a_engine'],
            ['mss54', 'START_SYSTEMCHECK_DMTL', 'test', 'engine', 'c_check'],
            ['mss54', 'STATUS_TANK_DICHTHEIT', 'test', 'engine', 'c_check'],
            ['lsz', 'STEUERN_DIMMER', 'test', 'body', 'c_sim'],
            ['ueb2', 'STEUERN_BUEGEL', 'test', 'safety', 'a_safety'],
            ['ews3', 'STEUERN_DIGITAL', 'test', 'safety', 'a_body'],
            ['mss54', 'EWS3_SYNC', 'calibration', 'engine', 'c_setup'],
            ['zke5', 'SLEEP_MODE', 'unclassified', 'body', 'c_mode'],
            ['mss54', 'FS_LOESCHEN', 'calibration', 'engine', 'c_clear'],
            ['navmk4', 'READ_CODING_DATA', 'unclassified', 'comm', 'r_misc'],
            ['mss54', 'STATUS_LAMBDA', 'read', 'engine', 'r_status'],
            ['mss54', 'IDENT', 'read', 'engine', 'r_ident'],
        ];
        for (const [m, id, cls, group, want, args] of cases) expect(natureOf(m, j(id, cls), group, args), `${m}.${id}`).toBe(want);
    });

    it('never takes a write for anything else, whatever else its name says', () => {
        for (const id of ['WRITE_IDENT', 'IDENT_SCHREIBEN_18_BYTES', 'IDENT_VIN_SCHREIBEN', 'ABGLEICHWERTE_SCHREIBEN', 'SPEICHER_SCHREIBEN', 'FLASH_SCHREIBEN', 'CODIERDATEN_SCHREIBEN']) {
            for (const cls of ['test', 'calibration', 'unclassified', 'coding', 'identity', 'programming']) expect(natureOf('x', j(id, cls)), `${id} ${cls}`).toBe('w');
        }
    });

    it('has a decision for every nature, and drives nothing while moving', () => {
        for (const { nature } of NATURES) {
            const d = OWNER_DECISION[nature];
            expect(d, nature).toBeDefined();
            if (!isReadNature(nature)) expect(d.when, nature).toBe('parked');
        }
        expect(OWNER_DECISION.a_brake).toEqual({ when: 'parked', how: 'run', who: 'screen' });
        expect(OWNER_DECISION.w.how).toBe('off');
        expect(OWNER_DECISION.a_safety.how).toBe('off');
        expect(decisionFor('smg2', j('TESTPRG_STARTEN', 'calibration'))).toMatchObject({ nature: 'p_smg', how: 'run', who: 'screen' });
    });
});

describe.skipIf(!HAVE_SHIPPED_DATA)('every shipped job has a nature', () => {
    it('and no job whose name writes is anything but a write', () => {
        const index = readShipped<EcuIndex>('index.json');
        for (const m of index.modules) {
            let p: EcuProfile;
            try {
                p = readShipped<EcuProfile>(`${m.id}.jobs.json`);
            } catch {
                continue;
            }
            for (const job of p.jobs) {
                const n = natureOf(m.id, job, m.group);
                expect(NATURES.some((x) => x.nature === n), `${m.id}.${job.id}`).toBe(true);
                if (/SCHREIBEN|^WRITE_|FLASH_|CODIER.*SCHREIB/.test(job.id) && job.class !== 'read') expect(n, `${m.id}.${job.id}`).toBe('w');
            }
        }
    });
});

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    PROCEDURE_OP,
    PROCEDURE_PREFIX,
    deliversResultElsewhere,
    hasStopControl,
    jobOperation,
    operationFor,
    procedureOperation,
    reportsProgress,
} from './jobOps';
import type { CatalogJob, EcuProfile } from './ecuCatalog';

/**
 * These tests used to build fake `CatalogJob`s and assert what the classifier in
 * this file made of them. That tested a regex against another regex: the fixture
 * and the code under test both came out of the same head, so the pair could agree
 * perfectly while the SHIPPED data said something else — which is exactly what
 * happened, for 192 jobs.
 *
 * So every case below now reads the real generated `public/ecu-data/*.jobs.json`.
 * A test failing here means the data changed, which is the only thing worth being
 * told about. The assertions are the same 22, one per original case, plus the
 * shapes that had no coverage because they had no implementation.
 */

const DATA = path.resolve(import.meta.dirname, '..', '..', 'public', 'ecu-data');
const MODULES = ['mss54', 'smg2', 'dsc_e46'] as const;
type ModuleId = (typeof MODULES)[number];

const profiles = new Map<ModuleId, EcuProfile>();
function profile(m: ModuleId): EcuProfile {
    let p = profiles.get(m);
    if (!p) {
        p = JSON.parse(readFileSync(path.join(DATA, `${m}.jobs.json`), 'utf-8')) as EcuProfile;
        profiles.set(m, p);
    }
    return p;
}

function job(m: ModuleId, id: string): CatalogJob {
    const hit = profile(m).jobs.find((j) => j.id === id);
    // A silently-absent job would make every assertion below vacuous, which is
    // the failure mode that let jobs disappear in the first place.
    if (!hit) throw new Error(`${m} has no job ${id}`);
    return hit;
}

const op = (m: ModuleId, id: string) => jobOperation(job(m, id));

describe('operation shape', () => {
    it('classifies a read as changing nothing and needing no stop', () => {
        const o = op('mss54', 'ABGLEICHWERTE_LESEN');
        expect(o.kind).toBe('read');
        expect(hasStopControl(o)).toBe(false);
        expect(o.irreversible).toBeUndefined();
    });

    it('classifies a plain actuation as a pulse with nothing to stop', () => {
        const o = op('mss54', 'STEUERN_EV1');
        expect(o.kind).toBe('pulse');
        expect(hasStopControl(o)).toBe(false);
    });

    // The SCHALTEN argument IS the switch, so this one holds. Getting it wrong
    // means no STOP control on a job that leaves an output energised.
    it('treats a SCHALTEN argument as a held output', () => {
        const o = op('mss54', 'STEUERN_DMTL_HEIZUNG');
        expect(o.kind).toBe('hold');
        expect(hasStopControl(o)).toBe(true);
        expect(o.stopJob).toBe('STEUERN_DMTL_HEIZUNG');
    });

    // Sending the same job again is what releases it. The plan has to say so
    // twice, because the second send is the step people forget.
    it('spells the release out as its own step when the stop job is itself', () => {
        const o = op('mss54', 'STEUERN_DMTL_HEIZUNG');
        expect(o.steps.map((s) => s.why)).toEqual(['why_switchOn', 'why_switchOff']);
    });

    it('treats a direct pin drive as a held output, and says why it is dangerous', () => {
        const o = op('mss54', 'IO_STATUS_VORGEBEN');
        expect(o.kind).toBe('hold');
        expect(o.irreversible).toBe('irr_pin');
        expect(o.steps[0].why).toBe('why_pinDrive');
    });

    it('stops the pin drive with duty zero, and changes nothing else', () => {
        // The SGBD says how to stop it in the argument's own comment:
        //   TASTVERHAELTNIS: "00 Stellglied nicht angesteuert, ff staendig angesteuert"
        // so the release is this job again at duty 0, not a second job.
        //
        // It must stay a PARTIAL override. PERIODENDAUER is documented "00 ungueltig",
        // so a stop frame that filled in every argument would send an invalid period;
        // the operator's own period has to survive into the release.
        const o = op('mss54', 'IO_STATUS_VORGEBEN');
        expect(o.stopJob).toBe('IO_STATUS_VORGEBEN');
        expect(o.stopArgs).toEqual({ TASTVERHAELTNIS: '0' });
        expect(Object.keys(o.stopArgs!)).not.toContain('PERIODENDAUER');
        expect(Object.keys(o.stopArgs!)).not.toContain('PIN_NUMMER');
    });

    // DSC_SIM_* actuates and holds, and the SGBD exposes no release job. The UI
    // must not offer a STOP that cannot work.
    it('marks DSC_SIM_* as latching with NO stop control', () => {
        const o = op('dsc_e46', 'DSC_SIM_VA');
        expect(o.kind).toBe('latching');
        expect(o.termination).toBe('none');
        expect(hasStopControl(o)).toBe(false);
        expect(o.irreversible).toBe('irr_latching');
    });

    it('pairs the fuel-pump relay with its own off job, both directions', () => {
        expect(op('mss54', 'STEUERN_EKP').stopJob).toBe('STEUERN_EKP_AUS');
        expect(op('mss54', 'STEUERN_EKP_AUS').stopJob).toBe('STEUERN_EKP');
    });

    // The fuel pump is a hazardous actuator whichever end of the pair you are
    // holding. This was medium-risk with a voltage check only, because the rule
    // lived inside the single-shot branch and the paired branch returned first.
    it('keeps the fuel-pump relay high-risk despite being a paired job', () => {
        for (const id of ['STEUERN_EKP', 'STEUERN_EKP_AUS']) {
            const j = job('mss54', id);
            expect(j.risk).toBe('high');
            expect(j.preconditions).toContain('engine_off');
        }
    });

    it('pairs the throttle-correction test run with its stop job', () => {
        const o = op('mss54', 'STEUERN_TI_ABGLEICH_STARTEN');
        expect(o.kind).toBe('paired');
        expect(o.stopJob).toBe('STEUERN_TI_ABGLEICH_STOPPEN');
        expect(hasStopControl(o)).toBe(true);
    });

    it('words the two ends of a pair differently', () => {
        expect(op('mss54', 'STEUERN_TI_ABGLEICH_STARTEN').steps[0].why).toBe('why_pairStart');
        expect(op('mss54', 'STEUERN_TI_ABGLEICH_STOPPEN').steps[0].why).toBe('why_pairStop');
    });

    it('classifies a persistent write as irreversible', () => {
        const o = op('smg2', 'CODIERDATEN_SCHREIBEN');
        expect(o.kind).toBe('write');
        expect(o.irreversible).toBe('irr_write');
    });

    it('reads "anstossen" as a measurement the ECU finishes by itself', () => {
        const o = op('mss54', 'STEUERN_EVANOS1_DICHTHEIT');
        expect(o.kind).toBe('measurement');
        expect(hasStopControl(o)).toBe(false);
    });

    // Not "no job anywhere is unknown" — some genuinely are, and saying so is the
    // point. What must not happen is an unknown that the SGBD did describe.
    it('says "unknown" only where the SGBD offered nothing to go on', () => {
        for (const m of MODULES) {
            for (const j of profile(m).jobs) {
                if (j.op.kind !== 'unknown') continue;
                expect(j.op.provenance).toBe('name-heuristic');
                expect(j.desc).toBeUndefined();
            }
        }
    });
});

describe('the SMG II prepare requirement', () => {
    // Quoted from SMG2.prg: "For starter release, hydraulic pump, fault
    // indicator, and shift lock, this job must be sent beforehand!"
    it('puts ANSTEUERUNG_VORBEREITEN first and carries the ECU timings', () => {
        const o = op('smg2', 'STEUERN_STELLGLIED');
        expect(o.kind).toBe('hold');
        expect(o.steps[0].job).toBe('ANSTEUERUNG_VORBEREITEN');
        expect(o.steps[0].why).toBe('why_prepare');
        expect(o.steps[0].required).toBe(true);
        expect(o.ecuTimeoutSec).toBe(10);
        expect(o.maxHoldSec).toBe(60);
    });

    // The rule is stated in SMG2.prg. Asserting it for a module that never
    // claimed it would be as wrong as missing it where it applies. The scoping
    // now lives in the data, so this is a statement about the whole catalogue
    // rather than about one hand-made fixture.
    it('is claimed by SMG II and by nothing else', () => {
        for (const m of MODULES) {
            for (const j of profile(m).jobs) {
                if ((j.op.prerequisiteJobs ?? []).includes('ANSTEUERUNG_VORBEREITEN')) expect(m).toBe('smg2');
            }
        }
    });

    // The keep-alive is what stops a 60-second actuation dying at 10.
    it('keeps the session alive for anything with a stated ECU timeout', () => {
        for (const m of MODULES) {
            for (const j of profile(m).jobs) {
                if (j.op.ecuTimeoutSec === undefined) continue;
                expect(jobOperation(j).steps.map((s) => s.job)).toContain('DIAGNOSE_AUFRECHT');
            }
        }
    });
});

describe('SMG II test programs', () => {
    it('sends TESTPRG_STOP before TESTPRG_STARTEN, as the SGBD demands', () => {
        const o = op('smg2', 'TESTPRG_STARTEN');
        expect(o.kind).toBe('procedure');
        expect(o.steps[0].job).toBe('TESTPRG_STOP');
        expect(o.steps[1].job).toBe('TESTPRG_STARTEN');
        expect(o.stopJob).toBe('TESTPRG_STOP');
    });

    // This test used to assert `STATUS_TESTPRG` and `DIAGNOSE_ERHALTEN` — it was
    // encoding the bug rather than catching it, because it only ever compared
    // the plan against itself. Neither name exists among SMG II's 46 jobs.
    //
    // The SGBD said so all along, on `TEST_STATUS_BYTE`: "Job muss kontinuierlich
    // angestossen werden ... Job solange anstossen, bis dieses Result ungleich 1
    // liefert!" — progress comes from RE-SENDING TESTPRG_STARTEN. INPA's
    // SMG2.IPO does exactly that, and calls DIAGNOSE_AUFRECHT to hold the
    // session open.
    it('polls by re-sending itself, and keeps the 10s session alive', () => {
        const o = op('smg2', 'TESTPRG_STARTEN');
        expect(o.resultJob).toBe('TESTPRG_STARTEN');
        expect(o.steps.filter((s) => s.job === 'TESTPRG_STARTEN')).toHaveLength(2);
        expect(o.steps.map((s) => s.job)).toContain('DIAGNOSE_AUFRECHT');
        expect(o.steps.map((s) => s.job)).not.toContain('STATUS_TESTPRG');
        expect(o.ecuTimeoutSec).toBe(10);
        expect(reportsProgress(o)).toBe(true);
        expect(hasStopControl(o)).toBe(true);
    });

    // A 16-minute gearbox adaptation described as "the SGBD does not say" would
    // be worse than no description at all. These ids are adapted from
    // smg2-workflows.json and are deliberately NOT SGBD jobs, so they take the
    // one builder in the module rather than reading data that does not exist.
    it('never falls through to unknown, whatever the program number', () => {
        for (const id of ['0x01', '0x0A', '0x15', '0xZZ']) {
            const o = procedureOperation(`${PROCEDURE_PREFIX}${id}`, false);
            expect(o.kind).toBe('procedure');
            expect(o.steps[0].job).toBe('TESTPRG_STOP');
            expect(hasStopControl(o)).toBe(true);
        }
    });
});

describe('deferred tests: the answer arrives from a different job', () => {
    // These four are the emissions checks an owner actually gets failed on, and
    // all four were invisible before: the shape did not exist, so the generator
    // dropped them. Showing the START without the READ would be worse than not
    // showing them at all.
    const deferred = [
        ['START_SYSTEMCHECK_SEK_LUFT', 'LESEN_SYSTEMCHECK_SEK_LUFT'],
        ['START_SYSTEMCHECK_TANK_LECK', 'LESEN_SYSTEMCHECK_TANK_LECK'],
        ['START_SYSTEMCHECK_DMTL', 'LESEN_SYSTEMCHECK_DMTL'],
        ['START_SYSTEMCHECK_TEV_FUNC', 'LESEN_SYSTEMCHECK_TEV_FUNC'],
    ] as const;

    it.each(deferred)('%s names %s as where the verdict comes from', (start, read) => {
        const o = op('mss54', start);
        expect(o.kind).toBe('deferred');
        expect(o.resultJob).toBe(read);
        expect(deliversResultElsewhere(o)).toBe(true);
        expect(o.steps.map((s) => s.job)).toContain(read);
        // The reader has to exist, or the pair is a dead end.
        expect(() => job('mss54', read)).not.toThrow();
    });

    // Only secondary air has a STOP in the SGBD. Two jobs of the same kind
    // differing here is why the stop control reads `termination`, not `kind`.
    it('offers a stop for secondary air and for none of the others', () => {
        expect(hasStopControl(op('mss54', 'START_SYSTEMCHECK_SEK_LUFT'))).toBe(true);
        for (const [start] of deferred.slice(1)) expect(hasStopControl(op('mss54', start))).toBe(false);
    });
});

describe('only shapes that can genuinely be stopped offer a stop', () => {
    const stoppable: Array<[ModuleId, string]> = [
        ['mss54', 'STEUERN_DMTL_HEIZUNG'],
        ['mss54', 'STEUERN_EKP'],
        ['smg2', 'TESTPRG_STARTEN'],
        ['smg2', 'STEUERN_STELLGLIED'],
    ];
    const notStoppable: Array<[ModuleId, string]> = [
        ['mss54', 'STEUERN_EV1'],
        ['dsc_e46', 'DSC_SIM_VA'],
        ['mss54', 'ABGLEICHWERTE_LESEN'],
        ['mss54', 'SG_RESET'],
    ];

    it.each(stoppable)('%s %s offers a stop', (m, id) => {
        expect(hasStopControl(op(m, id))).toBe(true);
    });

    it.each(notStoppable)('%s %s does not', (m, id) => {
        expect(hasStopControl(op(m, id))).toBe(false);
    });

    // The invariant behind both lists: a stop control is offered exactly when
    // something can end the operation, and never otherwise.
    it('holds across all 323 jobs', () => {
        let seen = 0;
        for (const m of MODULES) {
            for (const j of profile(m).jobs) {
                seen++;
                const o = jobOperation(j);
                expect(o.steps.length).toBeGreaterThan(0);
                if (o.termination === 'none' || o.termination === 'self') expect(hasStopControl(o)).toBe(false);
                else expect(o.stopJob ?? o.resultJob).toBeTruthy();
            }
        }
        expect(seen).toBe(323);
    });
});

describe('every job name we print is a job that exists', () => {
    // Three did not. `STATUS_TESTPRG` was TESTPRG_STARTEN's resultJob,
    // `DIAGNOSE_ERHALTEN` was the keep-alive step, and `INAKTIV` was
    // STEUERN_STELLGLIED's stopJob — INAKTIV is a value for the STEUERART1
    // ARGUMENT, which is what INPA sends to switch the hydraulic pump off. All
    // three shipped because nothing checked that a named job was real.
    it('holds for prerequisites, stop jobs and result jobs across all 323', () => {
        for (const m of MODULES) {
            const known = new Set(profile(m).jobs.map((j) => j.id));
            for (const j of profile(m).jobs) {
                for (const p of j.op.prerequisiteJobs ?? []) {
                    expect(known.has(p), `${m}.${j.id} prerequisite ${p}`).toBe(true);
                }
                if (j.op.stopJob) expect(known.has(j.op.stopJob), `${m}.${j.id} stop ${j.op.stopJob}`).toBe(true);
                if (j.op.resultJob)
                    expect(known.has(j.op.resultJob), `${m}.${j.id} result ${j.op.resultJob}`).toBe(true);
            }
        }
    });

    // The adapted SMG II procedures are built, not read, so they need the same
    // check — and they are exactly where the phantom names lived longest.
    it('holds for the adapted procedure plan too', () => {
        const known = new Set(profile('smg2').jobs.map((j) => j.id));
        const op = procedureOperation(`${PROCEDURE_PREFIX}0x07`, true);
        for (const s of op.steps) expect(known.has(s.job), `step ${s.job}`).toBe(true);
        expect(known.has(op.stopJob!)).toBe(true);
        expect(known.has(op.resultJob!)).toBe(true);
        // Progress comes from re-sending the same job, per the SGBD and INPA.
        expect(op.resultJob).toBe('TESTPRG_STARTEN');
        expect(op.steps.map((s) => s.job)).toContain('DIAGNOSE_AUFRECHT');
    });

    /**
     * The test above was not enough, and the gap shipped.
     *
     * It exercised `procedureOperation()` — the function that had been fixed —
     * while the DETAIL PANEL took its plan from `job.op`, which for a procedure
     * came from a second, stale copy of the same object in page.tsx. So the
     * panel went on printing `STATUS_TESTPRG` for three commits after the name
     * was "corrected", and this suite stayed green the whole time because it
     * only ever checked the copy that had been edited.
     *
     * This goes through `operationFor()` — the one dispatcher both the controls
     * and the panel now use — starting from a job shaped exactly as
     * `procedureAsJob()` builds one, `PROCEDURE_OP` included. Every job named in
     * the resulting plan must be a real SMG II job.
     */
    it('holds for the plan the DETAIL PANEL renders, not just the builder', () => {
        const known = new Set(profile('smg2').jobs.map((j) => j.id));
        const asPanelSeesIt = {
            ...profile('smg2').jobs[0],
            id: `${PROCEDURE_PREFIX}0x07`,
            op: PROCEDURE_OP,
            args: [],
        } as CatalogJob;

        const op = operationFor(asPanelSeesIt);
        for (const s of op.steps) expect(known.has(s.job), `step ${s.job}`).toBe(true);
        // The synthetic id is NOT a job. The wire job is TESTPRG_STARTEN with a
        // program number, and naming `TESTPRG:0x07` as a step would be an
        // instruction that cannot be carried out.
        expect(op.steps.map((s) => s.job)).not.toContain(`${PROCEDURE_PREFIX}0x07`);
        expect(op.steps.map((s) => s.job)).not.toContain('STATUS_TESTPRG');
        // The two definitions agreed on everything except this, and this is what
        // was on screen.
        expect(PROCEDURE_OP.resultJob).toBe('TESTPRG_STARTEN');
        expect(PROCEDURE_OP.resultDelivery).toBe('inline');
    });

    // Stopping STEUERN_STELLGLIED means an argument, not another job.
    it('expresses an argument-valued stop as arguments', () => {
        const o = op('smg2', 'STEUERN_STELLGLIED');
        expect(o.stopJob).toBe('STEUERN_STELLGLIED');
        expect(o.stopArgs).toEqual({ STEUERART1: 'INAKTIV' });
    });
});

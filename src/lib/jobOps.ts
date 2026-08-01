'use client';

/**
 * What a job actually DOES — its operation shape, its steps, and how it stops.
 *
 * A job list that shows only a name and a RUN button is a menu, not an
 * instrument. These jobs are not interchangeable one-shots: some are reads, some
 * energise a coil until you stop them, one latches with no release job in the
 * SGBD at all, several are multi-step processes the ECU runs by itself and
 * reports progress on, and two modules require a specific job to be sent FIRST
 * or the ECU refuses. Pressing the same button for all of those would be a lie
 * about the machine.
 *
 * ## Everything here is derived from the SGBD, not invented
 *
 * The classifications below come from three sources, in order of authority:
 *
 *   1. The job's own German comment. The SGBD states the protocol outright —
 *      SMG II's ANSTEUERUNG_VORBEREITEN says "For starter release, hydraulic
 *      pump, fault indicator and shift lock, this job must be sent beforehand!
 *      (ECU timeout: 10s!) ... actuation remains active for max. 60s", and
 *      TESTPRG_STOP says "Must be sent BEFORE TESTPRG_STARTEN!". Those are not
 *      guesses.
 *   2. The argument signature. `SCHALTEN` is an on/off switch, so the job holds.
 *      `PIN_NUMMER / TASTVERHAELTNIS / PERIODENDAUER` is a direct pin drive with
 *      a duty cycle, so it holds. `AUSWAHL` selects which block or gear.
 *   3. The name, as a last resort — `_LESEN` reads, `_SCHREIBEN` writes,
 *      `anstossen` ("trigger") starts a measurement that finishes on its own.
 *
 * Where the SGBD does not say, this says so rather than picking a default. An
 * `unknown` shape is a fact about our knowledge, and the UI prints it.
 */

import type { CatalogJob } from './ecuCatalog';

/**
 * The operation shapes, and why each is distinct.
 *
 * These are not styling variants. Each one implies a different control surface,
 * a different failure mode, and a different obligation on the operator.
 */
export type OpKind =
    /** One exchange, returns data, changes nothing. Safe to repeat. */
    | 'read'
    /** One-shot actuation that ends by itself. RUN only; nothing to stop. */
    | 'pulse'
    /** Stays energised until something stops it. Needs RUN → STOP and a deadman. */
    | 'hold'
    /** Holds, and a DIFFERENT named job is what switches it off. */
    | 'paired'
    /** Triggers a measurement the ECU runs and finishes; the result lands in a live block. */
    | 'measurement'
    /** Actuates and latches. No release job exists in the SGBD — this cannot be undone from here. */
    | 'latching'
    /** The SGBD job itself drives several outputs in sequence. */
    | 'compound'
    /** A multi-step program the ECU runs, reporting progress; abortable. */
    | 'procedure'
    /** Writes persistent state — coding, adaptations, calibration values. */
    | 'write'
    /** The SGBD does not say, and neither will we. */
    | 'unknown';

/**
 * Why a step exists — as a KEY, not as prose.
 *
 * These sentences are safety copy: they are what tells an operator that a step
 * is mandatory, that an output will stay live, or that the ECU will drop the
 * session in ten seconds. Safety copy is written in the reader's language, so it
 * lives in the copy module and this file emits keys into it. Returning English
 * strings from here is the same mistake the electrical-fault checklist made —
 * five English sentences under a Japanese heading, on the one screen whose whole
 * job is to stop someone doing the wrong thing.
 */
export type WhyKey =
    | 'why_read'
    | 'why_pulse'
    | 'why_write'
    | 'why_measure'
    | 'why_latching'
    | 'why_multiOutput'
    | 'why_driveAndReset'
    | 'why_switchOn'
    | 'why_switchOff'
    | 'why_pinDrive'
    | 'why_pairStart'
    | 'why_pairStop'
    | 'why_prepare'
    | 'why_driveActuator'
    | 'why_keepAlive'
    | 'why_testprgStop'
    | 'why_testprgStart'
    | 'why_testprgPoll'
    | 'why_unknown';

/** Why an operation cannot be taken back. Also safety copy, also a key. */
export type IrreversibleKey = 'irr_latching' | 'irr_pin' | 'irr_write';

/** One step in the plan, in the order it goes out on the wire. */
export interface OpStep {
    /** The SGBD job name, or a protocol action that is not itself a job. */
    job: string;
    /** Why this step exists. Quoted from the SGBD where the SGBD says it. */
    why: WhyKey;
    /** True when skipping it makes the ECU refuse or misbehave. */
    required: boolean;
}

export interface JobOperation {
    kind: OpKind;
    /** The ordered plan. Always at least one step. */
    steps: OpStep[];
    /** The job that ends this one, when a named counterpart exists. */
    stopJob?: string;
    /**
     * The ECU's own diagnostic-session timeout, in seconds. Miss it and the
     * actuation drops — which is a SAFETY PROPERTY, not a nuisance: it is what
     * limits the damage when the browser dies mid-actuation.
     */
    ecuTimeoutSec?: number;
    /** How long the ECU will hold the output at most, even with keep-alive. */
    maxHoldSec?: number;
    /** True when the operator must supply argument values before anything is sent. */
    needsArgs: boolean;
    /** Stated when the operation cannot be reversed from this app. */
    irreversible?: IrreversibleKey;
}

/** Jobs whose German comment names an explicit counterpart. Pairs, both ways. */
const PAIRS: Record<string, string> = {
    // "Kraftstoffpumpenrelais ansteuern" / "Kraftstoffpumpe (Relais) ausschalten"
    STEUERN_EKP: 'STEUERN_EKP_AUS',
    STEUERN_EKP_AUS: 'STEUERN_EKP',
    // "Anstossen der automatischen Einzeldrosselklappenkorrektur (Prueflauf)" /
    // "Unterbrechen der ... (Prueflauf)"
    STEUERN_TI_ABGLEICH_STARTEN: 'STEUERN_TI_ABGLEICH_STOPPEN',
    STEUERN_TI_ABGLEICH_STOPPEN: 'STEUERN_TI_ABGLEICH_STARTEN',
    // "Stop a running test program / Must be sent BEFORE TESTPRG_STARTEN!"
    TESTPRG_STARTEN: 'TESTPRG_STOP',
    TESTPRG_STOP: 'TESTPRG_STARTEN',
};

/**
 * SMG II: the jobs the SGBD says need ANSTEUERUNG_VORBEREITEN sent first.
 *
 * Quoted: "For starter release, hydraulic pump, fault indicator, and shift lock,
 * this job must be sent beforehand!" STEUERN_STELLGLIED can address any of those
 * through its STELLGL argument, so the prepare step is required for the job as a
 * whole — we cannot know which pin the operator will pick.
 */
const NEEDS_PREPARE = new Set(['STEUERN_STELLGLIED']);

/** The SMG II actuation window, from the SGBD comment on ANSTEUERUNG_VORBEREITEN. */
const SMG2_ECU_TIMEOUT_SEC = 10;
const SMG2_MAX_HOLD_SEC = 60;

/**
 * Marks a job adapted from an SMG II test program rather than read from the
 * SGBD job table. Kept here beside the classifier that has to recognise it.
 */
export const PROCEDURE_PREFIX = 'TESTPRG:';

export function jobOperation(job: CatalogJob, moduleId: string): JobOperation {
    // An adapted SMG II test program. Its shape is not guessable from its id,
    // and it must never fall through to `unknown` — a 16-minute gearbox
    // adaptation described as "the SGBD does not say" would be worse than no
    // description at all.
    if (job.id.startsWith(PROCEDURE_PREFIX)) {
        return {
            kind: 'procedure',
            steps: [
                {
                    job: 'TESTPRG_STOP',
                    why: 'why_testprgStop',
                    required: true,
                },
                {
                    job: 'TESTPRG_STARTEN',
                    why: 'why_testprgStart',
                    required: true,
                },
                {
                    job: 'STATUS_TESTPRG',
                    why: 'why_testprgPoll',
                    required: true,
                },
                {
                    job: 'DIAGNOSE_ERHALTEN',
                    why: 'why_keepAlive',
                    required: true,
                },
            ],
            stopJob: 'TESTPRG_STOP',
            ecuTimeoutSec: SMG2_ECU_TIMEOUT_SEC,
            needsArgs: (job.args ?? []).length > 0,
        };
    }

    const id = job.id.toUpperCase();
    const args = job.args ?? [];
    const argNames = args.map((a) => (a.name ?? '').toUpperCase());
    const de = (job.desc?.de ?? '').toLowerCase();
    const needsArgs = args.length > 0;

    const one = (why: WhyKey): OpStep[] => [{ job: job.id, why, required: true }];

    // --- Reads. Nothing changes, so nothing needs stopping. -----------------
    if (/_LESEN$/.test(id) || id.startsWith('STATUS_') || /^GETRIEBEDATEN_LESEN$/.test(id)) {
        return { kind: 'read', steps: one('why_read'), needsArgs };
    }

    // --- SMG II test programs. The SGBD spells the protocol out. ------------
    if (id === 'TESTPRG_STARTEN') {
        return {
            kind: 'procedure',
            steps: [
                {
                    job: 'TESTPRG_STOP',
                    why: 'why_testprgStop',
                    required: true,
                },
                { job: 'TESTPRG_STARTEN', why: 'why_testprgStart', required: true },
                { job: 'STATUS_TESTPRG', why: 'why_testprgPoll', required: true },
            ],
            stopJob: 'TESTPRG_STOP',
            ecuTimeoutSec: SMG2_ECU_TIMEOUT_SEC,
            needsArgs,
        };
    }

    // Scoped to SMG II. The prepare requirement is stated in SMG2.prg's own
    // comment; another module could ship a job of the same name with no such
    // rule, and asserting one it does not have is as wrong as missing one it
    // does.
    if (moduleId === 'smg2' && NEEDS_PREPARE.has(id)) {
        return {
            kind: 'hold',
            steps: [
                {
                    job: 'ANSTEUERUNG_VORBEREITEN',
                    why: 'why_prepare',
                    required: true,
                },
                { job: job.id, why: 'why_driveActuator', required: true },
                {
                    job: 'DIAGNOSE_ERHALTEN',
                    why: 'why_keepAlive',
                    required: true,
                },
            ],
            stopJob: 'INAKTIV',
            ecuTimeoutSec: SMG2_ECU_TIMEOUT_SEC,
            maxHoldSec: SMG2_MAX_HOLD_SEC,
            needsArgs,
        };
    }

    // --- Latching. DSC_SIM_* actuates and holds, and the SGBD exposes no ----
    // release job at all. The UI must not imply this can be undone.
    if (id.startsWith('DSC_SIM_')) {
        return {
            kind: 'latching',
            steps: one('why_latching'),
            needsArgs,
            irreversible: 'irr_latching',
        };
    }

    // --- Compound. The SGBD job drives several outputs itself. --------------
    if (de.includes('mehrere digitale ausg') || id === 'ABS_REGELSIMULATION') {
        return { kind: 'compound', steps: one('why_multiOutput'), needsArgs };
    }
    if (de.includes('ansteuern und ruecksetzen') || de.includes('drive and reset')) {
        return {
            kind: 'compound',
            steps: one('why_driveAndReset'),
            needsArgs,
        };
    }

    // --- Held outputs, identified by their arguments. -----------------------
    if (argNames.includes('SCHALTEN')) {
        return {
            kind: 'hold',
            steps: [
                { job: job.id, why: 'why_switchOn', required: true },
                { job: job.id, why: 'why_switchOff', required: true },
            ],
            stopJob: job.id,
            needsArgs,
        };
    }
    if (argNames.includes('PIN_NUMMER')) {
        return {
            kind: 'hold',
            steps: one('why_pinDrive'),
            stopJob: job.id,
            needsArgs,
            irreversible: 'irr_pin',
        };
    }

    // --- Named counterparts. ------------------------------------------------
    const partner = PAIRS[id];
    if (partner) {
        const starts = /STARTEN$/.test(id) || (!/(_AUS|_STOPPEN|_STOP)$/.test(id) && true);
        return {
            kind: 'paired',
            steps: one(starts ? 'why_pairStart' : 'why_pairStop'),
            stopJob: partner,
            needsArgs,
        };
    }

    // --- Measurements. "anstossen" = trigger; the ECU finishes on its own. ---
    if (de.includes('anstossen') || de.includes('durchfuehren') || de.includes('prueflauf')) {
        return {
            kind: 'measurement',
            steps: one('why_measure'),
            needsArgs,
        };
    }

    // --- Persistent writes. -------------------------------------------------
    if (/_SCHREIBEN$|_LOESCHEN$|^SG_RESET$|^EDIC_RESET$|^INITIALISIER|^CODIERDATEN|^ADAPT/.test(id)) {
        return {
            kind: 'write',
            steps: one('why_write'),
            needsArgs,
            irreversible: 'irr_write',
        };
    }

    // --- Plain one-shot actuation. "ansteuern" without a switch argument. ----
    if (de.includes('ansteuern') || de.includes('anfahren') || id.startsWith('STEUERN_')) {
        return { kind: 'pulse', steps: one('why_pulse'), needsArgs };
    }

    return { kind: 'unknown', steps: one('why_unknown'), needsArgs };
}

/**
 * Does this operation need a STOP control on screen?
 *
 * `latching` deliberately returns false. It cannot be stopped, and offering a
 * disabled STOP would suggest one exists.
 */
export function hasStopControl(op: JobOperation): boolean {
    return op.kind === 'hold' || op.kind === 'paired' || op.kind === 'procedure';
}

/** Does the ECU report progress while this runs? Only procedures do. */
export function reportsProgress(op: JobOperation): boolean {
    return op.kind === 'procedure';
}

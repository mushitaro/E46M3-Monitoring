'use client';

/**
 * What a job actually DOES — its operation shape, its steps, and how it stops.
 *
 * A job list that shows only a name and a RUN button is a menu, not an
 * instrument. These jobs are not interchangeable one-shots: some are reads, some
 * energise a coil until you stop them, one latches with no release job in the
 * SGBD at all, several are multi-step processes the ECU runs by itself and
 * reports progress on, four start a test whose ANSWER ARRIVES FROM A DIFFERENT
 * JOB, and two modules require a specific job to be sent FIRST or the ECU
 * refuses. Pressing the same button for all of those would be a lie about the
 * machine.
 *
 * ## This file no longer classifies. It reads.
 *
 * It used to re-derive the shape from the job's name and German comment, with
 * regexes that duplicated — and contradicted — the ones in the generator.
 * `ABGLEICHWERTE_LESEN` came out as a `read` here and a "persistent write" there.
 *
 * Classification now happens once, in `tools/sgbd/classify.py`, from the SGBD's
 * own comments and argument signatures, and is baked into `<module>.jobs.json`
 * with a `provenance` saying how it was reached. What remains here is the part
 * that is genuinely a UI concern: turning that data into an ordered plan, and
 * answering the two questions the controls need — does this need a STOP, and
 * does it report progress.
 *
 * The one thing still built rather than read is the SMG II guided procedure,
 * because those are adapted from `smg2-workflows.json` and are not SGBD jobs at
 * all.
 */

import type { Actor, CatalogJob, JobOperationData, ResultDelivery, Termination } from './ecuCatalog';

/**
 * The operation shapes, and why each is distinct.
 *
 * These are not styling variants. Each implies a different control surface, a
 * different failure mode, and a different obligation on the operator.
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
    /**
     * Starts a test and returns nothing useful. The verdict is read LATER, by a
     * named companion job.
     *
     * This shape did not exist before, and its absence is why the four
     * SYSTEMCHECK tests — secondary air, tank leak, DMTL, purge valve, i.e. the
     * emissions checks an owner actually gets failed on — were invisible. Showing
     * the START without the READ is not a partial feature; it is a trap.
     */
    | 'deferred'
    /** Writes persistent state — coding, adaptations, calibration values. */
    | 'write'
    /** The SGBD does not say, and neither will we. */
    | 'unknown';

/**
 * Why a step exists — as a KEY, not as prose.
 *
 * These sentences are safety copy: they are what tells an operator that a step is
 * mandatory, that an output will stay live, or that the ECU will drop the session
 * in ten seconds. Safety copy is written in the reader's language, so it lives in
 * the copy module and this file emits keys into it.
 */
export type WhyKey =
    | 'why_read'
    | 'why_pulse'
    | 'why_write'
    | 'why_measure'
    | 'why_latching'
    | 'why_multiOutput'
    | 'why_switchOn'
    | 'why_switchOff'
    | 'why_pinDrive'
    | 'why_pairStart'
    | 'why_pairStop'
    | 'why_prepare'
    | 'why_prerequisite'
    | 'why_driveActuator'
    | 'why_keepAlive'
    | 'why_testprgStop'
    | 'why_testprgStart'
    | 'why_testprgPoll'
    | 'why_deferredStart'
    | 'why_readResult'
    | 'why_unknown';

/** Why an operation cannot be taken back. Also safety copy, also a key. */
export type IrreversibleKey =
    | 'irr_latching'
    | 'irr_pin'
    | 'irr_write'
    | 'irr_eeprom'
    /**
     * The SGBD provides no counterpart job, and does not say how the effect is undone.
     *
     * Distinct from `irr_latching`, which asserts something stronger — that the effect
     * persists and comes back on an ignition cycle. That claim is true of DSC_SIM_* because
     * the DSC SGBD says so. UEB2's STEUERN_BUEGEL ("Ausfahren des Buegels" — deploy the
     * rollover bar) says nothing of the kind: all 32 of its jobs were read and there is no
     * retract, no reset, no Einfahren, no counterpart of any name. The silence is the fact,
     * and borrowing irr_latching's wording would have the app assert a recovery route the
     * ECU never described.
     */
    | 'irr_no_counterpart';

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
    actor: Actor;
    termination: Termination;
    resultDelivery: ResultDelivery;
    /** The ordered plan. Always at least one step. */
    steps: OpStep[];
    /** The job that ends this one, when a named counterpart exists. */
    stopJob?: string;
    /** When stopping is the same job with different arguments. */
    stopArgs?: Record<string, string>;
    /** The job that carries the answer, when this one does not. */
    resultJob?: string;
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

/**
 * Marks a job adapted from an SMG II test program rather than read from the SGBD
 * job table. Kept here beside the builder that has to recognise it.
 */
export const PROCEDURE_PREFIX = 'TESTPRG:';

/** The SMG II actuation window, from the SGBD comment on ANSTEUERUNG_VORBEREITEN. */
const SMG2_ECU_TIMEOUT_SEC = 10;

/**
 * The job that holds the diagnostic session open: `Diagnosemode aufrechterhalten`.
 *
 * Named once, because the wrong name was written twice and asserted in a test.
 */
const KEEP_ALIVE_JOB = 'DIAGNOSE_AUFRECHT';

/** Prerequisites the SGBD names, and the sentence that explains each one. */
const PREREQ_WHY: Record<string, WhyKey> = {
    TESTPRG_STOP: 'why_testprgStop',
    ANSTEUERUNG_VORBEREITEN: 'why_prepare',
};

function primaryWhy(op: JobOperationData, jobId: string): WhyKey {
    switch (op.kind) {
        case 'read':
            return 'why_read';
        case 'pulse':
            return 'why_pulse';
        case 'hold':
            return op.irreversible === 'irr_pin' ? 'why_pinDrive' : 'why_switchOn';
        case 'paired':
            // This chooses WORDING, never behaviour: whether to call this end of
            // the pair "starts it" or "stops it". The pairing itself is data.
            return /(_AUS|_STOPPEN|_STOP)$/.test(jobId.toUpperCase()) ? 'why_pairStop' : 'why_pairStart';
        case 'measurement':
            return 'why_measure';
        case 'latching':
            return 'why_latching';
        case 'compound':
            return 'why_multiOutput';
        case 'procedure':
            return 'why_testprgStart';
        case 'deferred':
            return 'why_deferredStart';
        case 'write':
            return 'why_write';
        default:
            return 'why_unknown';
    }
}

/**
 * The ordered plan for a job, built from its stated operation data.
 *
 * Everything here is derivable from `job.op`, which is the point: a plan that
 * disagrees with the classification cannot happen, because there is only one
 * source for both.
 */
export function jobOperation(job: CatalogJob): JobOperation {
    const op = job.op;
    const steps: OpStep[] = [];

    for (const p of op.prerequisiteJobs ?? []) {
        steps.push({ job: p, why: PREREQ_WHY[p] ?? 'why_prerequisite', required: true });
    }

    steps.push({ job: job.id, why: primaryWhy(op, job.id), required: true });

    // A hold driven by its own job's on/off argument sends the SAME job again to
    // release. Naming the step twice is not redundancy — the second send is a
    // separate obligation, and it is the one people forget.
    if (op.termination === 'app-stop' && op.stopJob === job.id) {
        steps.push({ job: job.id, why: 'why_switchOff', required: true });
    }

    if (op.resultJob) {
        steps.push({
            job: op.resultJob,
            why: op.kind === 'procedure' ? 'why_testprgPoll' : 'why_readResult',
            required: true,
        });
    }

    // The keep-alive is not optional where the ECU states a timeout: SMG II drops
    // the session after 10 s, and a full gearbox adaptation runs for 960.
    //
    // The job is `DIAGNOSE_AUFRECHT` (`Diagnosemode aufrechterhalten`). This said
    // `DIAGNOSE_ERHALTEN`, which is not one of SMG II's 46 jobs — a name I
    // invented and then asserted in a test, so the test agreed with the plan and
    // both were wrong. INPA's SMG2.IPO calls the real one.
    if (op.ecuTimeoutSec !== undefined) {
        steps.push({ job: KEEP_ALIVE_JOB, why: 'why_keepAlive', required: true });
    }

    return {
        kind: op.kind,
        actor: op.actor,
        termination: op.termination,
        resultDelivery: op.resultDelivery,
        steps,
        stopJob: op.stopJob,
        stopArgs: op.stopArgs,
        resultJob: op.resultJob,
        ecuTimeoutSec: op.ecuTimeoutSec,
        maxHoldSec: op.maxHoldSec,
        needsArgs: job.args.length > 0,
        irreversible: op.irreversible as IrreversibleKey | undefined,
    };
}

/**
 * The `op` DATA an adapted SMG II procedure carries — the same shape an SGBD job
 * has, so `job.op` is never a lie for a procedure either.
 *
 * This existed twice: here in `procedureOperation()`, and as an object literal
 * inside `procedureAsJob()` in page.tsx. They drifted. When the phantom job
 * names were corrected the literal was missed, and because the DETAIL PANEL
 * derived its plan from `job.op` rather than from `procedureOperation()`, the
 * copy on screen stayed the wrong one — still instructing the operator to send
 * `STATUS_TESTPRG`, which is not one of SMG II's 46 jobs. One definition now.
 */
export const PROCEDURE_OP: JobOperationData = {
    kind: 'procedure',
    actor: 'ecu',
    termination: 'companion-job',
    // Progress is read by RE-SENDING TESTPRG_STARTEN, so the answer arrives on
    // the same job — inline, not from a companion.
    resultDelivery: 'inline',
    prerequisiteJobs: ['TESTPRG_STOP'],
    stopJob: 'TESTPRG_STOP',
    resultJob: 'TESTPRG_STARTEN',
    ecuTimeoutSec: SMG2_ECU_TIMEOUT_SEC,
    provenance: 'sgbd-comment',
};

/**
 * The operation for any row the panel can select.
 *
 * An adapted procedure is not an SGBD job: its id is synthetic (`TESTPRG:0x07`)
 * and the job actually sent is `TESTPRG_STARTEN` with that program number. The
 * generic deriver would name the synthetic id as a step, so procedures take
 * their own builder. Both the controls and the detail panel MUST come through
 * here — they used to disagree, and the panel had the wrong one.
 */
export function operationFor(job: CatalogJob): JobOperation {
    return isProcedureId(job.id)
        ? procedureOperation(job.id, job.args.length > 0)
        : jobOperation(job);
}

/**
 * The plan for an SMG II guided procedure.
 *
 * These are adapted from `smg2-workflows.json`, not from the SGBD job table. The
 * protocol is identical for every program number — what differs is the duration,
 * the preconditions and the vocabularies, none of which belong here.
 *
 * It must never fall through to `unknown`: a sixteen-minute gearbox adaptation
 * described as "the SGBD does not say" would be worse than no description at all.
 */
export function procedureOperation(id: string, needsArgs: boolean): JobOperation {
    return {
        kind: 'procedure',
        actor: 'ecu',
        termination: 'companion-job',
        resultDelivery: 'inline',
        steps: [
            { job: 'TESTPRG_STOP', why: 'why_testprgStop', required: true },
            { job: 'TESTPRG_STARTEN', why: 'why_testprgStart', required: true },
            // Progress is read by RE-SENDING the same job, not by a companion.
            // This step used to name `STATUS_TESTPRG` and the keep-alive
            // `DIAGNOSE_ERHALTEN`; neither exists among SMG II's 46 jobs. The
            // SGBD says so on `TEST_STATUS_BYTE` — "Job muss kontinuierlich
            // angestossen werden ... bis dieses Result ungleich 1 liefert!" —
            // and INPA's SMG2.IPO does exactly that, then calls
            // DIAGNOSE_AUFRECHT to hold the 10 s session open.
            { job: 'TESTPRG_STARTEN', why: 'why_testprgPoll', required: true },
            { job: KEEP_ALIVE_JOB, why: 'why_keepAlive', required: true },
        ],
        stopJob: 'TESTPRG_STOP',
        resultJob: 'TESTPRG_STARTEN',
        ecuTimeoutSec: SMG2_ECU_TIMEOUT_SEC,
        needsArgs,
    };
}

/** Is this id one of the adapted SMG II procedures? */
export function isProcedureId(id: string): boolean {
    return id.startsWith(PROCEDURE_PREFIX);
}

/**
 * Does this operation need a STOP control on screen?
 *
 * Read off `termination`, not off a list of kinds. `latching` has termination
 * `none` and therefore gets no STOP — it cannot be stopped, and offering a
 * disabled one would suggest otherwise. A `deferred` SYSTEMCHECK that the SGBD
 * gives no stop job for gets none either, which is why this is data and not a
 * kind whitelist: two jobs of the same kind genuinely differ here.
 */
export function hasStopControl(op: JobOperation): boolean {
    return op.termination === 'app-stop' || op.termination === 'companion-job';
}

/** Does the ECU report progress while this runs? Only procedures do. */
export function reportsProgress(op: JobOperation): boolean {
    return op.kind === 'procedure';
}

/**
 * Is the answer somewhere other than this job's own response?
 *
 * When true the UI must show the companion READ next to the START. Half of a
 * two-job test is not a feature.
 */
export function deliversResultElsewhere(op: JobOperation): boolean {
    return op.resultDelivery === 'companion-job' || op.resultDelivery === 'live-block';
}

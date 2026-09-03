import type { Audience, JobClass, ResultDelivery, ResultRole, Actor, Termination, Risk } from '../ecuCatalog';
import type { IrreversibleKey, OpKind, WhyKey } from '../jobOps';
import type { Chrome } from './chrome';

/**
 * Everything the reader has to READ rather than recognise, in one shape.
 *
 * Structural, so a missing or renamed key in one language is a compile error
 * rather than a runtime `undefined` in the UI. It deliberately does not declare
 * the chrome tokens: those live in `chrome.ts` as one value serving both
 * languages, and leaving them out here is what makes a per-language spelling of
 * them impossible rather than merely discouraged.
 */
export interface Localised {
    connect: string;
    connecting: string;
    connected: string;
    disconnected: string;
    mode: string;
    mode_vehicle: string;
    mode_practice: string;
    ecu: string;
    readIdent: string;
    readFaults: string;
    startLog: string;
    stopLog: string;
    clearLog: string;
    exportLog: string;
    faults_none: string;
    faults_count: (n: number) => string;
    faults_code: string;
    faults_type: string;
    faults_frequency: string;
    faults_logistics: string;
    faults_freezeFrames: string;
    channels: string;
    channels_pick: string;
    datalog_run: string;
    channels_search: string;
    channels_block: string;
    channels_blockNote: (selection: number) => string;
    channels_alsoIn: (blocks: string) => string;
    channels_alsoInNote: string;
    datalog_exportsRun: (n: number) => string;
    faults_read: string;
    faultRef_search: string;
    channels_selected: (n: number, blocks: number) => string;
    rate: string;
    samples: string;
    notSupported_title: string;
    notSupported_body: string;
    error_electrical_title: string;
    error_electrical_body: string;
    error_desync_body: string;
    provenance_title: string;
    search: string;
    run: string;
    risk_all: string;
    risk_high: string;
    risk_medium: string;
    risk_low: string;
    /** The one-time acknowledgement. Safety copy: language-switched, always. */
    disclaimer_title: string;
    disclaimer_lede: string;
    disclaimer_points: string[];
    /** The SMG II guided procedure. */
    wiz_title: (name: string) => string;
    wiz_step: Record<'prereq' | 'safety' | 'run' | 'result', string>;
    wiz_prereq_note: string;
    wiz_safety_ack: string;
    wiz_gear: string;
    wiz_gear_neutral: string;
    wiz_gear_reverse: string;
    wiz_run_note: string;
    wiz_elapsed: string;
    wiz_of: (max: string) => string;
    wiz_status: string;
    wiz_activity: string;
    wiz_raw: string;
    wiz_polls: (n: number) => string;
    wiz_abortOnly: string;
    wiz_result_ok: string;
    wiz_result_bad: string;
    wiz_result_aborted: string;
    wiz_stopSent: string;
    wiz_offsetsInferred: string;
    procBlock: Record<'proc_block_vehicle' | 'proc_block_noJob' | 'proc_block_selection' | 'proc_block_frame', string>;
    /** The visual frame block: what goes out, and whether it will. */
    viz_willSend: string;
    viz_wontSend: string;
    viz_response: string;
    viz_responseNone: string;
    actuator_none: string;
    gate_verified: string;
    gate_unverified: string;
    gate_practiceOnly: string;
    args_required: (names: string) => string;
    precond_voltage_ok: string;
    precond_stationary: string;
    precond_engine_off: string;
    module: string;
    faultRef: string;
    faultRef_note: string;
    catalog_jobs: (n: number) => string;
    cancel: string;
    /** How few of a module's actuator jobs this app can actually send. */
    actuator_runnable: (n: number, total: number) => string;
    actuator_onlyRunnable: string;
    actuator_armed: string;
    gate_plan: string;
    gate_preconditions: string;
    gate_preconditions_none: string;
    gate_caution: string;
    /** The acknowledgement beside an irreversible job. Its own checkbox. */
    gate_ack_irreversible: string;
    gate_unreleasable_title: string;
    gate_unreleasable_body: string;
    gate_ack_unreleasable: string;
    /** What the operator should do after it runs, whatever the answer was. */
    gate_postNote: string;
    /** How certain the frame about to go out is. */
    gate_telegram: Record<'single' | 'multiple' | 'shared', string>;
    viz_faults: string;
    viz_clean: string;
    riskMix: string;
    /** Empty-state copy. Terse, uppercase-technical: what the instrument is
     *  waiting for, not an apology for having nothing. */
    awaiting_read: string;
    awaiting_samples: string;
    awaiting_catalog: string;
    ident_note: (bytes: number) => string;
    /** The physical checklist for an electrical fault. Safety copy lives here,
     *  in the reader's language — not as English literals at the call site. */
    error_electrical_steps: string[];

    // --- The job-operation vocabulary ------------------------------------
    // Every one of these is safety copy: it tells the operator whether the
    // thing they are about to press ends by itself, has to be stopped by hand,
    // or cannot be undone at all.
    plan_kind: string;
    plan_steps: string;
    plan_optional: string;
    plan_needsStop: string;
    plan_ecuTimeout: string;
    plan_maxHold: string;
    plan_args: string;
    plan_telegram: string;
    plan_noTelegram: string;
    plan_selectHint: string;
    opKind: Record<OpKind, string>;
    opKindNote: Record<OpKind, string>;
    confidence: Record<'single' | 'multiple' | 'shared', string>;
    confidenceNote: Record<'single' | 'multiple' | 'shared', string>;

    // --- SMG II procedures ------------------------------------------------
    proc_title: string;
    proc_duration: string;
    proc_engine: string;
    proc_engineRun: string;
    proc_engineOff: string;
    proc_results: string;
    proc_status: string;
    proc_activity: string;
    proc_faults: string;
    proc_none: string;
    proc_expectedReading: string;
    proc_band: string;
    proc_readingFrom: string;
    det_sgbdComment: string;
    proc_steps: string;
    det_blockInferred: (job: string, arg: string, value: string) => string;
    gear_windows: string;
    gear_noSpec: string;
    gear_name: Record<'1' | '2' | '3' | '4' | '5' | '6' | 'R', string>;
    gear_measure: Record<'SW' | 'WW_TOUCH_L' | 'WW_TOUCH_R', string>;
    gear_gate: string;
    gear_gateNote: string;

    // --- DSC hydraulics ----------------------------------------------------
    dsc_title: string;
    dsc_stop: string;
    dsc_allOutputsOff: string;
    dsc_appConstruct: string;
    dsc_drivesNote: string;
    dsc_absenceHint: string;
    dsc_runnerUp: (list: string) => string;
    seq_title: string;
    seq_pickHint: string;
    op_blocked_telegram: string;
    op_blocked_args: string;
    op_blocked_practice: string;
    /** Why a run control will not fire. One key per RunBlockKey — see runGate.ts. */
    runBlock: Record<
        | 'run_block_programming'
        | 'run_block_identity'
        | 'run_block_noTelegram'
        | 'run_block_needsArgs'
        | 'run_block_notRead'
        | 'run_block_controlWrites'
        | 'run_block_notVerified',
        string
    >;
    run_result: string;
    run_request: string;
    run_response: string;
    run_undecoded: string;
    adaptations: string;
    adaptations_note: string;
    adaptations_short: (got: number, need: number) => string;
    /** Said where the module has adaptation data but this app has no decoder for it. */
    adaptations_noDecoder: string;
    adaptationsReset: string;
    adaptationsReset_note: string;
    adaptationsReset_none: string;
    /** A module this app has not surveyed. Never shown as "there are none". */
    adaptationsReset_unknown: string;
    viz_adaptationBlocks: string;
    /** The state of a control that will not fire. Shorter than the reason, which sits under it. */
    op_blocked: string;
    clearFaults_title: string;
    clearFaults_consequence: string;
    clearFaults_confirm: string;
    /** Why each plan step exists. Safety copy — see jobOps.ts WhyKey. */
    op_why: Record<WhyKey, string>;
    /** Why an operation cannot be taken back. */
    op_irreversible: Record<IrreversibleKey, string>;

    // --- Steps -------------------------------------------------------------
    step_order: Record<'ecu-defined' | 'app-recommended' | 'unordered-set', string>;
    step_orderNote: Record<'ecu-defined' | 'app-recommended' | 'unordered-set', string>;
    step_state: Record<'running' | 'passed' | 'done' | 'failed' | 'unknown', string>;
    step_meta: Record<string, string>;
    /** The facet axes. Named, because a filter whose axis is unlabelled is a mystery toggle. */
    facet_purpose: string;
    facet_audience: string;
    facet_system: string;
    facet_all: string;
    facet_runnable: string;
    facet_runnableNow: string;
    facet_runnableNote: string;
    facet_hidden: (n: number) => string;
    jobClass: Record<JobClass, string>;
    /** One line saying what the class IS — the answer to "what is different
     *  between the jobs under CALIBRATION and the ones under ACTUATOR TEST". */
    jobClassNote: Record<JobClass, string>;
    audience: Record<Audience, string>;
    audienceNote: Record<Audience, string>;
    system: Record<string, string>;

    // --- The operation shape, in four independent axes ---------------------
    op_actor: string;
    op_termination: string;
    op_delivery: string;
    op_prerequisites: string;
    actor: Record<Actor, string>;
    termination: Record<Termination, string>;
    delivery: Record<ResultDelivery, string>;
    /** Where the answer to a companion-job test is read. */
    op_resultJob: (job: string) => string;

    // --- The job's contents -------------------------------------------------
    det_results: string;
    det_resultCount: (n: number) => string;
    det_results_note: string;
    det_args: string;
    det_values: string;
    det_noValues: string;
    det_whenArg: (arg: string, values: string) => string;
    det_inferred: string;
    det_optionsDropped: (list: string) => string;
    det_optionsFromComment: string;
    det_argBindsNoResults: (arg: string, value: string) => string;
    resultRole: Record<ResultRole, string>;

    // --- Calibration values -------------------------------------------------
    spec_current: string;
    spec_min: string;
    spec_max: string;
    spec_default: string;
    spec_always: string;
    /** The correction that matters most: Default is the FACTORY value, not a target. */
    spec_defaultNote: string;
    spec_verdict: Record<'in-range' | 'out-of-range' | 'unknown', string>;
    spec_needsRun: string;
    spec_crossField: (a: string, b: string) => string;
    risk_label: Record<Risk, string>;
    provenance: Record<'sgbd-comment' | 'sgbd-args' | 'name-heuristic' | 'authored' | 'inferred', string>;
}

/** What `t` is: the chrome, plus this language's prose. */
export type Catalog = Chrome & Localised;

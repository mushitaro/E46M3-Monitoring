import type { Audience, JobClass, ResultDelivery, ResultRole, Actor, Termination, Risk } from '../ecuCatalog';
import type { IrreversibleKey, OpKind, WhyKey } from '../jobOps';
import type { RunBlockKey } from '../runGate';
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
    /**
     * The one exit from the disclaimer, in the reader's language — not a chrome verb. Pressing it
     * IS the agreement, and the note under the points names it word for word, so the two have to be
     * one string in one language (TUNER's 同意して続ける / Agree & Continue).
     */
    disclaimer_agree: string;
    /** What the press means, said once, under the points. */
    disclaimer_agreeNote: string;
    /**
     * What the preview sends, and why: a section under the points, in the preview build only
     * (lib/previewNotice.ts). m3's notice for `monitoring-preview` — its NOTICE_COPY with
     * NOTICE_APPS' `sessions` and `records`, field names kept — moved here when the operator retired
     * m3's /preview-notice page (2026-09-24). Verbatim but for two lines, made true of this app
     * (2026-09-24): `recordsWhen` says a record goes when a job fails, which is the only time this app
     * sends one, and `alsoSent` names the app version alone, because nothing here keeps the browser
     * type. `lead` also names the build as the operator renamed it for its users (2026-09-25): this
     * WORKS build / このワークス版, where m3 said preview. What it lists must stay what lib/sync/
     * sends, and what m3's privacy policy (#preview) says of this app.
     *
     * `reads` and `investigations` were added with v2 of the notice (2026-10-28), when the build
     * began to send what the policy's 「読み取りの記録」 and 「調査の記録」 had already said it would
     * (lib/sync/readRecords, lib/sync/investigations); `lead`, `alsoSent`, `purpose`, `where` and
     * `deleteBody` grew to match.
     */
    disclaimer_preview: {
        lead: string;
        sessionsTitle: string;
        sessions: string;
        sessionsWhen: string;
        recordsTitle: string;
        records: string;
        recordsWhen: string;
        readsTitle: string;
        reads: string;
        readsWhen: string;
        investigationsTitle: string;
        investigations: string;
        investigationsWhen: string;
        alsoSent: string;
        purposeTitle: string;
        purpose: string;
        whereTitle: string;
        where: string;
        deleteTitle: string;
        deleteBody: string;
        policy: string;
    };
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
    /** The credits dialog. Reachable always; never inside the disclaimer. */
    credits_title: string;
    credits_lede: string;
    credits_entries: Array<{ name: string; what: string; url: string; licence?: string }>;
    credits_notices: string;
    /** The colophon: where the work continues, and the people who carry it. */
    credits_meshLead: string;
    credits_meshTail: string;
    credits_supportersLead: string;
    credits_supportersOthers: string;
    credits_supportersAsOf: (date: string) => string;
    gate_verified: string;
    gate_unverified: string;
    gate_practiceOnly: string;
    args_required: (names: string) => string;
    precond_voltage_ok: string;
    precond_stationary: string;
    precond_engine_off: string;
    module: string;
    faultRef: string;
    faultRef_info: string;
    catalog_jobs: (n: number) => string;
    cancel: string;
    /** The ⓘ beside a section title that opens its explanation (ui.tsx `Section` `info`). */
    info_show: string;
    info_hide: string;
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
    /** Said beside a fault read from a module with no decoder: its bytes, as they came back. */
    faults_raw_note: (frames: number) => string;
    /** The hub's notice where a module's own SGBD carries no short IDENT or fault-read frame. */
    faults_notEstablished: string;
    /** The hub's notice on DATALOG for a module whose live-block layout this app does not have. */
    datalog_noDecoder: string;
    /** PROBE (chrome.ts) runs the plan of an investigation the owner handed over (lib/probe). WORKS only. */
    probe_title: string;
    /** The hub's notice while a plan runs: version, one-shot steps settled of all, samples kept. */
    probe_line: (v: number, settled: number, total: number, samples: number) => string;
    /** SESSIONS — the preview's saved sessions and SYNC (lib/features.ts `sessionSync`). */
    sessions_current: string;
    /** The explanation behind this connection's ⓘ: what SAVE and SYNC each do. */
    sessions_current_info: string;
    /** What a press of SAVE / SYNC would do, or why it cannot — `title`, beside the one-word label. */
    save_title: Record<'nothing' | 'ready' | 'busy' | 'saved', string>;
    sync_title: Record<'signedOut' | 'unreachable' | 'offline' | 'busy' | 'clean', string> & { ready: (n: number) => string };
    /**
     * ASSISTANT (chrome.ts) — the owner's assistant reaching this tab through TSUNAGI///Matrix. WORKS
     * only. What turning it on sends, by where, to whom, and what it can and cannot do: the notice
     * shown before it turns on, item by item rather than as one paragraph (tsunagi-m-ux §17). Each
     * item says what m3's privacy policy (#preview, アシスタント連携) says of MONITORING, shorter.
     */
    assistant_consent: {
        title: string;
        lead: string;
        items: { title: string; body: string }[];
        off: string;
    };
    assistant_turnOn: string;
    assistant_turnOff: string;
    /** When the switch cannot be used yet: the WORKS notice is not confirmed, or this is not the WORKS build. */
    assistant_unavailable: string;
    assistant_state: Record<'off' | 'connecting' | 'live' | 'retrying' | 'held' | 'offline' | 'stopped', string>;
    /** The header's AI switch: what a press does, for its title. */
    ai_pressToTurnOn: string;
    ai_pressToTurnOff: string;
    /** On SESSIONS: where the switch is now that it is not here. */
    assistant_whereSwitch: string;
    /** The name a device answers as when the owner gave it none: the head unit, a phone, a computer. */
    assistant_defaultDevice: Record<'nav' | 'phone' | 'pc', string>;
    assistant_calls: (n: number) => string;
    assistant_switchHere: string;
    assistant_catalogOk: string;
    assistant_catalogRefused: (reason: string) => string;
    assistant_device: string;
    sessions_nothing: string;
    sessions_onDevice: string;
    sessions_inAccount: string;
    sessions_errors: string;
    sessions_errors_info: string;
    sessions_account: (label: string) => string;
    sessions_account_unknown: string;
    sessions_account_expired: string;
    sessions_noCloud: string;
    sessions_saved: string;
    sessions_saveFailed: string;
    sessions_sent: (n: number) => string;
    sessions_nothingToSend: string;
    sessions_sendFailed: string;
    sessions_sendExpired: string;
    sessions_tooLarge: (label: string) => string;
    sessions_restored: string;
    sessions_restoreFailed: string;
    sessions_restoreNewer: string;
    sessions_emptyLocal: string;
    sessions_emptyCloud: string;
    sessions_emptyErrors: string;
    sessions_outbox: (n: number) => string;
    sessions_counts: (faults: number | null, samples: number, failures: number) => string;
    sessions_deleteLocal_title: string;
    sessions_deleteLocal_consequence: (label: string, synced: boolean) => string;
    sessions_deleteCloud_title: string;
    sessions_deleteCloud_consequence: (label: string) => string;
    sessions_deleteError_title: string;
    sessions_deleteError_consequence: string;
    sessions_delete_confirm: string;
    reauth_title: string;
    reauth_consequence: string;
    reauth_confirm: string;
    reauth_note: string;
    /** RELOAD (header and M menu). Asked only when something would be lost: a link, a read, a run. */
    reload_confirm: string;
    reload_title: string;
    reload_running: string;
    /** INSTALL (M menu): one sentence per state of hooks/useInstallPrompt, since the greyed glyph cannot say why. */
    install_ready: string;
    install_ios: string;
    install_dismissed: string;
    install_unavailable: string;
    viewer_faults: string;
    viewer_noFaultsRead: string;
    viewer_datalog: string;
    viewer_rows: (shown: number, total: number) => string;
    viewer_failures: string;
    viewer_noFailures: string;
    viz_sessions: string;
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
    runBlock: Record<RunBlockKey, string>;
    /**
     * The same refusals in a word or two, for the row: the reason has to be drawn where the control
     * is (a phone has no hover), and a sentence repeated down eighty-five rows is a wall. The row
     * says which; the sentence is where the job's detail is, and in the list's ⓘ.
     */
    runBlockShort: Record<RunBlockKey, string>;
    /** ACTUATOR's explanation, behind its ⓘ, before the glossary of the reasons its rows carry. */
    actuator_info: string;
    run_result: string;
    run_request: string;
    run_response: string;
    run_undecoded: string;
    adaptations: string;
    adaptations_info: string;
    adaptations_short: (got: number, need: number) => string;
    /** Said where the module has adaptation data but this app has no decoder for it. */
    adaptations_noDecoder: string;
    /** Why, behind the ⓘ: which module has a table, and where SMG II’s values can be read instead. */
    adaptations_noDecoderInfo: string;
    adaptationsReset: string;
    adaptationsReset_info: string;
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
    jobClassInfo: Record<JobClass, string>;
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
    det_results_info: string;
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

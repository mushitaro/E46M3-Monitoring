import type { Localised } from './catalog';

/**
 * English. Also the language the SGBD's German is translated INTO first, so a term that reads oddly here usually reads oddly in ja.ts too.
 *
 * The chrome tokens are not here — see `chrome.ts`. `Localised` does not
 * declare them, so putting one back is a compile error rather than a silent
 * second spelling.
 */
export const en: Localised = {
    connect: 'Connect',
    connecting: 'Connecting…',
    connected: 'Connected',
    disconnected: 'Not connected',

    mode: 'Mode',
    mode_vehicle: 'Vehicle (Web Serial)',
    mode_practice: 'PRACTICE (no vehicle)',

    ecu: 'Module',
    readIdent: 'Read identity',
    readFaults: 'Read fault memory',
    startLog: 'Start recording',
    stopLog: 'Stop',
    clearLog: 'Clear',
    exportLog: 'Save comms log',

    faults_none: 'No stored faults',
    faults_count: (n: number) => `${n} stored fault${n === 1 ? '' : 's'}`,
    faults_code: 'Code',
    faults_type: 'Type',
    faults_frequency: 'Frequency',
    faults_logistics: 'Logistics',
    faults_freezeFrames: 'Freeze frames',

    channels: 'Channels',
    channels_pick: 'Choose what to record',
    datalog_run: 'Recording',
    channels_search: 'Search (symbol, name)',
    channels_block: 'Block',
    channels_blockNote: (s) => `Selection ${s} — everything in one block costs a single round trip`,
    datalog_exportsRun: (n) =>
        `Export writes the run that was recorded (${n} channel(s)), not the selection as it stands now.`,
    channels_alsoIn: (b) => `+${b}`,
    channels_alsoInNote:
        'This quantity is also in another block. Taking the copy from a block you already read costs no extra round trip. Different blocks are recorded as different channels.',
    faults_read: 'Faults read',
    faultRef_search: 'Search (code, translation, German original)',
    channels_selected: (n: number, blocks: number) =>
        `${n} channel${n === 1 ? '' : 's'} across ${blocks} block${blocks === 1 ? '' : 's'} = ${blocks} round trip${blocks === 1 ? '' : 's'} per sample`,
    rate: 'Measured rate',
    samples: 'Samples',

    notSupported_title: 'This browser cannot connect to a vehicle',
    notSupported_body:
        'The Web Serial API is available only in desktop Chrome and Edge. iOS, Android, Safari and Firefox are not supported. PRACTICE mode works everywhere.',

    error_electrical_title: 'This looks like a wiring or electrical fault',
    error_electrical_body:
        'The K-line was pulled low during our own transmission. Retrying will not fix it. Work through these in order.',
    error_desync_body: 'The stream lost framing. A retry will usually recover it.',

    provenance_title: 'Data provenance',
    search: 'Search (job id, label, German original)',
    run: 'Run',
    risk_all: 'All',
    risk_high: 'High',
    risk_medium: 'Med',
    risk_low: 'Low',
    disclaimer_title: 'About this tool',
    disclaimer_lede:
        'A personal tool for reading a BMW E46 M3 over DS2. **It is not a professional ' +
        'diagnostic device.** Base repair decisions on the service manual (TIS) and on the car in front of you.',
    disclaimer_points: [
        'What it sends to a real car is **reads only**. The single exception is clearing the fault memory, and it asks first.',
        "The classifications, translations and expected values come out of BMW's SGBD files mechanically. " +
            '**Anything not confirmed against a car says so**, and an operation that has not been confirmed is refused with its reason stated.',
        'PRACTICE mode talks to a simulator, not a car. It is the only mode in which an actuator test will fire.',
        'Working on a car is dangerous. Jacking it up, running the engine, moving parts — this tool does none of that for you.',
    ],
    wiz_title: (name: string) => `Procedure: ${name}`,
    wiz_step: { prereq: 'Preconditions', safety: 'What will happen', run: 'Running', result: 'Result' },
    wiz_prereq_note:
        "The ECU's own preconditions, straight from the SGBD procedure table. Nothing here was added by this app.",
    wiz_safety_ack: 'I have read the above and the car is in a state to do this',
    wiz_gear: 'Gear to engage',
    wiz_gear_neutral: 'Neutral',
    wiz_gear_reverse: 'Reverse',
    wiz_run_note:
        'The ECU reports progress by having TESTPRG_STARTEN **sent again and again**. ' +
        'It keeps going until the status is no longer “running” — which is the SGBD’s own instruction.',
    wiz_elapsed: 'Elapsed',
    wiz_of: (max: string) => `/ ${max} max`,
    wiz_status: 'ECU status',
    wiz_activity: 'What it is doing',
    wiz_raw: 'Raw answer',
    wiz_polls: (n: number) => `${n} asked`,
    wiz_abortOnly: 'While it runs, ABORT is the only way out. The dialog will not close while the gearbox is working.',
    wiz_result_ok: 'Finished normally',
    wiz_result_bad: 'Did not finish properly',
    wiz_result_aborted: 'Aborted',
    wiz_stopSent: 'TESTPRG_STOP sent',
    wiz_offsetsInferred:
        "The answer's byte positions are **inferred** from the SGBD's wording (Byte 5 / Byte 6). Nothing has " +
        'confirmed them against a car, so the raw bytes are printed beside the decode.',
    procBlock: {
        proc_block_vehicle:
            'A vehicle is attached. This procedure is not a read and has not been confirmed on a car, so it is not sent. Run it in PRACTICE.',
        proc_block_noJob: "This module's catalogue has no TESTPRG_STARTEN / TESTPRG_STOP.",
        proc_block_selection: 'A gear must be chosen — neutral, 1 to 6, or reverse.',
        proc_block_frame: 'The frame cannot be built: the template and the declared arguments do not agree.',
    },
    viz_willSend: 'This frame goes out',
    viz_wontSend: 'Not sent',
    viz_response: 'What comes back',
    viz_responseNone: 'The SGBD declares no results for this job.',
    actuator_none: 'Nothing is engaged',
    gate_verified: 'Confirmed on a car',
    gate_unverified: 'Not confirmed on a car',
    gate_practiceOnly:
        'Blocked: not verified on a vehicle. Each job is unlocked individually once a car has confirmed it and the ledger records the evidence.',
    args_required: (names: string) => `Args: ${names}`,
    precond_voltage_ok: 'Voltage',
    precond_stationary: 'Stationary',
    precond_engine_off: 'Engine off',
    module: 'Module',
    faultRef: 'Fault text reference',
    faultRef_note:
        "The SGBD's own FORTTEXTE table. It is keyed by fault code, so a fault that is read gets its text directly; this list is the searchable reference, by code, translation or German original.",
    catalog_jobs: (n: number) => `${n} job${n === 1 ? '' : 's'}`,
    cancel: 'Cancel',
    actuator_runnable: (n, total) => `${n} of ${total} can be sent`,
    actuator_onlyRunnable: 'Only what can run',
    actuator_armed: 'Engaged',
    gate_plan: 'What will be sent',
    gate_preconditions: 'Preconditions (tick all)',
    gate_preconditions_none: "This ECU's SGBD states no preconditions for this job.",
    gate_caution: 'Before you press',
    gate_ack_irreversible: 'I understand this cannot be undone',
    gate_unreleasable_title: 'There is no release job',
    gate_unreleasable_body:
        'It actuates and stays. The SGBD offers no job that releases it, so this app cannot stop it.',
    gate_ack_unreleasable: 'I understand there is no way to stop it',
    gate_postNote:
        'Read the results afterwards, and the fault memory if it matters. Even with no reply, the car may have run it.',
    gate_telegram: {
        single: "A frame belonging to this job alone — the extraction found exactly one.",
        multiple:
            'Several frames were found for this job. They may vary with its arguments, and which one is right is not settled.',
        shared: '**Not this job’s own frame.** Other jobs carry the identical frame, which usually means a template was picked up.',
    },
    viz_faults: 'faults',
    viz_clean: 'No faults',
    riskMix: 'Risk mix',
    awaiting_read: 'AWAITING READ…',
    awaiting_samples: 'AWAITING SAMPLES…',
    awaiting_catalog: 'AWAITING CATALOG…',
    ident_note: (b) =>
        `${b} bytes — the field layout of this response is not known yet. EdiabasLib used to decode it; shown raw rather than guessed at.`,
    error_electrical_steps: [
        'Compare failure rates with the engine off vs running. If it only misbehaves while running, it is ignition/motor EMI on an unshielded cable — not the software.',
        'Reseat the OBD connector, and wiggle-test it while connected.',
        'Try a different USB port, with no hub in between.',
        "Check the port's ground and supply.",
        "Note the adapter's VID/PID — clone FTDI chips are common.",
    ],

    plan_kind: 'Operation',
    plan_steps: 'Plan (wire order)',
    plan_optional: 'optional',
    plan_needsStop: 'needs a stop',
    plan_ecuTimeout: 'ECU timeout',
    plan_maxHold: 'Max hold',
    plan_args: 'Arguments',
    plan_telegram: 'Request telegram',
    plan_noTelegram:
        'No telegram recovered for this job. The SGBD assembles the request from arguments at run time, which a static scrape cannot evaluate.',
    plan_selectHint: 'Select a job to see what it does',
    opKind: {
        read: 'Read',
        pulse: 'Pulse',
        hold: 'Hold',
        paired: 'Paired',
        measurement: 'Measurement',
        latching: 'Latching',
        compound: 'Compound',
        procedure: 'Program',
        deferred: 'Result elsewhere',
        write: 'Write',
        unknown: 'Unknown',
    },
    opKindNote: {
        read: 'Reads values and changes nothing. Safe to repeat.',
        pulse: 'Actuates once and ends by itself. There is nothing to stop.',
        hold: 'Stays energised until stopped. Needs a stop control and a deadman that releases it if the link dies.',
        paired: 'Runs until a DIFFERENTLY NAMED job ends it. Start and stop are separate jobs.',
        measurement: 'Triggers a measurement the ECU runs to completion; the result appears in the live blocks.',
        latching: 'Actuates and latches. The SGBD exposes no release job, so this cannot be undone from here.',
        compound: 'The SGBD job itself drives several outputs in sequence. This is not a single action.',
        procedure: 'A multi-step program the ECU runs by itself, reporting progress and a result code. Abortable.',
        deferred:
            'Starts a test but returns no verdict of its own. The answer is read by a differently-named job; starting it alone tells you nothing.',
        write: 'Writes persistent state. Nothing here can read the previous value back, so there is no undo.',
        unknown: 'The SGBD comment does not state what this does, so neither will this panel.',
    },
    confidence: { single: 'Unambiguous', multiple: 'Several candidates', shared: 'Shared' },
    confidenceNote: {
        single: 'Emitted by this job and no other. The static scrape resolved it uniquely.',
        multiple:
            'Several candidates. The job branches on arguments or ECU state the scrape cannot evaluate, so which one goes out is not decidable here.',
        shared:
            'The same frame appears under several job names. It is the template the SGBD fills in at run time — NOT this job‘s telegram.',
    },

    proc_title: 'Guided procedures (test programs)',
    proc_duration: 'Duration',
    proc_engine: 'Engine',
    proc_engineRun: 'Running',
    proc_engineOff: 'Stopped',
    proc_results: 'Result block',
    proc_status: 'Run status',
    proc_activity: 'Activity codes',
    proc_faults: 'Result codes',
    proc_none: 'This module has no guided procedures (SMG II only)',
    proc_expectedReading: 'Value returned, and its band',
    proc_band: 'Workshop band',
    proc_readingFrom: 'Result',
    det_sgbdComment: 'SGBD comment',
    proc_steps: 'What the ECU does, step by step',
    det_blockInferred: (j, a, v) =>
        `The SGBD does not state this mapping. It is inferred from the result-name prefixes as ${j} (${a} = ${v}).`,
    gear_windows: 'Per-gear measurement windows',
    gear_noSpec:
        'None of these 42 has a stated range — the SGBD publishes no limits for them, so there is no pass or fail to give. They are comparable against a previous read and against each other.',
    gear_name: { '1': '1st', '2': '2nd', '3': '3rd', '4': '4th', '5': '5th', '6': '6th', R: 'Reverse' },
    gear_measure: { SW: 'Shift travel', WW_TOUCH_L: 'Gate stop, left', WW_TOUCH_R: 'Gate stop, right' },
    gear_gate: 'Gate',
    gear_gateNote:
        'The mark on the left is the gate (Gasse) the gear sits in. Two gears share one gate, so when both gears of a pair read off in the same direction, the thing to suspect is the gate value, not the gears. Neutral sits in no gate and is read on its own as POS_SW_N_WERT. The SGBD does not state this pairing; it is how INPA’s getriebeschema and beliebigen_gang_einlegen screens read the two together.',

    dsc_title: 'Brake hydraulic operations',
    dsc_stop: 'Stop',
    dsc_allOutputsOff: 'All outputs off',
    dsc_appConstruct: "the app's own construct",
    dsc_drivesNote:
        "The valve names on each row are every solenoid that operation actuates **at some point** in the extracted bytecode. It does not mean they are driven together — a static extraction has no order. That is why a one-side bleed lists the opposite side's outlet valves, and this app does not interpret it.",
    dsc_absenceHint: 'This family has a place the SGBD provides no job for. The row above says which, and why.',
    dsc_runnerUp: (l) =>
        `There are other all-outputs-off candidates: ${l}. They differ only in bits the STEUERN table does not name, so which is correct is not something this app can decide.`,
    seq_title: 'Suggested sequences',
    seq_pickHint: 'Press a step to show that procedure',
    op_blocked_telegram: 'Blocked — the telegram for this job is not established',
    op_blocked_args: 'Arguments required',
    runBlock: {
        run_block_programming: 'Programming jobs get no run control. This app does not send flash or EEPROM writes.',
        run_block_identity:
            'Vehicle-identity jobs get no run control. This app does not send a chassis number, key material or an odometer value.',
        run_block_noTelegram: "This job's request telegram is not uniquely established. We do not send what we cannot name.",
        run_block_needsArgs: 'This job takes arguments. The extracted telegram embeds argument values we did not choose, so it cannot be sent as it stands.',
        run_block_notRead: 'Not a read job. Reads are all this app can send to a car so far — there is no execution path yet for actuator tests, calibration writes or procedures.',
        run_block_controlWrites: 'The control byte is not read-only. Whatever the classification says, the frame that would go out could change the car, so it is not sent.',
        run_block_notVerified: 'No ledger entry saying this was proven on a vehicle. Nothing but reads runs without one.',
    },
    run_result: 'Run result',
    run_request: 'Sent',
    run_response: 'Response',
    run_undecoded:
        'The SGBD names this job’s results but publishes no byte offsets for them, so the payload is shown raw — mapping it onto those names would be inventing a layout. Live values, adaptations, fault memory and ident each go through a real decoder, not this path.',
    adaptations: 'Adaptation values',
    adaptations_note:
        'What the ECU has learned in service. Read-only; nothing is written to the car.',
    adaptations_short: (g, n) => `${g} bytes came back; this table needs at least ${n}. Missing fields are not shown.`,
    adaptations_noDecoder:
        'MSS54 is the only module with a ported adaptation-block table. SMG II and DSC hold learned values in the ECU too — this app just has no way to read them, which is not the same as the ECU having none. SMG II’s are reachable from ADAPTIONSWERTE_LESEN in the SERVICE tab.',
    adaptationsReset: 'Reset adaptations',
    adaptationsReset_note:
        'The ECU’s own jobs for erasing what it has learned. This app does not send them; each row says why. After an erase the ECU relearns from its factory defaults, so idle and fuel trim are rough for a while.',
    adaptationsReset_none:
        'This module’s SGBD has no adaptation-erase job — checked against every job in the catalogue. (Clearing fault memory is a different thing and lives in the DIAGNOSIS tab.)',
    adaptationsReset_unknown:
        'This module has not been surveyed. That is not the same as having no erase job.',
    viz_adaptationBlocks: 'Blocks decoded',
    op_blocked: 'Blocked',
    clearFaults_title: 'Clear fault memory',
    clearFaults_consequence:
        'The fault codes and their freeze frames — the recorded operating conditions at the moment each fault occurred — are erased from the ECU. This cannot be undone. Faults will re-log if their cause is still present, but the freeze frames will not come back. Read and record them first.',
    clearFaults_confirm: 'Clear',
    op_blocked_practice: 'The PRACTICE ECU does not implement this job',
    op_why: {
        why_read: 'reads and returns values; the ECU state does not change',
        why_pulse: 'actuates once; the ECU ends it by itself',
        why_write: 'writes persistent state',
        why_measure: 'triggers a measurement the ECU runs to completion; the result appears in the live blocks',
        why_latching: 'actuates and HOLDS via digital control',
        why_multiOutput: 'drives several digital outputs in sequence',
        why_switchOn: 'switches the output ON',
        why_switchOff: 'switches it OFF again — same job, opposite SCHALTEN value',
        why_pinDrive: 'drives the chosen pin directly at the given duty cycle and period',
        why_pairStart: 'starts, and stays active until its counterpart is sent',
        why_pairStop: 'ends the operation its counterpart started',
        why_prerequisite: 'the SGBD requires this to be sent first; skip it and the ECU refuses',
        why_deferredStart: 'starts the test; this job returns no verdict of its own',
        why_readResult:
            'reads the verdict — a differently-named job, and without it the test tells you nothing',
        why_prepare:
            'the SGBD requires it for the starter release, hydraulic pump, fault indicator and shift lock, and it resets the ECU time counter',
        why_driveActuator: 'drives the selected actuator',
        why_keepAlive: 'keeps the session alive — the ECU timeout is 10 s and a run can last 960',
        why_testprgStop: 'the SGBD requires it: "Must be sent BEFORE TESTPRG_STARTEN!"',
        why_testprgStart: 'starts the program (TESTPRG_NR, and AUSWAHLBYTE where it takes a selection)',
        why_testprgPoll: '**re-send this same job** and read the run status, activity code and result code from it. The SGBD: "keep sending until this result is not 1". There is no companion job for this.',
        why_unknown: 'the SGBD comment does not state what this does',
    },
    op_irreversible: {
        irr_latching:
            'The SGBD exposes no release job for DSC_SIM_*. Once actuated it stays actuated; recovery is an ignition cycle, not a command.',
        irr_pin:
            'Forces an arbitrary output pin. Nothing in the SGBD constrains which pin, so nothing here can tell a harmless one from a damaging one.',
        irr_write:
            'Writes state that survives an ignition cycle. Nothing in this app can read the previous value back first, so there is no undo.',
        irr_eeprom:
            'Commits the RAM value into EEPROM. Everything up to here could be written back; from here it cannot.',
        irr_no_counterpart:
            'The SGBD offers no job that undoes this, and does not say how it is undone. What it takes to restore things afterwards is not something this app can tell you.',
    },

    step_order: {
        'ecu-defined': 'The ECU defines this order',
        'app-recommended': 'Recommended order (the SGBD defines none)',
        'unordered-set': 'No order - pick one',
    },
    step_orderNote: {
        'ecu-defined': "This order is what the ECU itself reports. It is execution order, not numeric order.",
        'app-recommended': 'The SGBD tables define no order. This is built from inter-step dependencies and service practice.',
        'unordered-set': 'A set of alternatives. There is no sequence.',
    },
    step_state: { running: 'Running', passed: 'Passed', done: 'Done', failed: 'Failed', unknown: 'Unknown' },
    step_meta: { duration: 'Takes', engine: 'Engine', valves: 'Drives' },
    facet_purpose: 'Purpose',
    facet_audience: 'For',
    facet_system: 'System',
    facet_all: 'All',
    facet_runnable: 'Run',
    facet_runnableNow: 'Runnable',
    facet_runnableNote:
        'Show only what can be sent right now: the request telegram is uniquely established, the job takes no arguments, and its control byte is read-only. Most jobs fail the first of those — not because sending is disallowed, but because we do not know what to send.',
    facet_hidden: (n) => `${n} hidden by the current filter`,
    jobClass: {
        read: 'Read',
        test: 'Actuator test',
        calibration: 'Calibration',
        coding: 'Coding',
        identity: 'Vehicle identity (not run here)',
        programming: 'Programming (not run here)',
        protocol: 'Procedure step',
        unclassified: 'Unclassified',
    },
    jobClassNote: {
        read: 'Reads a value. Nothing about the car changes, and it is safe to repeat.',
        test: 'Moves a part temporarily to check it. When it ends the car is as it was — except for the few that latch, which say so individually.',
        calibration:
            'Rewrites a learned or adjusted value. It survives an ignition cycle and there is no way back to the old value.',
        coding: "Rewrites the car's equipment configuration. Getting it out of step with other modules means warning lights or lost functions.",
        identity:
            "Rewrites what says which car this is — chassis number, order and manufacturing data, immobiliser key material, odometer. **This app does not run these.** Out of step with the other modules it means lost functions or an engine that will not start, and recovery needs the dealer's key data. NCS / WinKFP territory.",
        programming:
            "Operates on the ECU's own program area. **This app does not run these.** An ECU whose write fails will not boot; recovery is bench work or replacement. WinKFP territory.",
        protocol: "A step inside another job's procedure. Running it on its own means nothing.",
        unclassified:
            "This ECU's SGBD says nothing about this job. Because we cannot say what it does, **it cannot be run on a vehicle.** We do not guess from the name and file it under reads.",
    },
    audience: { owner: 'Owner', technician: 'Technician', protocol: 'Protocol' },
    audienceNote: {
        owner: 'A car owner can judge what this means.',
        technician: 'Assumes the knowledge — and the recovery route — that goes with doing this for a living.',
        protocol: 'Used inside other jobs. Not something you run.',
    },
    system: {
        faults: 'Fault memory',
        vanos: 'VANOS (variable valve timing)',
        fuel: 'Fuel and injection',
        emissions: 'Emissions, catalyst, O2 sensors',
        air: 'Intake, throttle, pedal',
        ignition: 'Ignition and knock',
        cooling: 'Cooling and oil',
        clutch: 'Clutch',
        gearbox: 'Gearbox',
        brakes: 'Brake hydraulics',
        tyres: 'Tyre pressure',
        stability: 'Stability control',
        steering: 'Steering',
        sensors: 'Sensors',
        electrical: 'Power, relays, I/O',
        ecu: 'ECU identity',
        engine: 'Engine control',
        lighting: 'Lighting',
        climate: 'Climate control',
        body: 'Body (doors, windows, roof)',
        cluster: 'Instrument cluster and displays',
        security: 'Security and immobiliser',
        restraint: 'Occupant restraint (airbags, belts)',
        seats: 'Seat and mirror memory',
        controls: 'Switches and controls',
        parking: 'Park distance control',
        av: 'Audio, navigation, telephone',
        unknown: 'Unknown',
    },

    op_actor: 'Who carries it',
    op_termination: 'How it ends',
    op_delivery: 'Where the answer is',
    op_prerequisites: 'Sent first',
    actor: {
        ecu: 'The ECU runs it by itself',
        app: 'This app must keep sending',
        operator: 'A person has to do something',
        driver: 'The car has to be driven',
    },
    termination: {
        self: 'Ends by itself',
        'app-stop': 'This app stops it',
        'companion-job': 'A differently-named job stops it',
        none: 'It does not stop (latching)',
    },
    delivery: {
        inline: "In this job's own response",
        'companion-job': 'Read by another job',
        'live-block': 'Appears in the live blocks',
        none: 'No result',
    },
    op_resultJob: (job) => `The verdict is read with ${job}`,

    det_results: 'What this job returns',
    det_resultCount: (n) => `${n} result${n === 1 ? '' : 's'}`,
    det_results_note:
        'The results the SGBD declares. Value, unit and plain text are folded into one row. Current values need a run.',
    det_args: 'Arguments you must supply',
    det_values: 'Adjustment values',
    det_noValues:
        'No published limits for this job. Neither the SGBD nor the decompiled source states a minimum or maximum — that is a fact, not a gap we have yet to fill.',
    det_whenArg: (arg, values) => `Returned only when ${arg} is ${values}`,
    det_inferred: 'inferred',
    det_optionsDropped: (l) => `Excluded per the SGBD: ${l}`,
    det_optionsFromComment: 'comment',
    det_argBindsNoResults: (a, v) =>
        `The SGBD declares no named result bound to ${a} = ${v}. What comes back is the always-returned set, raw DATEN included. The values are not missing — the field names were never published.`,
    resultRole: {
        value: 'value',
        unit: 'unit',
        text: 'text',
        status: 'job status',
        telegram: 'telegram',
        raw: 'raw',
    },

    spec_current: 'Current',
    spec_min: 'Min',
    spec_max: 'Max',
    spec_default: 'Factory default',
    spec_always: 'Fixed',
    spec_defaultNote:
        'The factory default is the value it left the factory with, NOT a target. A learned value sitting away from it is normal. The only verdict here is whether it is inside the stated range.',
    spec_verdict: { 'in-range': 'In range', 'out-of-range': 'Out of range', unknown: 'No verdict' },
    spec_needsRun:
        'Reading the current value needs a run, and running is not unlocked yet — so this shows the range and the factory default only.',
    spec_crossField: (a, b) => `A constraint on the difference between ${a} and ${b}`,
    risk_label: { low: 'Low', medium: 'Med', high: 'High' },
    provenance: {
        'sgbd-comment': 'stated by the SGBD',
        'sgbd-args': 'from the argument signature',
        'name-heuristic': 'guessed from the name',
        authored: 'written by hand',
        inferred: 'inferred',
    },
};

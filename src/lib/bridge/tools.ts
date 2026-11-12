/**
 * The MONITORING WORKS tools the tab names in its hello: name, what each may do, what it says it
 * does, and the arguments it takes.
 *
 * One list, so the guide (public/guide/*.md) cannot name a tool that does not exist — guide.test.ts
 * checks every `monitoring_*` it mentions against this — and so the relay's split between reading
 * and acting is declared here rather than inferred (matrix-tsunagi 0.11.0 marks `read` tools
 * readOnlyHint, and refuses a hello whose tools break its rules: name ^monitoring_[a-z0-9_]{1,52}$,
 * a non-empty description of at most 4 KB, an `object` inputSchema, 64 tools and 64 KB in all).
 *
 * `read`: answers from what the tab already holds. `control`: changes the tab's own state, its
 * record or its screen. Neither sends anything to the car by itself; a read the tab is asked to
 * take again (`refresh` on faults) goes through runGate like any other. Descriptions carry facts
 * about the tool; how to use it in a conversation is the guide's.
 *
 * `monitoring_guide` is answered by the relay from the guide the tab declared, and reserved there.
 */

export type ToolScope = 'read' | 'control';

export interface ToolDef {
    scope: ToolScope;
    description: string;
    inputSchema: { type: 'object'; properties: Record<string, unknown>; required?: string[]; additionalProperties: false };
}

const str = (description: string, extra: Record<string, unknown> = {}) => ({ type: 'string', description, ...extra });
const num = (description: string, extra: Record<string, unknown> = {}) => ({ type: 'number', description, ...extra });
const bool = (description: string) => ({ type: 'boolean', description });
const obj = (properties: Record<string, unknown>, required?: string[]): ToolDef['inputSchema'] => ({
    type: 'object',
    properties,
    ...(required ? { required } : {}),
    additionalProperties: false,
});

const RECORD = str('The investigation (CO-WORK record) id, from monitoring_cowork or monitoring_investigate. Omit for the one with the newest plan.');
const MODULE = str('A module id as the tab lists it: mss54 (DME), smg2, dsc_e46, …');
const CONFIRMED = bool('True only after the owner asked for this in their own words.');
const EVIDENCE = {
    type: 'object',
    description: 'Where in the data: a PROBE run of this record, seconds from and to in that run, the channels looked at, and how raw bytes were read when that matters.',
    properties: {
        run: num('Run number, from 1.'),
        from: num('Run seconds.'),
        to: num('Run seconds.'),
        channels: { type: 'array', items: { type: 'string' }, maxItems: 12 },
        decode: str('How raw bytes were turned into the number, when they were.'),
    },
    required: ['run', 'from', 'to', 'channels'],
    additionalProperties: false,
};

export const MONITORING_TOOLS = {
    monitoring_status: {
        scope: 'read',
        description:
            'The tab now: the device name, the link (module, practice or vehicle, connected, recording), the speed the DME last reported and whether the car is measured stationary, PROBE (running, plan version, progress), the mode (manual or probe), the session on the screen and its CO-WORK line (plan version, open questions), and its PROBE board as the owner left it (part ids, kinds, titles, open or closed, in their order). No VIN.',
        inputSchema: obj({}),
    },
    monitoring_faults: {
        scope: 'read',
        description:
            "Fault memories the tab has read: the module in session, and — without module, once monitoring_scan has run — every module the scan reached (answered, silent, refused, with the reason). For the MSS54 the decoded codes with their text from the module's own SGBD, present or past, frequency; for other modules the raw answer bytes, since the tab has no decoder for them. refresh: true asks the tab to read the module in session again, through its gate — while the car moves too (operator, 2026-11-04). No VIN.",
        inputSchema: obj({ module: MODULE, refresh: bool('Read the module in session again (gated; moving or parked).') }),
    },
    monitoring_catalog: {
        scope: 'read',
        description:
            "Jobs of a module from its own SGBD, matched against a query: name, description, kind (read, test, calibration, live), and whether this tab may send it now — and if not, the gate's reason (no certain telegram, needs an argument, not a read, withdrawn, car moving, standstill not measured). Also the ledger standing of each read.",
        inputSchema: obj(
            {
                module: MODULE,
                query: str('Words to match in the job name or description, in any language the catalogue carries.'),
                kind: str('read, test, calibration or live', { enum: ['read', 'test', 'calibration', 'live'] }),
                limit: num('At most this many jobs (default 12, max 40).'),
            },
            ['module'],
        ),
    },
    monitoring_cowork: {
        scope: 'read',
        description:
            'CO-WORK records on this device. Without record: each investigation with its mandate (the owner\'s words, modules, until), plan version and open questions. With record: its entries in order — mandate, plans (who wrote them, purpose, hypotheses with what would refute each, steps, judgements), step marks, the driver\'s words, facts, readings, questions and answers, status changes.',
        inputSchema: obj({ record: RECORD }),
    },
    monitoring_moment: {
        scope: 'read',
        description:
            'What the tab recorded around a moment: seconds_ago counts back from when the call reaches the tab. Returns the samples in the window (speed, rpm, throttle and the plan\'s channels), captures that fired, link gaps, and the driver\'s words in that window. Absent channels were not read, not zero.',
        inputSchema: obj({ seconds_ago: num('Seconds before the call reached the tab (default 8).'), window_s: num('Window width in seconds (default 20, max 180).') }),
    },
    monitoring_run_overview: {
        scope: 'read',
        description:
            "The PROBE run in progress or the last one: length, samples and rate, link gaps, each step's state (done, waiting, refused with the gate's reason, rejected by the module, failed), captures taken, and the judgements the tab computed with where each threshold came from.",
        inputSchema: obj({}),
    },
    monitoring_ledger: {
        scope: 'read',
        description:
            'The verification ledger: per module and job, whether it has answered with the car measured stationary, how often, whether the owner allowed it while moving, and whether it was withdrawn. Read-only: the owner allows reads while moving on the screen.',
        inputSchema: obj({ module: MODULE }),
    },
    monitoring_sessions: {
        scope: 'read',
        description:
            'Sessions saved on this device: label, date, module, practice or vehicle, what each holds (faults, samples, failures), and whether it has been sent. Also the episodes recorded but not kept yet (MEMORY), newest first: their start (the id to save one by), label, what each holds and the days left before it leaves the device. No VIN.',
        inputSchema: obj({ limit: num('At most this many, newest first (default 10).') }),
    },
    monitoring_investigate: {
        scope: 'control',
        description:
            "Start an investigation the owner handed over — or carry one on: a CO-WORK record whose first entry is the mandate, the owner's words as said, the modules it may read, how many days it stands (at most 30), and its mode. reactive (事後保全): a fault code is there, named in focus. predictive (予兆保全): no fault; every module and value, judged against pass criteria. symptom (症状): the owner's complaint. With record, the mandate is added to that record, so a periodic observation or a mandate that ran out carries the same plans and runs on. Plans written later must act under a standing mandate. Returns the record id and the mandate id.",
        inputSchema: obj(
            {
                words: str("The owner's own words handing it over, as said."),
                modules: { type: 'array', items: { type: 'string' }, description: 'Module ids it may read. Empty for any.' },
                days: num('How long it stands, 1-30.'),
                mode: str('reactive, predictive or symptom', { enum: ['reactive', 'predictive', 'symptom'] }),
                focus: { type: 'array', items: { type: 'string' }, maxItems: 12, description: 'reactive: the fault codes it follows, module:code (mss54:0x2A).' },
                record: str('The record to carry on, from monitoring_cowork. Omit to start a new one.'),
            },
            ['words', 'modules', 'days'],
        ),
    },
    monitoring_plan: {
        scope: 'control',
        description:
            "Write the next plan of a record, under its standing mandate: purpose, hypotheses (each with the observation that would refute it), steps (reads only: faults, read, sample, adapt, ram, capture), criteria and machine judgements (pass criteria, up to 24) with their provenance. The tab refuses a plan outside the mandate or with a step it cannot run, and says why. A running PROBE keeps its plan; the new one is taken when PROBE is next started (monitoring_probe or the screen).",
        inputSchema: obj(
            {
                record: RECORD,
                mandate: str('The mandate entry id it acts under.'),
                re: str('The plan entry this one rewrites (default: the current plan, as a new version of it).'),
                purpose: str('One line.'),
                hypotheses: { type: 'array', items: { type: 'object' }, description: '{id, text, refutedBy}' },
                criteria: str('The pass criteria, in words.'),
                judge: { type: 'array', items: { type: 'object' }, description: '{hypothesis, when, expect, provenance}' },
                steps: {
                    type: 'array',
                    items: { type: 'object' },
                    description:
                        'Steps, each {n, do, kind, …}: n numbers them from 1; do says what the step is for, in a line (required). kind and its fields — faults {module, when}: a module\'s fault memory; read {module, job, when}: a catalogue read job; sample {channels}: MSS54 live channels like 35:evan1_ist, or a whole block like 3:*; adapt {when}: the MSS54\'s learned values; ram {address, bytes, every}; capture {condition: [{channel, op, value}], preS, postS}. when is parked, moving or any. Example: {"n":1,"do":"intake VANOS actual vs target","kind":"sample","channels":["35:evan1_ist","35:evan1_soll"]}.',
                },
            },
            ['mandate', 'purpose', 'steps'],
        ),
    },
    monitoring_finding: {
        scope: 'control',
        description:
            'Add to a record: a fact (needs evidence), a reading (with sure: low, mid or high; re to stand beside another), a question (to: driver, owner or desk), an answer (re: the question id; the answerer\'s words), or a status (re: an entry id; status: withdrawn, agreed or disputed). Entries are only added, never changed.',
        inputSchema: obj(
            {
                record: RECORD,
                kind: str('fact, read, ask, answer or status', { enum: ['fact', 'read', 'ask', 'answer', 'status'] }),
                text: str('What it says. For an answer, the words as said.'),
                sure: str('low, mid or high (read)', { enum: ['low', 'mid', 'high'] }),
                evidence: EVIDENCE,
                re: str('The entry it answers, disputes or changes.'),
                to: str('Who a question is for (ask)', { enum: ['driver', 'owner', 'desk'] }),
                status: str('withdrawn, agreed or disputed (status)', { enum: ['withdrawn', 'agreed', 'disputed'] }),
            },
            ['kind'],
        ),
    },
    monitoring_note: {
        scope: 'control',
        description: "Keep the driver's own words in a record, on the clock of the PROBE run in progress if there is one. Only the driver's words: what the assistant thinks the driver did is a question (monitoring_finding ask).",
        inputSchema: obj({ record: RECORD, text: str('The words, as said.') }, ['text']),
    },
    monitoring_mark: {
        scope: 'control',
        description: 'Mark a plan step done, on the clock of the PROBE run in progress.',
        inputSchema: obj({ record: RECORD, n: num('The step number.') }, ['n']),
    },
    monitoring_scan: {
        scope: 'control',
        description:
            "Read every module's fault memory, one address at a time, without choosing a module: each module's own fault read (its SGBD's FS_LESEN frames) at its own address, through the tab's gate, while the car moves too (operator, 2026-11-04). Where several SGBDs share an address, only frames all of them carry are sent. Starts and answers at once; it takes about a second an address. monitoring_status shows progress, monitoring_faults (no module) the result. Only the MSS54 is decoded. The DSC MK60 (KWP2000-shaped frames on the same line) is asked only when the DME's speed, measured at its turn, is 0: its codes come back as an estimate (estimated: true) beside the bytes; on a moving car it alone is refused with that reason — scan again once stopped.",
        inputSchema: obj({}),
    },
    monitoring_module: {
        scope: 'control',
        description:
            "Put another module on the screen (DIAGNOSIS, SERVICE, the catalogue's 'in session'). If the link is open it is let go and opened again for the new module through the same door — the cable already allowed on this device, or PRACTICE — as a person does on the screen. Refused while a read, a recording or a PROBE run is going. The screen shows the switch.",
        inputSchema: obj({ module: str('The module id to put on the screen.') }, ['module']),
    },
    monitoring_probe: {
        scope: 'control',
        description:
            "Start a PROBE run: the record's current plan, under its standing mandate, on the open link (connected and idle). Reads only, every frame through the gate; parked-only steps wait for the car to stop. Answers once the run has begun (record, plan version, run number) or why not (no runnable plan, a fork, the mandate ended, already running). It runs until its steps are done or it is stopped (monitoring_stop_log, after a read-back).",
        inputSchema: obj({ record: RECORD }),
    },
    monitoring_compare: {
        scope: 'read',
        description:
            "Compare PROBE runs. Default: a record's last run against the run before it. run / against pick runs of the record; baseline {record, run} compares with a run of another record (a symptom against an earlier health check). Per value: count, mean, min, max in each and the change, the values that moved most for their own spread first; learned values; each module's fault answer, same or changed; each judgement in each run. trend: true with channels gives those values across every run of the record, oldest first. The runs' conditions (plan version, length, PRACTICE) are given: compare like with like.",
        inputSchema: obj({
            record: RECORD,
            run: num('The later run (default: the last).'),
            against: num('The earlier run of the same record (default: the one before).'),
            baseline: {
                type: 'object',
                description: 'A run of another record to compare against.',
                properties: { record: str('Its record id.'), run: num('Its run (default: its last).') },
                required: ['record'],
                additionalProperties: false,
            },
            channels: { type: 'array', items: { type: 'string' }, maxItems: 40, description: 'Only these values (19:v, adapt:6:lu_adapt). Required with trend.' },
            trend: bool('Follow the channels across every run of the record.'),
            limit: num('At most this many values (default 30, max 80).'),
        }),
    },
    monitoring_display: {
        scope: 'control',
        description:
            'Change what the screen shows: one of the tabs. MANUAL: diagnosis, datalog, adaptation, service, actuator, memory. PROBE: startup (the sessions), probe (the board). Showing a tab of the other mode switches the mode. pane: below 900 px the screen shows the tab’s rows (list) or its picture — values and graph (visu); setting it needs no tab. Starting a recording (monitoring_start_log) puts visu up. Showing only; nothing is sent to the car.',
        inputSchema: obj({
            show: str('The tab to show.', { enum: ['diagnosis', 'datalog', 'adaptation', 'service', 'actuator', 'memory', 'startup', 'probe'] }),
            pane: str('list or visu.', { enum: ['list', 'visu'] }),
        }),
    },
    monitoring_session: {
        scope: 'control',
        description:
            "PROBE sessions on STARTUP — the screen's NEW SESSION and NEXT. new: open an empty session on the screen; monitoring_investigate then starts it with the owner's words. next: carry a session that has taken data (record, default the one on the screen) into a new one — its mandate (the owner's words, modules, mode and focus, standing for as long as before) and its current form (the plan, same version) — linked to it, so the new session's runs are compared with the series before. The form a run took data under never changes: an item added or removed is a new plan version (monitoring_plan), counted from the next run. open: put a session on STARTUP and the board. Each puts PROBE's STARTUP on the screen. new and next need confirmed: true (the owner asked).",
        inputSchema: obj(
            {
                action: str('new, next or open', { enum: ['new', 'next', 'open'] }),
                record: str('The session (CO-WORK record) id: to open, or to carry on (default: the one on the screen).'),
                confirmed: CONFIRMED,
            },
            ['action'],
        ),
    },
    monitoring_show: {
        scope: 'control',
        description:
            "Place parts on a session's PROBE board (default: the session on the screen) and put the board on the screen. A part names what to show; the tab draws it from its own data, so no number reaches the screen from the assistant except inside a message. Kinds: message {text: one or two sentences, the assistant's own words}; faults {module: the module in session's fault read}; scan {every module's faults from the last monitoring_scan}; plan {the session's current form: purpose, hypotheses, steps, and the run in progress}; judges {run: a run's judgements with their provenance, default the last}; compare {run, against: {record, run}: two runs, default the run before or else the last run of the session this one follows — the items both measured, and those added or removed between their forms}; values {run, channels: a run's values — count, mean, min, max; live while the run goes}; graph {channels: [the value, its target?], context?: up to 6 channels drawn small beside it (3:n engine speed, 3:wdk1 throttle), seconds?: the window, 10-300, default 30, band?: how far from the target the value may be before its colour changes, in its unit — the value large, coloured by its distance from the target, value and target as two lines, live while the run goes; the first open graph is drawn large on the second pane, for a glance while driving}. Each may have a title (up to 60 characters). Parts go after those on the board; replace: true clears it first; remove takes part ids. Up to 12. The owner opens, closes and reorders them; monitoring_status reads the board back. Kept on this device only.",
        inputSchema: obj({
            record: RECORD,
            parts: {
                type: 'array',
                maxItems: 12,
                items: { type: 'object' },
                description: '{kind, title?, text?, module?, run?, against?: {record?, run?}, channels?, context?, seconds?, band?}',
            },
            replace: bool('Clear the board first.'),
            remove: { type: 'array', items: { type: 'string' }, description: 'Part ids to take off (p1, p2 …).' },
        }),
    },
    monitoring_stage: {
        scope: 'control',
        description:
            "Put a job on the screen — SERVICE, with the job selected, its preconditions, and the gate's answer — for a person to run there, parked. Sends nothing. Only for the module in session; the screen says why a job cannot run yet.",
        inputSchema: obj({ module: MODULE, job: str('The job id from monitoring_catalog.') }, ['module', 'job']),
    },
    monitoring_start_log: {
        scope: 'control',
        description:
            'Start recording the DATALOG channels selected (monitoring_log_channels chooses them; the answer names them). Only on the MSS54, connected, with nothing else running on the link; refused with the reason otherwise, and when no channel is selected. The recording runs while the car moves.',
        inputSchema: obj({}),
    },
    monitoring_log_channels: {
        scope: 'control',
        description:
            "DATALOG's channels: the MSS54's live values, named block:symbol (3:n engine speed, 3:toel oil temperature, 3:ub battery voltage, 35:evan1_ist / 35:evan1_soll intake VANOS actual and target, 35:avan1_ist / 35:avan1_soll exhaust VANOS). query: find channels by words in any language the catalogue carries (vanos, oil, 油温), with name, unit and block. channels: choose them — the whole selection, replacing the last; refused while recording. A block is one round trip whichever of its values are chosen, so values of one block cost nothing extra. Use these, not catalogue read jobs, for values to watch over time.",
        inputSchema: obj({
            query: str('Words to find channels by.'),
            channels: { type: 'array', items: { type: 'string' }, maxItems: 24, description: 'The channels to record, block:symbol (3:toel).' },
        }),
    },
    monitoring_datalog: {
        scope: 'read',
        description:
            'The DATALOG recording, in progress or the last one: the channels selected and the channels it recorded, whether it is running, how many samples over how many seconds, and per channel the count, mean, min and max with name and unit; and the samples thinned evenly (at most max, default 60). seconds takes only the last so many seconds; channels only those. Absent values were not read, not zero.',
        inputSchema: obj({
            channels: { type: 'array', items: { type: 'string' }, maxItems: 24, description: 'Only these recorded channels.' },
            seconds: num('Only the last so many seconds.'),
            max: num('At most this many samples in the trace (0-240, default 60).'),
        }),
    },
    monitoring_stop_log: {
        scope: 'control',
        description: 'Stop the recording or the PROBE run in progress. Only with confirmed: true, after the request was read back to the driver and answered with a clear yes.',
        inputSchema: obj({ confirmed: bool('True only after the read-back was answered yes.') }, ['confirmed']),
    },
    monitoring_save: {
        scope: 'control',
        description:
            "Save on this device (the screen's SAVE): the episode in progress — identity, faults, recordings, learned values, procedures and failures — or, with episode, one from the not-kept list (monitoring_sessions). For \"save the one just now\", read the list, say which episode you mean (its time and what it holds), then save it. Returns what was kept. PROBE runs are not in it and need no save: they are kept with their investigation as they end (probeRuns in the answer says how many), so sampleCount 0 after a PROBE run is not a loss.",
        inputSchema: obj({ confirmed: CONFIRMED, episode: num('The start of a not-kept episode, from monitoring_sessions. Omit for the one in progress.') }, ['confirmed']),
    },
    monitoring_sync_upload: {
        scope: 'control',
        description: "Save, then send every session the owner's account does not have yet (the screen's SYNC). Returns how many were sent, or why not (signed out, offline).",
        inputSchema: obj({ confirmed: CONFIRMED }, ['confirmed']),
    },
    monitoring_connect: {
        scope: 'control',
        description:
            "Connect again to the car through the cable this device has already been allowed — the one a person connected on the screen before (operator, 2026-10-28). Never asks for a new device: with none allowed yet the answer says so, and the first connection is made on the screen. Connects to the car (not PRACTICE), to the module the screen has selected. The owner's own words ('つないで') are the yes: confirmed: true.",
        inputSchema: obj({ confirmed: CONFIRMED }, ['confirmed']),
    },
    monitoring_disconnect: {
        scope: 'control',
        description:
            "Let the cable go (the screen's DISCONNECT). If a recording or a PROBE run is going, the answer says so and nothing changes: read back that it will stop, and only after a clear yes call again with stop_recording: true. Refused while a read is in flight.",
        inputSchema: obj(
            { confirmed: CONFIRMED, stop_recording: bool('True only after the read-back that the recording or PROBE run will stop was answered yes.') },
            ['confirmed'],
        ),
    },
    monitoring_open_tuner: {
        scope: 'control',
        description:
            "Move this tab to TUNER WORKS (MAPPING: the DME's calibration and its logs), in the same tab, when the owner asks for it — an answer that is a map belongs there. The cable is let go first. Refused while a recording or a PROBE run is going (stop it first) and while a read is in flight. If anything on the screen is unsaved, the answer says so: save it, or read back what would be lost and call again with discard_unsaved: true after a clear yes. Afterwards the assistant reaches TUNER's tab, through TUNER's tools.",
        inputSchema: obj(
            { confirmed: CONFIRMED, discard_unsaved: bool('True only after the owner, told what is unsaved, said yes to losing it.') },
            ['confirmed'],
        ),
    },
} as const satisfies Record<string, ToolDef>;

export type MonitoringToolName = keyof typeof MONITORING_TOOLS;

/** Answered by the relay from the guide the tab declared; never by the tab. */
export const GUIDE_TOOL = 'monitoring_guide';

/**
 * Held by the relay itself and answered without the tab, for the operator only: the operator's words
 * to the development desk, and its answers (functions/api/bridge/dev-*, docs/AUTONOMY.md §7).
 */
export const RELAY_DEV_TOOLS = ['monitoring_dev_request', 'monitoring_dev_status'] as const;

/** The tools as the hello declares them. */
export function helloTools(): Array<{ name: string; description: string; inputSchema: ToolDef['inputSchema']; scope: ToolScope }> {
    return (Object.entries(MONITORING_TOOLS) as [MonitoringToolName, ToolDef][]).map(([name, d]) => ({
        name,
        description: d.description,
        inputSchema: d.inputSchema,
        scope: d.scope,
    }));
}

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
            'The tab now: the device name, the link (module, practice or vehicle, connected, recording), the speed the DME last reported and whether the car is measured stationary, PROBE (running, plan version, progress), and the CO-WORK line (plan version, open questions). No VIN.',
        inputSchema: obj({}),
    },
    monitoring_faults: {
        scope: 'read',
        description:
            "Fault memories the tab has read, per module: for the MSS54 the decoded codes with their text from the module's own SGBD, present or past, frequency; for other modules the raw answer bytes, since the tab has no decoder for them. refresh: true asks the tab to read the module in session again — parked only, through its gate. No VIN.",
        inputSchema: obj({ module: MODULE, refresh: bool('Read the module in session again (parked, gated).') }),
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
        description: 'Sessions saved on this device: label, date, module, practice or vehicle, what each holds (faults, samples, failures), and whether it has been sent. No VIN.',
        inputSchema: obj({ limit: num('At most this many, newest first (default 10).') }),
    },
    monitoring_investigate: {
        scope: 'control',
        description:
            "Start an investigation the owner handed over: a new CO-WORK record whose first entry is the mandate — the owner's words as said, the modules it may read, and how many days it stands (at most 30). Plans written later must act under it. Returns the record id and the mandate id.",
        inputSchema: obj(
            {
                words: str("The owner's own words handing it over, as said."),
                modules: { type: 'array', items: { type: 'string' }, description: 'Module ids it may read. Empty for any.' },
                days: num('How long it stands, 1-30.'),
            },
            ['words', 'modules', 'days'],
        ),
    },
    monitoring_plan: {
        scope: 'control',
        description:
            "Write the next plan of a record, under its standing mandate: purpose, hypotheses (each with the observation that would refute it), steps (reads only: faults, read, sample, ram, capture, each with when: parked, moving or any), criteria and machine judgements with their provenance. The tab refuses a plan outside the mandate or with a step it cannot run, and says why. A running PROBE keeps its plan; the new one is taken when PROBE is next started on the screen.",
        inputSchema: obj(
            {
                record: RECORD,
                mandate: str('The mandate entry id it acts under.'),
                re: str('The plan entry this one rewrites.'),
                purpose: str('One line.'),
                hypotheses: { type: 'array', items: { type: 'object' }, description: '{id, text, refutedBy}' },
                criteria: str('The pass criteria, in words.'),
                judge: { type: 'array', items: { type: 'object' }, description: '{hypothesis, when, expect, provenance}' },
                steps: { type: 'array', items: { type: 'object' }, description: 'faults|read|sample|ram|capture steps, numbered n from 1.' },
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
    monitoring_display: {
        scope: 'control',
        description: 'Change what the screen shows: one of the tabs (diagnosis, datalog, adaptation, service, actuator, sessions). Showing only; nothing is sent to the car.',
        inputSchema: obj({ show: str('The tab to show.', { enum: ['diagnosis', 'datalog', 'adaptation', 'service', 'actuator', 'sessions'] }) }, ['show']),
    },
    monitoring_stage: {
        scope: 'control',
        description:
            "Put a job on the screen — SERVICE, with the job selected, its preconditions, and the gate's answer — for a person to run there, parked. Sends nothing. Only for the module in session; the screen says why a job cannot run yet.",
        inputSchema: obj({ module: MODULE, job: str('The job id from monitoring_catalog.') }, ['module', 'job']),
    },
    monitoring_start_log: {
        scope: 'control',
        description: 'Start recording the DATALOG channels selected on the screen. Only on the MSS54, connected, with nothing else running on the link; refused with the reason otherwise.',
        inputSchema: obj({}),
    },
    monitoring_stop_log: {
        scope: 'control',
        description: 'Stop the recording or the PROBE run in progress. Only with confirmed: true, after the request was read back to the driver and answered with a clear yes.',
        inputSchema: obj({ confirmed: bool('True only after the read-back was answered yes.') }, ['confirmed']),
    },
    monitoring_save: {
        scope: 'control',
        description: "Save the session on this device (the screen's SAVE): identity, faults, recording and failures. Returns what was kept.",
        inputSchema: obj({ confirmed: CONFIRMED }, ['confirmed']),
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

/** The tools as the hello declares them. */
export function helloTools(): Array<{ name: string; description: string; inputSchema: ToolDef['inputSchema']; scope: ToolScope }> {
    return (Object.entries(MONITORING_TOOLS) as [MonitoringToolName, ToolDef][]).map(([name, d]) => ({
        name,
        description: d.description,
        inputSchema: d.inputSchema,
        scope: d.scope,
    }));
}

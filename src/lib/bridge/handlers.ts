/**
 * What this tab answers when its owner's assistant asks: one handler per tool in tools.ts.
 *
 * The page supplies a facade (hooks/useMonitoringFacade) and this file holds the rules that do not
 * depend on React, so vitest can hold them: which record a call means, who an entry is written as,
 * what a moment and a run look like to the assistant. Every answer is built from what the tab
 * already holds; the only one that adds a frame to the K-line is `monitoring_faults` with
 * `refresh`, and that goes through the gate like the screen's READ.
 *
 * Who an entry is written as follows the CO-WORK rules (notebook/rules.ts): the assistant relays
 * the owner's words as the driver's — a mandate, a note, an answer, withdrawing a mandate — and
 * writes its own work as `chat` — a plan, a fact, a reading, a question, a step mark.
 *
 * NOT run a test or an adjustment, clear faults, write or flash, or allow a new device. There is no
 * tool for those, and the facade has no method that could reach them. What the assistant does
 * reach adds no new kind of frame: a scan is each module's own fault read, a module switch is the
 * screen's DISCONNECT and CONNECT, and a PROBE run sends reads through runGate.
 */
import { boardLine, place, type Board } from '../probe/board';
import { compareRuns, trend } from '../probe/compare';
import type { ProbeLive, StoredRun } from '../probe/runStore';
import { formOf, lineage, nextSession, type NextRefusal } from '../probe/sessions';
import { TAB_ORDER, type Mode, type Tab } from '../tabs';
import {
    INVESTIGATION_MODES,
    currentPlan,
    liveMandate,
    nextPlanVersion,
    notebookLine,
    openAsks,
    statusOf,
    type InvestigationMode,
    type NotebookAuthor,
    type NotebookBody,
    type NotebookEntry,
} from '../notebook/rules';
import type { MonitoringToolName } from './tools';

export type Handler = (args: Record<string, unknown>) => Promise<unknown>;

/** A fault read as it came back: decoded entries for the MSS54, the frames and bytes for the rest. */
export interface FreshFaults {
    faults: unknown[] | null;
    raw: Array<{ request: string; response: string; source: string }> | null;
}

export interface TabFacade {
    now(): number;
    newId(): string;
    /** The tab now, without the CO-WORK line (added here). */
    status(): Record<string, unknown>;
    /** The module in session, or — with no module named and a scan kept — every module. `fresh` is
     *  what a refresh just read, which the screen's state may not hold yet. */
    faults(module: string | undefined, fresh?: FreshFaults): unknown;
    /** Read the module in session again, through the gate: why it was not sent (a sentence), or what it read. */
    refreshFaults(): Promise<string | { fresh: FreshFaults | null }>;
    catalog(q: { module: string; query?: string; kind?: string; limit: number }): Promise<unknown>;
    entries(): Promise<NotebookEntry[]>;
    /** Throws the CO-WORK rule's sentence when an entry is refused. */
    add(entries: NotebookEntry[]): Promise<void>;
    /** The PROBE run in progress, or null. */
    live(): ProbeLive | null;
    lastRun(): StoredRun | null;
    ledger(module: string | undefined): unknown;
    sessions(limit: number): Promise<unknown>;
    display(tab: Tab): void;
    stage(module: string, job: string): Promise<unknown>;
    /** Null when it started; otherwise why not. */
    startLog(): string | null;
    /** DATALOG: what is selected and recording now, and the run summed up (lib/datalogQuery). */
    datalog(opts: { channels?: string[]; seconds?: number; max?: number }): unknown;
    /** DATALOG's channels: find them by words, or choose them (refused while recording). */
    logChannels(q: { query?: string; channels?: string[] }): unknown;
    /** What was stopped, or null when nothing was running. */
    stopLog(): 'recording' | 'probe' | null;
    /** The episode in progress, or the not-kept one starting at `episode`. */
    save(episode?: number): Promise<unknown>;
    sync(): Promise<unknown>;
    /** Leave for TUNER WORKS, or say why not (running, unsaved). */
    openTuner(discardUnsaved: boolean): unknown;
    /** Connect again through an already-allowed cable, or say why not. */
    connect(): Promise<unknown>;
    /** Let the cable go, or say why not (a recording to stop first). */
    disconnect(stopRecording: boolean): Promise<unknown>;
    /** Start reading every module's fault memory; the answer says it began, or why not. */
    scan(): Promise<unknown>;
    /** Put another module on the screen, opening the link again for it if it was open. */
    switchModule(id: string): Promise<unknown>;
    /** Start a PROBE run of a record's plan (the newest runnable one when none is named). */
    probe(record: string | undefined): Promise<unknown>;
    /** The PROBE runs kept for a record, oldest first. */
    runs(record: string): Promise<StoredRun[]>;
    /** MANUAL or PROBE: the mode the screen is in. */
    mode(): Mode;
    /** The PROBE session opened on the screen (STARTUP, the board), or null when none was opened. */
    session(): string | null;
    /** Open a session on STARTUP and the board. */
    openSession(record: string): void;
    /** NEW SESSION: an empty session opened on the screen; its id. */
    newSession(): string;
    /** A session's PROBE board, and keeping it (lib/probe/board). */
    board(record: string): Promise<Board>;
    putBoard(board: Board): Promise<void>;
}

const DAY_MS = 86_400_000;
const TABS: readonly Tab[] = TAB_ORDER;

/** Why NEXT did not carry a session on, as the assistant relays it. */
const NEXT_WHY: Record<NextRefusal, string> = {
    'no-mandate': 'This session has no mandate: there is nothing of the owner’s to carry on. monitoring_investigate starts it.',
    'no-plan': 'This session has no form yet (no plan): write one with monitoring_plan, take data, then carry it on.',
    forked: 'Two plans rewrite the same one in this session; the owner chooses which to keep before it is carried on.',
    'no-data': 'This session has taken no data yet (no PROBE run): NEXT carries on a form that has been measured with. Run it first (monitoring_probe).',
};
/** Samples a moment returns at most; thinned evenly beyond this. */
const MOMENT_SAMPLES = 120;

const text = (v: unknown, name: string): string => {
    if (typeof v !== 'string' || !v.trim()) throw new Error(`${name} is required`);
    return v.trim();
};
const optText = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const clamp = (v: unknown, lo: number, hi: number, dflt: number) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : dflt;

function bySession(entries: readonly NotebookEntry[]): Map<string, NotebookEntry[]> {
    const out = new Map<string, NotebookEntry[]>();
    for (const e of entries) out.set(e.sessionId, [...(out.get(e.sessionId) ?? []), e]);
    return out;
}

/**
 * The record a call means: the one named, or — when none is — the one whose current plan was
 * written last, else the one written to last.
 */
export function pickRecord(entries: readonly NotebookEntry[], named: unknown): { id: string; entries: NotebookEntry[] } {
    const records = bySession(entries);
    if (typeof named === 'string' && named) {
        const r = records.get(named);
        if (!r) throw new Error(`There is no record ${named} on this device. monitoring_cowork lists them.`);
        return { id: named, entries: r };
    }
    let best: { id: string; entries: NotebookEntry[]; at: number; planned: boolean } | null = null;
    for (const [id, r] of records) {
        const plan = currentPlan(r).plan;
        const at = plan ? plan.at : r[r.length - 1].at;
        const planned = plan !== null;
        if (!best || (planned && !best.planned) || (planned === best.planned && at > best.at)) best = { id, entries: r, at, planned };
    }
    if (!best) throw new Error('There is no investigation on this device yet. monitoring_investigate starts one with the owner’s words.');
    return { id: best.id, entries: best.entries };
}

function summary(id: string, r: readonly NotebookEntry[], now: number) {
    const mandates = r.filter((e) => e.body.kind === 'mandate');
    const m = mandates[mandates.length - 1];
    const { plan, forked } = currentPlan(r);
    return {
        record: id,
        mandate: m && m.body.kind === 'mandate'
            ? {
                  id: m.id,
                  words: m.body.words,
                  mode: m.body.mode ?? null,
                  focus: m.body.focus ?? [],
                  modules: m.body.modules,
                  until: new Date(m.body.until).toISOString(),
                  standing: liveMandate(r, m.id, now) !== null,
              }
            : null,
        plan: plan ? { id: plan.id, v: plan.body.v, by: plan.by, purpose: plan.body.purpose, forked } : null,
        openQuestions: openAsks(r).length,
        entries: r.length,
        line: notebookLine(r),
    };
}

/** Evenly thinned to at most `max`, first and last kept. */
function thin<T>(xs: readonly T[], max: number): T[] {
    if (xs.length <= max) return [...xs];
    const out: T[] = [];
    for (let i = 0; i < max; i++) out.push(xs[Math.round((i * (xs.length - 1)) / (max - 1))]);
    return out;
}

export function bridgeHandlers(f: TabFacade): Record<MonitoringToolName, Handler> {
    const write = async (record: string, by: NotebookAuthor, body: NotebookBody) => {
        const entry: NotebookEntry = { id: f.newId(), sessionId: record, at: f.now(), by, body };
        await f.add([entry]);
        return entry;
    };
    /**
     * The record a call means when it names none: the session opened on the screen, else the one
     * with the newest plan. A session NEW SESSION opened has nothing in it until the owner's words
     * start it, so a call that needs a record refuses it rather than writing beside the screen.
     */
    const resolve = async (named: unknown, fresh: 'accept' | 'refuse' = 'refuse'): Promise<{ id: string; entries: NotebookEntry[] }> => {
        const entries = await f.entries();
        if (typeof named === 'string' && named) return pickRecord(entries, named);
        const open = f.session();
        if (open) {
            const r = entries.filter((e) => e.sessionId === open);
            if (r.length > 0 || fresh === 'accept') return { id: open, entries: r };
            throw new Error(`The session on the screen (${open}) is new and empty: monitoring_investigate starts it with the owner’s words.`);
        }
        return pickRecord(entries, undefined);
    };
    /** The clock of the run in progress, when it is this record's. */
    const clock = (record: string) => {
        const live = f.live();
        return live && live.sessionId === record ? { run: live.n, t: Math.round((f.now() - live.startedAt) / 100) / 10 } : null;
    };

    return {
        monitoring_status: async () => {
            let cowork: string | null = null;
            let session: string | null = null;
            try {
                const r = await resolve(undefined, 'accept');
                session = r.id;
                cowork = notebookLine(r.entries);
            } catch {
                /* no record yet */
            }
            const board = session ? boardLine(await f.board(session).catch(() => ({ record: session!, parts: [], seq: 0 }))) : [];
            return { ...f.status(), mode: f.mode(), cowork, session, board };
        },

        monitoring_faults: async (args) => {
            const moduleId = optText(args.module);
            if (args.refresh === true) {
                const r = await f.refreshFaults();
                if (typeof r === 'string') return { refreshed: false, reason: r, faults: await f.faults(moduleId) };
                // What was just read, not what the screen held when this call began: its state
                // reaches the next render, after this answer has gone.
                return { refreshed: true, faults: await f.faults(moduleId, r.fresh ?? undefined) };
            }
            return { refreshed: args.refresh === true, faults: await f.faults(moduleId) };
        },

        monitoring_catalog: async (args) =>
            f.catalog({
                module: text(args.module, 'module'),
                query: optText(args.query),
                kind: optText(args.kind),
                limit: Math.round(clamp(args.limit, 1, 40, 12)),
            }),

        monitoring_cowork: async (args) => {
            const entries = await f.entries();
            const now = f.now();
            if (typeof args.record !== 'string' || !args.record) {
                return { records: [...bySession(entries)].map(([id, r]) => summary(id, r, now)) };
            }
            const r = pickRecord(entries, args.record);
            return {
                ...summary(r.id, r.entries, now),
                list: r.entries.map((e) => ({ id: e.id, at: new Date(e.at).toISOString(), by: e.by, status: statusOf(r.entries, e.id), ...e.body })),
            };
        },

        monitoring_moment: async (args) => {
            const secondsAgo = clamp(args.seconds_ago, 0, 3600, 8);
            const windowS = clamp(args.window_s, 2, 180, 20);
            const live = f.live();
            const run = live ?? f.lastRun();
            if (!run) return { recorded: false, reason: 'Nothing has been recorded by PROBE on this tab yet.' };
            const n = run.n;
            const record = run.sessionId;
            const centre = (f.now() - secondsAgo * 1000 - run.startedAt) / 1000;
            const from = centre - windowS / 2;
            const to = centre + windowS / 2;
            const inWindow = run.samples.filter((s) => s.t >= from && s.t <= to);
            const captures = live ? [] : (run as StoredRun).captures.filter((c) => c.to >= from && c.from <= to);
            const notes = (await f.entries()).filter(
                (e) => e.sessionId === record && e.body.kind === 'note' && e.body.run === n && e.body.t !== null && e.body.t >= from && e.body.t <= to,
            );
            if (inWindow.length === 0) {
                return {
                    recorded: false,
                    run: n,
                    reason: centre < 0 ? 'That moment is before the run began.' : 'No samples in that window: the link may have been down, or PROBE stopped.',
                };
            }
            return {
                recorded: true,
                run: n,
                running: live !== null,
                window: { from: Math.max(0, Math.round(from)), to: Math.round(to), centre: Math.round(centre) },
                samples: thin(inWindow, MOMENT_SAMPLES),
                captures,
                driverWords: notes.map((e) => ({ t: e.body.kind === 'note' ? e.body.t : null, text: e.body.kind === 'note' ? e.body.text : '' })),
            };
        },

        monitoring_run_overview: async () => {
            const live = f.live();
            if (live) {
                const seconds = (f.now() - live.startedAt) / 1000;
                return {
                    running: true,
                    record: live.sessionId,
                    run: live.n,
                    planV: live.planV,
                    seconds: Math.round(seconds),
                    samples: live.samples.length,
                    rateHz: seconds > 0 ? Math.round((live.samples.length / seconds) * 10) / 10 : null,
                };
            }
            const r = f.lastRun();
            if (!r) return { running: false, reason: 'No PROBE run on this tab yet.' };
            const seconds = (r.endedAt - r.startedAt) / 1000;
            const outcomes: Record<string, number> = {};
            for (const x of r.exchanges) outcomes[x.outcome] = (outcomes[x.outcome] ?? 0) + 1;
            return {
                running: false,
                record: r.sessionId,
                run: r.n,
                planV: r.planV,
                end: r.end,
                seconds: Math.round(seconds),
                samples: r.samples.length,
                rateHz: seconds > 0 ? Math.round((r.samples.length / seconds) * 10) / 10 : null,
                steps: r.steps,
                exchanges: outcomes,
                captures: r.captures.length,
                judges: r.judges,
            };
        },

        monitoring_ledger: async (args) => f.ledger(optText(args.module)),

        monitoring_sessions: async (args) => f.sessions(Math.round(clamp(args.limit, 1, 50, 10))),

        monitoring_investigate: async (args) => {
            const words = text(args.words, 'words');
            const modules = Array.isArray(args.modules) ? args.modules.filter((m): m is string => typeof m === 'string') : [];
            const days = clamp(args.days, 1, 30, 7);
            const mode = INVESTIGATION_MODES.includes(args.mode as InvestigationMode) ? (args.mode as InvestigationMode) : undefined;
            const focus = Array.isArray(args.focus) ? args.focus.filter((x): x is string => typeof x === 'string') : [];
            // Named: the same record carries on — a periodic observation, or a mandate run out —
            // so its plans and runs stay one history. Otherwise a new one.
            const named = optText(args.record);
            // A session NEW SESSION opened on the screen is started by these words; otherwise a new one.
            const open = f.session();
            const fresh = open && !(await f.entries()).some((e) => e.sessionId === open) ? open : null;
            const record = named ? pickRecord(await f.entries(), named).id : (fresh ?? f.newId());
            const at = f.now();
            // The owner's words handing it over: written as theirs, which is what lets it stand.
            const mandate: NotebookEntry = {
                id: f.newId(),
                sessionId: record,
                at,
                by: 'driver',
                body: { kind: 'mandate', words, modules, until: at + days * DAY_MS, ...(mode ? { mode } : {}), ...(focus.length ? { focus } : {}) },
            };
            await f.add([mandate]);
            f.openSession(record);
            return { record, mandate: mandate.id, mode: mode ?? null, focus, modules, until: new Date(at + days * DAY_MS).toISOString(), continued: !!named };
        },

        monitoring_plan: async (args) => {
            const r = await resolve(args.record);
            // With no `re`, the plan rewrites the current one: a new version of the session's form.
            // Two plans rewriting one is a fork, which is the owner's to settle; an omitted `re` is
            // not a decision to make one.
            const head = currentPlan(r.entries);
            const body: NotebookBody = {
                kind: 'plan',
                v: nextPlanVersion(r.entries),
                re: optText(args.re) ?? (head.plan && !head.forked ? head.plan.id : undefined),
                mandate: optText(args.mandate),
                purpose: text(args.purpose, 'purpose'),
                hypotheses: Array.isArray(args.hypotheses) ? (args.hypotheses as never) : undefined,
                criteria: optText(args.criteria),
                judge: Array.isArray(args.judge) ? (args.judge as never) : undefined,
                steps: (Array.isArray(args.steps) ? args.steps : []) as never,
            };
            const e = await write(r.id, 'chat', body);
            const runs = (await f.runs(r.id)).length;
            return {
                record: r.id,
                id: e.id,
                v: body.v,
                taken: 'when PROBE is next started on the screen',
                // The form a run took data under never changes: this version counts from the next run.
                ...(runs > 0 ? { form: `v${body.v} is a new version: runs 1-${runs} keep the form they ran; its items count from run ${runs + 1}.` } : {}),
            };
        },

        monitoring_finding: async (args) => {
            const r = await resolve(args.record);
            const kind = text(args.kind, 'kind');
            let by: NotebookAuthor = 'chat';
            let body: NotebookBody;
            switch (kind) {
                case 'fact':
                    body = { kind: 'fact', text: text(args.text, 'text'), evidence: args.evidence as never };
                    break;
                case 'read':
                    body = { kind: 'read', text: text(args.text, 'text'), sure: args.sure as never, evidence: (args.evidence ?? undefined) as never, re: optText(args.re) };
                    break;
                case 'ask':
                    body = { kind: 'ask', to: args.to as never, text: text(args.text, 'text') };
                    break;
                case 'answer':
                    // The answer is the person's words, relayed.
                    by = 'driver';
                    body = { kind: 'answer', re: text(args.re, 're'), text: text(args.text, 'text') };
                    break;
                case 'status': {
                    const re = text(args.re, 're');
                    // Withdrawing a mandate is the owner's decision, as giving it was.
                    if (r.entries.find((e) => e.id === re)?.body.kind === 'mandate') by = 'driver';
                    body = { kind: 'status', re, to: args.status as never };
                    break;
                }
                default:
                    throw new Error('kind must be fact, read, ask, answer or status');
            }
            const e = await write(r.id, by, body);
            return { record: r.id, id: e.id, kind };
        },

        monitoring_note: async (args) => {
            const r = await resolve(args.record, 'accept');
            const c = clock(r.id);
            const e = await write(r.id, 'driver', { kind: 'note', run: c?.run ?? null, t: c?.t ?? null, text: text(args.text, 'text'), via: 'voice' });
            return { record: r.id, id: e.id, run: c?.run ?? null, t: c?.t ?? null };
        },

        monitoring_mark: async (args) => {
            const r = await resolve(args.record);
            const c = clock(r.id);
            if (!c) throw new Error('No PROBE run of this record is in progress; a step is marked on a run’s clock.');
            const n = typeof args.n === 'number' ? args.n : NaN;
            const e = await write(r.id, 'chat', { kind: 'step', run: c.run, t: c.t, n });
            return { record: r.id, id: e.id, run: c.run, t: c.t, n };
        },

        monitoring_display: async (args) => {
            const tab = args.show as Tab;
            if (!TABS.includes(tab)) throw new Error(`show must be one of ${TABS.join(', ')}`);
            f.display(tab);
            return { shown: tab };
        },

        monitoring_stage: async (args) => f.stage(text(args.module, 'module'), text(args.job, 'job')),

        monitoring_start_log: async () => {
            const refused = f.startLog();
            if (refused) throw new Error(refused);
            return { started: true, ...(f.datalog({ max: 0 }) as Record<string, unknown>) };
        },

        monitoring_datalog: async (args) =>
            f.datalog({
                channels: Array.isArray(args.channels) ? args.channels.filter((c): c is string => typeof c === 'string') : undefined,
                seconds: typeof args.seconds === 'number' && args.seconds > 0 ? args.seconds : undefined,
                max: Math.round(clamp(args.max, 0, 240, 60)),
            }),

        monitoring_log_channels: async (args) =>
            f.logChannels({
                query: optText(args.query),
                channels: Array.isArray(args.channels) ? args.channels.filter((c): c is string => typeof c === 'string') : undefined,
            }),

        monitoring_stop_log: async (args) => {
            if (args.confirmed !== true) {
                throw new Error('Read the request back to the driver, and call again with confirmed: true only after a clear yes.');
            }
            const stopped = f.stopLog();
            return stopped ? { stopped } : { stopped: null, reason: 'Nothing was recording.' };
        },

        monitoring_save: async (args) => {
            if (args.confirmed !== true) throw new Error('Save when the owner asks for it, with confirmed: true.');
            return f.save(typeof args.episode === 'number' ? args.episode : undefined);
        },

        monitoring_sync_upload: async (args) => {
            if (args.confirmed !== true) throw new Error('Send when the owner asks for it, with confirmed: true.');
            return f.sync();
        },

        monitoring_connect: async (args) => {
            if (args.confirmed !== true) throw new Error('Connect when the owner asks for it, with confirmed: true.');
            return f.connect();
        },

        monitoring_disconnect: async (args) => {
            if (args.confirmed !== true) throw new Error('Disconnect when the owner asks for it, with confirmed: true.');
            return f.disconnect(args.stop_recording === true);
        },

        monitoring_open_tuner: async (args) => {
            if (args.confirmed !== true) throw new Error('Open TUNER when the owner asks for it, with confirmed: true.');
            return f.openTuner(args.discard_unsaved === true);
        },

        monitoring_scan: async () => f.scan(),

        monitoring_module: async (args) => f.switchModule(text(args.module, 'module')),

        monitoring_probe: async (args) => {
            const named = optText(args.record);
            // Resolve a named record here, so a typo is said as such rather than as "no plan"; with
            // none named, the session on the screen, else the newest runnable plan.
            const open = f.session();
            const record = named ? pickRecord(await f.entries(), named).id : (open ?? undefined);
            return f.probe(record);
        },

        monitoring_session: async (args) => {
            const action = text(args.action, 'action');
            if (action === 'open') {
                const r = pickRecord(await f.entries(), text(args.record, 'record'));
                f.openSession(r.id);
                f.display('startup');
                return { opened: r.id, screen: 'startup' };
            }
            if (action !== 'new' && action !== 'next') throw new Error('action must be new, next or open');
            if (args.confirmed !== true) throw new Error('Start or carry on a session when the owner asks for it, with confirmed: true.');
            if (action === 'new') {
                const id = f.newSession();
                f.display('startup');
                return { record: id, fresh: true, screen: 'startup', then: 'monitoring_investigate with the owner’s words starts it.' };
            }
            const r = await resolve(args.record);
            const runs = (await f.runs(r.id)).length;
            const next = nextSession(await f.entries(), r.id, runs, { now: f.now(), newId: f.newId, by: 'driver' });
            if (!next.ok) throw new Error(NEXT_WHY[next.reason]);
            await f.add(next.entries);
            f.openSession(next.record);
            f.display('startup');
            const [m, p] = next.entries;
            return {
                record: next.record,
                follows: r.id,
                mandate: m.id,
                until: m.body.kind === 'mandate' ? new Date(m.body.until).toISOString() : null,
                plan: p.body.kind === 'plan' ? { id: p.id, v: p.body.v } : null,
                screen: 'startup',
                then: 'Its runs are compared with the series before it (monitoring_compare). Items added or removed are a new plan version (monitoring_plan).',
            };
        },

        monitoring_show: async (args) => {
            const r = await resolve(args.record);
            const parts = Array.isArray(args.parts) ? args.parts : [];
            const remove = Array.isArray(args.remove) ? args.remove.filter((x): x is string => typeof x === 'string') : [];
            if (parts.length === 0 && remove.length === 0 && args.replace !== true) {
                throw new Error('parts is required: what to place on the board (monitoring_guide board).');
            }
            const { board, placed } = place(await f.board(r.id), parts, { replace: args.replace === true, remove, now: f.now() });
            await f.putBoard(board);
            f.openSession(r.id);
            f.display('probe');
            return { record: r.id, placed, board: boardLine(board), screen: 'probe' };
        },

        monitoring_compare: async (args) => {
            const r = await resolve(args.record);
            const entries = await f.entries();
            const runs = await f.runs(r.id);
            const series = lineage(entries, r.id);
            const channels = Array.isArray(args.channels) ? args.channels.filter((c): c is string => typeof c === 'string').slice(0, 40) : [];
            if (args.trend === true) {
                if (channels.length === 0) throw new Error('trend needs channels: the values to follow across the runs.');
                // The whole series: every session NEXT linked to this one, oldest first.
                const all = (await Promise.all(series.map((id) => (id === r.id ? Promise.resolve(runs) : f.runs(id))))).flat();
                return { record: r.id, series, runs: all.length, trend: trend(all, channels) };
            }
            const byN = (list: StoredRun[], n: unknown, from: string) => {
                const run = typeof n === 'number' ? list.find((x) => x.n === n) : list[list.length - 1];
                if (!run) throw new Error(typeof n === 'number' ? `There is no run ${n} in ${from}.` : `${from} has no PROBE run yet.`);
                return run;
            };
            const base = args.baseline as { record?: unknown; run?: unknown } | undefined;
            let a: StoredRun;
            let b: StoredRun;
            if (base && typeof base === 'object') {
                const other = pickRecord(await f.entries(), base.record).id;
                a = byN(await f.runs(other), base.run, `record ${other}`);
                b = byN(runs, args.run, `record ${r.id}`);
            } else {
                b = byN(runs, args.run, `record ${r.id}`);
                const before = runs.filter((x) => x.n < b.n);
                const prevSession = series.length > 1 ? series[series.length - 2] : null;
                if (typeof args.against === 'number') a = byN(runs, args.against, `record ${r.id}`);
                else if (before.length > 0) a = before[before.length - 1];
                // The first run of a session NEXT started: against the last run of the one it follows.
                else if (prevSession) a = byN(await f.runs(prevSession), undefined, `record ${prevSession}`);
                else throw new Error(`Run ${b.n} is the first of record ${r.id}, and it follows no session; name a baseline.`);
            }
            const forms = { a: formOf(entries, a.sessionId, a.planV), b: formOf(entries, b.sessionId, b.planV) };
            return compareRuns(a, b, { channels, limit: Math.round(clamp(args.limit, 1, 80, 30)), forms });
        },
    };
}

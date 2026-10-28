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
 * NOT connect, run a test or an adjustment, clear faults, write or flash. There is no tool for
 * those, and the facade has no method that could reach them.
 */
import type { ProbeLive, StoredRun } from '../probe/runStore';
import type { Tab } from '../tabs';
import {
    currentPlan,
    liveMandate,
    nextPlanVersion,
    notebookLine,
    openAsks,
    statusOf,
    type NotebookAuthor,
    type NotebookBody,
    type NotebookEntry,
} from '../notebook/rules';
import type { MonitoringToolName } from './tools';

export type Handler = (args: Record<string, unknown>) => Promise<unknown>;

export interface TabFacade {
    now(): number;
    newId(): string;
    /** The tab now, without the CO-WORK line (added here). */
    status(): Record<string, unknown>;
    faults(module: string | undefined): unknown;
    /** Read the module in session again, through the gate. A sentence when it did not. */
    refreshFaults(): Promise<string | null>;
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
    /** What was stopped, or null when nothing was running. */
    stopLog(): 'recording' | 'probe' | null;
    save(): Promise<unknown>;
    sync(): Promise<unknown>;
    /** Leave for TUNER WORKS, or say why not (running, unsaved). */
    openTuner(discardUnsaved: boolean): unknown;
}

const DAY_MS = 86_400_000;
const TABS: readonly Tab[] = ['diagnosis', 'datalog', 'adaptation', 'service', 'actuator', 'sessions'];
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
    /** The clock of the run in progress, when it is this record's. */
    const clock = (record: string) => {
        const live = f.live();
        return live && live.sessionId === record ? { run: live.n, t: Math.round((f.now() - live.startedAt) / 100) / 10 } : null;
    };

    return {
        monitoring_status: async () => {
            const entries = await f.entries();
            let cowork: string | null = null;
            try {
                const r = pickRecord(entries, undefined);
                cowork = notebookLine(r.entries);
            } catch {
                /* no record yet */
            }
            return { ...f.status(), cowork };
        },

        monitoring_faults: async (args) => {
            const moduleId = optText(args.module);
            if (args.refresh === true) {
                const refused = await f.refreshFaults();
                if (refused) return { refreshed: false, reason: refused, faults: f.faults(moduleId) };
            }
            return { refreshed: args.refresh === true, faults: f.faults(moduleId) };
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
            const record = f.newId();
            const at = f.now();
            // The owner's words handing it over: written as theirs, which is what lets it stand.
            const mandate: NotebookEntry = { id: f.newId(), sessionId: record, at, by: 'driver', body: { kind: 'mandate', words, modules, until: at + days * DAY_MS } };
            await f.add([mandate]);
            return { record, mandate: mandate.id, modules, until: new Date(at + days * DAY_MS).toISOString() };
        },

        monitoring_plan: async (args) => {
            const r = pickRecord(await f.entries(), args.record);
            const body: NotebookBody = {
                kind: 'plan',
                v: nextPlanVersion(r.entries),
                re: optText(args.re),
                mandate: optText(args.mandate),
                purpose: text(args.purpose, 'purpose'),
                hypotheses: Array.isArray(args.hypotheses) ? (args.hypotheses as never) : undefined,
                criteria: optText(args.criteria),
                judge: Array.isArray(args.judge) ? (args.judge as never) : undefined,
                steps: (Array.isArray(args.steps) ? args.steps : []) as never,
            };
            const e = await write(r.id, 'chat', body);
            return { record: r.id, id: e.id, v: body.v, taken: 'when PROBE is next started on the screen' };
        },

        monitoring_finding: async (args) => {
            const r = pickRecord(await f.entries(), args.record);
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
            const r = pickRecord(await f.entries(), args.record);
            const c = clock(r.id);
            const e = await write(r.id, 'driver', { kind: 'note', run: c?.run ?? null, t: c?.t ?? null, text: text(args.text, 'text'), via: 'voice' });
            return { record: r.id, id: e.id, run: c?.run ?? null, t: c?.t ?? null };
        },

        monitoring_mark: async (args) => {
            const r = pickRecord(await f.entries(), args.record);
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
            return { started: true };
        },

        monitoring_stop_log: async (args) => {
            if (args.confirmed !== true) {
                throw new Error('Read the request back to the driver, and call again with confirmed: true only after a clear yes.');
            }
            const stopped = f.stopLog();
            return stopped ? { stopped } : { stopped: null, reason: 'Nothing was recording.' };
        },

        monitoring_save: async (args) => {
            if (args.confirmed !== true) throw new Error('Save when the owner asks for it, with confirmed: true.');
            return f.save();
        },

        monitoring_sync_upload: async (args) => {
            if (args.confirmed !== true) throw new Error('Send when the owner asks for it, with confirmed: true.');
            return f.sync();
        },

        monitoring_open_tuner: async (args) => {
            if (args.confirmed !== true) throw new Error('Open TUNER when the owner asks for it, with confirmed: true.');
            return f.openTuner(args.discard_unsaved === true);
        },
    };
}

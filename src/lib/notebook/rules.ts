/**
 * CO-WORK for MONITORING: one record per session, written by the driver, the assistant in the car,
 * the desk and the owner on the screen, and read by all of them.
 *
 * The shape is TUNER's (`src/lib/notebook/rules.ts` there), on purpose: the desk and the assistant
 * move between the two apps, and one way of keeping a record is one thing to learn. The rules are
 * TUNER's too, and this file enforces them rather than describing them:
 *
 *   - Entries are only ever added. A finding is withdrawn by a `status` entry, and the original
 *     stays. Two writers adding entries with their own ids cannot collide.
 *   - A `note` is the driver's own words (or the owner's, typed). The assistant and the desk cannot
 *     write one: what they think the driver did is a question, an `ask`.
 *   - A `fact` carries its evidence — run, time range, channels — or it is refused.
 *   - A reading that disagrees with another points at it (`re`) and stands beside it as DISPUTED.
 *
 * ## What MONITORING adds: the mandate
 *
 * TUNER's desk writes a plan only with the owner's agreement to its content. MONITORING's desk runs
 * by itself, so the agreement has to be on record before it does: a `mandate` is the owner's own
 * words handing over an investigation ("DSC cuts in early in slow corners — find out why"), which
 * modules it may read and until when. A plan the assistant or the desk writes must cite a live one
 * and stay inside it; anything outside is an `ask`, and waits. Only the driver or the owner can
 * write a mandate, for the same reason only they can write a note.
 *
 * Pure, and free of DOM and Node types: the tab, the bridge and the store's API all run the same
 * rules, so a rule cannot hold in one place and not another.
 */

import { hypothesesProblem, judgesProblem, modulesOf, stepsProblem, type Hypothesis, type Judge, type ProbeStep } from '../probe/plan';

export type NotebookAuthor = 'driver' | 'chat' | 'desk' | 'owner';
export const NOTEBOOK_AUTHORS: readonly NotebookAuthor[] = ['driver', 'chat', 'desk', 'owner'];

/** Where in the data a fact or a reading rests: a run of this session, a time range in that run's
 *  seconds, the channels looked at, and how raw bytes were read when that matters. */
export interface Evidence {
    run: number;
    from: number;
    to: number;
    channels: string[];
    decode?: string;
}

export type NotebookBody =
    | {
          kind: 'mandate';
          /** The owner's own words, as said. */
          words: string;
          /** Module ids the investigation may read. Empty: any module. */
          modules: string[];
          /** ms since the epoch. After this, the desk asks again. */
          until: number;
      }
    | {
          kind: 'plan';
          /** 1, 2, 3 … in the order plans were written in this session. */
          v: number;
          /** The plan this one rewrites. Two plans rewriting the same one is a fork, put to the driver. */
          re?: string;
          /** The mandate entry this plan acts under. Required unless the driver or the owner wrote it. */
          mandate?: string;
          purpose: string;
          hypotheses?: Hypothesis[];
          criteria?: string;
          judge?: Judge[];
          steps: ProbeStep[];
      }
    | { kind: 'step'; run: number; t: number; n: number }
    | { kind: 'note'; run: number | null; t: number | null; text: string; via: 'voice' | 'screen' }
    | { kind: 'fact'; text: string; evidence: Evidence }
    | { kind: 'read'; text: string; sure: 'low' | 'mid' | 'high'; evidence?: Evidence; re?: string }
    | { kind: 'ask'; to: NotebookAuthor; text: string; about?: Evidence }
    | { kind: 'answer'; re: string; text: string }
    | { kind: 'status'; re: string; to: 'withdrawn' | 'agreed' | 'disputed' };

export type NotebookKind = NotebookBody['kind'];

export interface NotebookEntry {
    id: string;
    sessionId: string;
    /** When it was written, ms since the epoch, on the writer's clock. */
    at: number;
    by: NotebookAuthor;
    body: NotebookBody;
}

export const NOTEBOOK_LIMITS = {
    text: 2000,
    purpose: 300,
    channels: 12,
    channel: 40,
    /** A mandate lasts at most this long; the desk asks again after it. */
    mandateMs: 30 * 24 * 60 * 60 * 1000,
    /** One entry as JSON. The store refuses anything larger. */
    entryBytes: 16_000,
} as const;

const ID = /^[0-9A-Za-z-]{8,64}$/;
const MODULE = /^[a-z0-9_]{2,32}$/;

const isInt = (n: unknown, min: number, max = Number.MAX_SAFE_INTEGER): n is number =>
    typeof n === 'number' && Number.isInteger(n) && n >= min && n <= max;
const isNum = (n: unknown, min = -Infinity): n is number => typeof n === 'number' && Number.isFinite(n) && n >= min;
const text = (s: unknown, max: number): s is string => typeof s === 'string' && s.trim().length > 0 && s.length <= max;

function evidenceProblem(e: unknown): string | null {
    if (!e || typeof e !== 'object') return 'evidence is required: run, from, to and channels';
    const v = e as Partial<Evidence>;
    if (!isInt(v.run, 1, 99)) return 'evidence.run must be the run number, from 1';
    if (!isNum(v.from, 0) || !isNum(v.to, 0) || v.from! > v.to!) return 'evidence.from and .to must be run seconds, from <= to';
    if (
        !Array.isArray(v.channels) ||
        v.channels.length === 0 ||
        v.channels.length > NOTEBOOK_LIMITS.channels ||
        !v.channels.every((c) => text(c, NOTEBOOK_LIMITS.channel))
    ) {
        return `evidence.channels must name 1-${NOTEBOOK_LIMITS.channels} channels`;
    }
    if (v.decode !== undefined && !text(v.decode, 200)) return 'evidence.decode must be a short line';
    return null;
}

function planProblem(b: Extract<NotebookBody, { kind: 'plan' }>): string | null {
    if (!isInt(b.v, 1, 999)) return 'plan.v must be a version number, from 1';
    if (!text(b.purpose, NOTEBOOK_LIMITS.purpose)) return `plan.purpose is required (up to ${NOTEBOOK_LIMITS.purpose} characters)`;
    if (b.criteria !== undefined && !text(b.criteria, NOTEBOOK_LIMITS.text)) return 'plan.criteria is too long or empty';
    if (b.re !== undefined && !ID.test(b.re)) return 'plan.re must be an entry id';
    if (b.mandate !== undefined && !ID.test(b.mandate)) return 'plan.mandate must be an entry id';
    return stepsProblem(b.steps) ?? hypothesesProblem(b.hypotheses) ?? judgesProblem(b.judge, b.hypotheses ?? []);
}

/**
 * What is wrong with an entry on its own, in a sentence the writer can act on — or null.
 * `addProblem` adds the checks that need the rest of the record.
 */
export function entryProblem(e: unknown): string | null {
    if (!e || typeof e !== 'object') return 'not an entry';
    const x = e as Partial<NotebookEntry>;
    if (typeof x.id !== 'string' || !ID.test(x.id)) return 'id must be 8-64 letters, digits or dashes';
    if (typeof x.sessionId !== 'string' || !ID.test(x.sessionId)) return 'sessionId must be a session id';
    if (!isNum(x.at, 1)) return 'at must be a time in ms';
    if (!NOTEBOOK_AUTHORS.includes(x.by as NotebookAuthor)) return `by must be one of ${NOTEBOOK_AUTHORS.join(', ')}`;
    const b = x.body as NotebookBody | undefined;
    if (!b || typeof b !== 'object') return 'body is required';
    if (JSON.stringify(x).length > NOTEBOOK_LIMITS.entryBytes) return 'the entry is too long';
    switch (b.kind) {
        case 'mandate':
            // Consent is the person's. The assistant relays the owner's words with by: 'driver';
            // the desk cannot hand an investigation to itself.
            if (x.by !== 'driver' && x.by !== 'owner') return "a mandate is the owner's own words; only the driver or the owner can give one";
            if (!text(b.words, NOTEBOOK_LIMITS.text)) return 'mandate.words are the owner’s words, as said';
            if (!Array.isArray(b.modules) || !b.modules.every((m) => typeof m === 'string' && MODULE.test(m))) {
                return 'mandate.modules must be module ids (empty for any)';
            }
            if (!isNum(b.until, 1) || b.until <= x.at! || b.until - x.at! > NOTEBOOK_LIMITS.mandateMs) {
                return 'mandate.until must be after it was given, and within 30 days';
            }
            return null;
        case 'plan':
            return planProblem(b);
        case 'step':
            if (!isInt(b.run, 1, 99) || !isNum(b.t, 0) || !isInt(b.n, 1, 12)) return 'step needs run, t (run seconds) and n';
            return null;
        case 'note':
            // The rule the record exists for. What the assistant or the desk believes the driver
            // did is not the driver's word for it — it goes in as a question.
            if (x.by !== 'driver' && x.by !== 'owner') return "a note is the driver's own words; the assistant and the desk ask instead (kind \"ask\")";
            if (!text(b.text, NOTEBOOK_LIMITS.text)) return 'note.text is required';
            if (b.via !== 'voice' && b.via !== 'screen') return 'note.via must be voice or screen';
            if (b.run !== null && !isInt(b.run, 1, 99)) return 'note.run must be a run number or null';
            if (b.t !== null && !isNum(b.t, 0)) return 'note.t must be run seconds or null';
            if ((b.run === null) !== (b.t === null)) return 'note.run and note.t go together';
            return null;
        case 'fact':
            if (x.by === 'driver') return 'what the driver says is a note; a fact is read from the data';
            if (!text(b.text, NOTEBOOK_LIMITS.text)) return 'fact.text is required';
            return evidenceProblem(b.evidence);
        case 'read':
            if (!text(b.text, NOTEBOOK_LIMITS.text)) return 'read.text is required';
            if (b.sure !== 'low' && b.sure !== 'mid' && b.sure !== 'high') return 'read.sure must be low, mid or high';
            if (b.re !== undefined && !ID.test(b.re)) return 'read.re must be an entry id';
            return b.evidence === undefined ? null : evidenceProblem(b.evidence);
        case 'ask':
            if (!NOTEBOOK_AUTHORS.includes(b.to)) return `ask.to must be one of ${NOTEBOOK_AUTHORS.join(', ')}`;
            if (!text(b.text, NOTEBOOK_LIMITS.text)) return 'ask.text is required';
            return b.about === undefined ? null : evidenceProblem(b.about);
        case 'answer':
            if (typeof b.re !== 'string' || !ID.test(b.re)) return 'answer.re must be the id of the ask';
            if (!text(b.text, NOTEBOOK_LIMITS.text)) return 'answer.text is required';
            return null;
        case 'status':
            if (typeof b.re !== 'string' || !ID.test(b.re)) return 'status.re must be an entry id';
            if (b.to !== 'withdrawn' && b.to !== 'agreed' && b.to !== 'disputed') return 'status.to must be withdrawn, agreed or disputed';
            return null;
        default:
            return 'body.kind must be mandate, plan, step, note, fact, read, ask, answer or status';
    }
}

type MandateEntry = NotebookEntry & { body: Extract<NotebookBody, { kind: 'mandate' }> };
type PlanEntry = NotebookEntry & { body: Extract<NotebookBody, { kind: 'plan' }> };
const isPlan = (e: NotebookEntry): e is PlanEntry => e.body.kind === 'plan';
const isMandate = (e: NotebookEntry): e is MandateEntry => e.body.kind === 'mandate';

/** A mandate that stands at `at`: given, not withdrawn, not expired. */
export function liveMandate(entries: readonly NotebookEntry[], id: string, at: number): MandateEntry | null {
    const m = entries.find((e) => e.id === id);
    if (!m || !isMandate(m)) return null;
    if (statusOf(entries, id) === 'withdrawn') return null;
    return at >= m.at && at <= m.body.until ? m : null;
}

/**
 * Whether `e` may be added to a record that already holds `existing`: the entry's own rules, then
 * the ones that need the record. A plan by the assistant or the desk must cite a live mandate and
 * read only the modules it names.
 */
export function addProblem(e: unknown, existing: readonly NotebookEntry[]): string | null {
    const own = entryProblem(e);
    if (own) return own;
    const x = e as NotebookEntry;
    if (existing.some((y) => y.id === x.id)) return null; // the same entry again: merging is idempotent
    if (x.body.kind !== 'plan' || x.by === 'driver' || x.by === 'owner') return null;
    if (!x.body.mandate) {
        return 'a plan by the assistant or the desk acts under a mandate (plan.mandate); without one, ask the owner (kind "ask")';
    }
    const m = liveMandate(existing, x.body.mandate, x.at);
    if (!m) return `mandate ${x.body.mandate} is not standing (withdrawn, expired or not in this record); ask the owner again`;
    if (m.body.modules.length > 0) {
        const outside = modulesOf(x.body.steps).filter((mod) => !m.body.modules.includes(mod));
        if (outside.length > 0) {
            return `the mandate covers ${m.body.modules.join(', ')}; ${outside.join(', ')} is outside it — ask the owner (kind "ask")`;
        }
    }
    return null;
}

/** Both sets, each entry once, in the order written. Entries never change, so which copy is kept does not matter. */
export function mergeEntries(...sets: readonly (readonly NotebookEntry[])[]): NotebookEntry[] {
    const byId = new Map<string, NotebookEntry>();
    for (const set of sets) for (const e of set) if (!byId.has(e.id)) byId.set(e.id, e);
    return [...byId.values()].sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * The plan to run, and whether there is more than one.
 *
 * A head is a plan no later plan rewrites. Two or more is a fork, and the driver chooses; the tab
 * never picks. `plan` is then the newest head, for display only.
 */
export function currentPlan(entries: readonly NotebookEntry[]): { plan: PlanEntry | null; heads: PlanEntry[]; forked: boolean } {
    const plans = entries.filter(isPlan);
    const rewritten = new Set(plans.map((p) => p.body.re).filter((x): x is string => !!x));
    const heads = plans.filter((p) => !rewritten.has(p.id) && statusOf(entries, p.id) !== 'withdrawn').sort((a, b) => a.at - b.at);
    return { plan: heads[heads.length - 1] ?? null, heads, forked: heads.length > 1 };
}

/** The version the next plan written in this session takes. */
export function nextPlanVersion(entries: readonly NotebookEntry[]): number {
    return entries.filter(isPlan).reduce((v, p) => Math.max(v, p.body.v), 0) + 1;
}

/**
 * Where an entry stands: the latest `status` written about it; otherwise DISPUTED when a reading
 * points at it (`re`).
 */
export function statusOf(entries: readonly NotebookEntry[], id: string): 'withdrawn' | 'agreed' | 'disputed' | null {
    let latest: NotebookEntry | null = null;
    for (const e of entries) {
        if (e.body.kind === 'status' && e.body.re === id && (!latest || e.at >= latest.at)) latest = e;
    }
    if (latest && latest.body.kind === 'status') return latest.body.to;
    return entries.some((e) => e.body.kind === 'read' && e.body.re === id) ? 'disputed' : null;
}

/** Questions still waiting: no answer points at them and none was withdrawn. Oldest first. */
export function openAsks(entries: readonly NotebookEntry[]): NotebookEntry[] {
    const answered = new Set(entries.flatMap((e) => (e.body.kind === 'answer' ? [e.body.re] : [])));
    return entries.filter((e) => e.body.kind === 'ask' && !answered.has(e.id) && statusOf(entries, e.id) !== 'withdrawn');
}

/** The record in a line, for a readout that has one: `PLAN v3 · ASK 2`. Null when there is nothing. */
export function notebookLine(entries: readonly NotebookEntry[]): string | null {
    const { plan, forked } = currentPlan(entries);
    const parts: string[] = [];
    if (plan) parts.push(forked ? `PLAN v${plan.body.v} ×2` : `PLAN v${plan.body.v}`);
    const asks = openAsks(entries).length;
    if (asks) parts.push(`ASK ${asks}`);
    return parts.length ? parts.join(' · ') : null;
}

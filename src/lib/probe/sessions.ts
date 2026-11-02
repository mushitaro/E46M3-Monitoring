/**
 * PROBE sessions (operator, 2026-11-02): how STARTUP lists the CO-WORK records, and what NEXT
 * writes.
 *
 * A PROBE session is a CO-WORK record (notebook/rules.ts), started on purpose. NEW SESSION opens an
 * empty one on the screen and the owner's words handing it over (a mandate) start it; the form is
 * decided (a plan), data is taken (PROBE runs), and NEXT carries it into the next session: the
 * mandate — the owner's words, the modules, the mode and the focus, renewed for as long as before —
 * and the current form, in a new record that names the one it follows. The sessions a NEXT chain
 * links are one series, and that series is what runs are compared across.
 *
 * The form a run took its data under never changes, because a record is only added to. An item the
 * assistant adds or removes as the series goes on is a new plan version in the session it is
 * written in, counted from the next run (lib/probe/items.ts says how the versions compare).
 *
 * Pure.
 */
import { currentPlan, liveMandate, NOTEBOOK_LIMITS, type InvestigationMode, type NotebookBody, type NotebookEntry } from '../notebook/rules';

type Mandate = Extract<NotebookBody, { kind: 'mandate' }>;
type Plan = Extract<NotebookBody, { kind: 'plan' }>;

export interface ProbeSession {
    id: string;
    /** The owner's words of its latest mandate; null for an empty session NEW SESSION opened. */
    words: string | null;
    mode: InvestigationMode | null;
    /** The mandate stands now: plans may be written and run under it. */
    standing: boolean;
    /** The session it carries on (NEXT), when it does. */
    follows: string | null;
    /** The current form's version and purpose, when it has one. */
    v: number | null;
    purpose: string | null;
    /** Every plan version written in it, in order: its form's history. */
    versions: number[];
    /** PROBE runs kept for it on this device. */
    runs: number;
    /** When it was started (its first entry), and last written to. */
    startedAt: number;
    lastAt: number;
}

function groups(entries: readonly NotebookEntry[]): Map<string, NotebookEntry[]> {
    const out = new Map<string, NotebookEntry[]>();
    for (const e of entries) out.set(e.sessionId, [...(out.get(e.sessionId) ?? []), e]);
    return out;
}

const lastMandate = (r: readonly NotebookEntry[]) =>
    [...r].reverse().find((e): e is NotebookEntry & { body: Mandate } => e.body.kind === 'mandate') ?? null;

/** One session as STARTUP shows it. */
export function describeSession(id: string, r: readonly NotebookEntry[], runs: number, now: number): ProbeSession {
    const m = lastMandate(r);
    const { plan } = currentPlan(r);
    const follows = [...r].reverse().find((e) => e.body.kind === 'mandate' && e.body.follows)?.body as Mandate | undefined;
    return {
        id,
        words: m?.body.words ?? null,
        mode: m?.body.mode ?? null,
        standing: m ? liveMandate(r, m.id, now) !== null : false,
        follows: follows?.follows ?? null,
        v: plan?.body.v ?? null,
        purpose: plan?.body.purpose ?? null,
        versions: r.flatMap((e) => (e.body.kind === 'plan' ? [e.body.v] : [])),
        runs,
        startedAt: r.length ? r[0].at : now,
        lastAt: r.length ? r[r.length - 1].at : now,
    };
}

/**
 * Every session on the device, newest first. `fresh` is an empty session NEW SESSION opened and
 * nothing has been written in yet: it heads the list until it is started.
 */
export function probeSessions(entries: readonly NotebookEntry[], runs: ReadonlyMap<string, number>, now: number, fresh: { id: string; at: number } | null = null): ProbeSession[] {
    const out = [...groups(entries)].map(([id, r]) => describeSession(id, r, runs.get(id) ?? 0, now));
    if (fresh && !out.some((s) => s.id === fresh.id)) out.push(describeSession(fresh.id, [], 0, fresh.at));
    return out.sort((a, b) => b.startedAt - a.startedAt);
}

/** The series a session belongs to, oldest first and ending with it: the sessions its NEXT chain follows. */
export function lineage(entries: readonly NotebookEntry[], record: string): string[] {
    const byId = groups(entries);
    const chain = [record];
    const seen = new Set(chain);
    let at = record;
    for (let i = 0; i < 50; i++) {
        const m = [...(byId.get(at) ?? [])].reverse().find((e) => e.body.kind === 'mandate' && e.body.follows);
        const prev = m && m.body.kind === 'mandate' ? m.body.follows : undefined;
        if (!prev || seen.has(prev)) break;
        chain.unshift(prev);
        seen.add(prev);
        at = prev;
    }
    return chain;
}

export type NextRefusal = 'no-mandate' | 'no-plan' | 'forked' | 'no-data';

/**
 * What NEXT writes: a new record whose mandate carries the session's on — the same words, modules,
 * mode and focus, standing for as long as the last one did (at most 30 days) from now, and naming
 * the session it follows — and whose first plan is the session's current form, the same version,
 * under that mandate. Refused before the session has taken data: NEXT carries a form that has been
 * measured with.
 *
 * `by` is who carries it on: the owner pressing NEXT, or the driver's words relayed by the
 * assistant. The plan keeps the author who wrote the form.
 */
export function nextSession(
    entries: readonly NotebookEntry[],
    from: string,
    runs: number,
    ctx: { now: number; newId: () => string; by: 'owner' | 'driver' },
): { ok: true; record: string; entries: NotebookEntry[] } | { ok: false; reason: NextRefusal } {
    const r = entries.filter((e) => e.sessionId === from);
    const m = lastMandate(r);
    if (!m) return { ok: false, reason: 'no-mandate' };
    const { plan, forked } = currentPlan(r);
    if (!plan) return { ok: false, reason: 'no-plan' };
    if (forked) return { ok: false, reason: 'forked' };
    if (runs < 1) return { ok: false, reason: 'no-data' };
    const record = ctx.newId();
    const span = Math.min(NOTEBOOK_LIMITS.mandateMs, Math.max(86_400_000, m.body.until - m.at));
    const mandate: NotebookEntry = {
        id: ctx.newId(),
        sessionId: record,
        at: ctx.now,
        by: ctx.by,
        body: {
            kind: 'mandate',
            words: m.body.words,
            modules: [...m.body.modules],
            until: ctx.now + span,
            ...(m.body.mode ? { mode: m.body.mode } : {}),
            ...(m.body.focus?.length ? { focus: [...m.body.focus] } : {}),
            follows: from,
        },
    };
    const body: Plan = { ...(plan.body as Plan), mandate: mandate.id };
    delete body.re;
    const form: NotebookEntry = { id: ctx.newId(), sessionId: record, at: ctx.now + 1, by: plan.by, body };
    return { ok: true, record, entries: [mandate, form] };
}

/** The plan a run took its data under: the version it ran, in the record it ran for. */
export function formOf(entries: readonly NotebookEntry[], record: string, v: number): Plan | null {
    const p = entries.find((e) => e.sessionId === record && e.body.kind === 'plan' && e.body.v === v);
    return p && p.body.kind === 'plan' ? p.body : null;
}

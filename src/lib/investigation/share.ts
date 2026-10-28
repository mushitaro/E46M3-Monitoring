/**
 * What of an investigation leaves the device, and what the desk may write into one.
 *
 * The privacy policy (m3 `/privacy-policy#preview`, 「調査の委任」) makes two promises about a CO-WORK
 * record, and this file is where both are kept, for the tab, the SYNC routes and the desk Worker
 * alike — one rule, three callers, so it cannot hold in one place and not another:
 *
 *   - **Only a delegated investigation is sent, and only while it is delegated.** An entry goes up
 *     when a mandate stood at the moment it was written; a run, when one stood as it started. The
 *     mandate itself goes, and so does its withdrawal — without that the desk could not know to
 *     stop. Expired, nothing written after its end goes. Withdrawn, nothing more goes at all, not
 *     even what was written before and has not gone yet: a withdrawal takes the mandate back
 *     (lib/notebook/rules `liveMandate`), it does not merely end it.
 *   - **The desk reads only what was delegated, and writes as itself.** It sees a record only while
 *     a mandate stands now. It writes plans, facts, readings, questions and their status as `desk`;
 *     never a mandate or a note (lib/notebook/rules refuses those for `desk` already), never an
 *     answer to a question it was not asked, and never a status on someone else's entry.
 *
 * Pure: no DOM, no Workers globals.
 */
import { addProblem, liveMandate, statusOf, type NotebookEntry, type NotebookBody } from '../notebook/rules';

type Mandate = NotebookEntry & { body: Extract<NotebookBody, { kind: 'mandate' }> };
const isMandate = (e: NotebookEntry): e is Mandate => e.body.kind === 'mandate';

/** Whether some mandate in the record stood at `at`. */
export function delegatedAt(entries: readonly NotebookEntry[], at: number): boolean {
    return entries.some((e) => isMandate(e) && liveMandate(entries, e.id, at) !== null);
}

/** The record's mandates that stand at `at`. */
export function standingMandates(entries: readonly NotebookEntry[], at: number): Mandate[] {
    return entries.filter(isMandate).filter((m) => liveMandate(entries, m.id, at) !== null);
}

/**
 * Whether an entry of this record may leave the device. `entries` is the whole record as known,
 * this entry included.
 */
export function sendableEntry(entries: readonly NotebookEntry[], e: NotebookEntry): boolean {
    if (e.body.kind === 'mandate') return true;
    if (e.body.kind === 'status' && e.body.to === 'withdrawn') {
        const re = e.body.re;
        if (entries.some((m) => m.id === re && m.body.kind === 'mandate')) return true;
    }
    return delegatedAt(entries, e.at);
}

/** Whether a run of this record may leave the device: a mandate stood as it started. */
export function sendableRun(entries: readonly NotebookEntry[], run: { startedAt: number }): boolean {
    return delegatedAt(entries, run.startedAt);
}

/**
 * The time windows over which the record was delegated, clipped to `now`, with the modules each
 * covers (empty: any): every mandate that was not taken back. What the desk may read of the owner's
 * read records is what falls inside one.
 */
export function delegatedWindows(entries: readonly NotebookEntry[], now: number): { from: number; to: number; modules: string[] }[] {
    return entries.filter(isMandate).flatMap((m) => {
        if (statusOf(entries, m.id) === 'withdrawn') return [];
        const to = Math.min(m.body.until, now);
        return to > m.at ? [{ from: m.at, to, modules: m.body.modules }] : [];
    });
}

const DESK_KINDS: ReadonlySet<NotebookBody['kind']> = new Set(['plan', 'fact', 'read', 'ask', 'answer', 'status']);

/**
 * What is wrong with an entry the desk wants to add to a record that holds `existing`, in a
 * sentence the desk can act on — or null. `e.at` is the server's clock, not the desk's.
 */
export function deskProblem(e: NotebookEntry, existing: readonly NotebookEntry[]): string | null {
    if (e.by !== 'desk') return 'the desk writes as desk';
    if (!e.body || typeof e.body !== 'object') return 'each entry needs a body';
    if (!delegatedAt(existing, e.at)) return 'no mandate stands for this record now; the desk reads and writes only an investigation handed over';
    if (!DESK_KINDS.has(e.body.kind)) return `the desk writes plan, fact, read, ask, answer or status — not ${e.body.kind}`;
    const b = e.body;
    if (b.kind === 'answer') {
        const ask = existing.find((x) => x.id === b.re);
        if (!ask || ask.body.kind !== 'ask' || ask.body.to !== 'desk') return 'the desk answers only a question put to the desk';
    }
    if (b.kind === 'status') {
        const target = existing.find((x) => x.id === b.re);
        if (!target || target.by !== 'desk') return 'the desk sets the status of its own entries only; for anything else, ask (kind "ask")';
    }
    return addProblem(e, existing);
}

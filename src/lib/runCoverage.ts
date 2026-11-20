/**
 * Whether every job the owner's table opens runs (operator, 2026-11-18: 「完了基準を満たし、M3 および
 * E46 の項目も全部」).
 *
 * For each job of every module the app carries — the E46 M3's, the non-M3 E46's, the DSC MK60's — whose
 * nature the owner decided `how: 'run'` (policy.ts), this says one of three things:
 *   - `runs`: once practised, parked, the gate lets it go — a job without values with its frame, a job
 *     that takes values with at least one set, and a start that leaves something on with its stop;
 *   - `external`: it cannot run for a reason outside this app — EdiabasLib, BMW's own job runner, sends
 *     nothing for it with any value tried (the job does not talk to the module, or refuses every value);
 *   - `open`: anything else. That is unfinished work, and the coverage test fails on it.
 * It also counts, per job, the sets EdiabasLib sent something for that the app does not build alike: a
 * disagreement is the app's to fix, never a reason to leave a set closed quietly.
 *
 * Pure: the caller hands in the shipped data. src/lib/runCoverage.test.ts runs it over all of it.
 */
import {
    CLOCK,
    EMPTY_LEDGER,
    agreedCasesFrom,
    agreedFrameFrom,
    bestTelegram,
    ownFrames,
    decisionFor,
    isReadNature,
    mayRun,
    operationFor,
    recordPracticeRun,
    runName,
    telegramOfAgreed,
    withAgreedFrames,
    type CatalogJob,
    type EcuIndex,
    type EcuProfile,
    type JobFramesOracle,
    type Nature,
    type PolicyWho,
    type SgbdResultsTable,
    type TelegramTable,
} from '@tsunagi/monitoring-engine';
import { choicesOf } from './agreedChoices';

export interface CoverageItem {
    module: string;
    job: string;
    nature: Nature;
    who: PolicyWho;
    status: 'runs' | 'external' | 'open';
    /** Why it does not run (external or open). */
    why?: string;
    /** A job that takes values: the sets it may run with. */
    sets?: number;
    /** Sets EdiabasLib sent something for that the app does not build alike, with the first reason. */
    disagree?: { count: number; first: string };
    /** A job that runs: the frames it sends (its first set), and its stop's, for PRACTICE to answer. */
    frames?: string[];
    stopFrames?: string[];
}

export interface CoverageInput {
    index: EcuIndex;
    profiles: ReadonlyMap<string, EcuProfile>;
    telegrams: ReadonlyMap<string, TelegramTable>;
    results: ReadonlyMap<string, SgbdResultsTable | null>;
    oracle: JobFramesOracle;
}

/**
 * Reasons outside the app: the module's own SGBD sends the frame to another module's address (the
 * owner's rule: a module is sent only what is addressed to it), or the frame carries the clock (a
 * login's seed) and so is never the one EdiabasLib was seen to send.
 */
const outside = (why: string) => why.includes(CLOCK) || /not to this module/.test(why);

const practised = (moduleId: string, jobId: string, args?: readonly string[]) => recordPracticeRun(EMPTY_LEDGER, `${moduleId}:${runName(jobId, args)}`, '2026-11-18T00:00:00Z');

export function runCoverage(input: CoverageInput): CoverageItem[] {
    const out: CoverageItem[] = [];
    for (const m of input.index.modules) {
        const profile = input.profiles.get(m.id);
        const raw = input.telegrams.get(m.id);
        if (!profile || !raw) continue;
        const results = input.results.get(m.id) ?? null;
        const table = withAgreedFrames(raw, input.oracle, results);
        for (const job of profile.jobs as CatalogJob[]) {
            const decision = decisionFor(m.id, job, m.group);
            if (isReadNature(decision.nature) || decision.how !== 'run') continue;
            const item: CoverageItem = { module: m.id, job: job.id, nature: decision.nature, who: decision.who, status: 'open' };
            const entry = input.oracle.jobs[`${m.id}:${job.id}`];
            // Every set EdiabasLib sent something for must be built alike.
            if (entry) {
                let count = 0;
                let first = '';
                for (const c of entry.cases) {
                    if (ownFrames(input.oracle, m.id, job.id, c).sends.length === 0) continue;
                    const r = agreedFrameFrom(input.oracle, results, m.id, m.address, job.id, c.args);
                    if (!r.ok && !outside(r.why)) {
                        count++;
                        first ||= `${c.args.join(';') || '(no values)'}: ${r.why}`;
                    }
                }
                if (count) item.disagree = { count, first };
            }
            // What the job itself sends: EdiabasLib's trace begins with what its INITIALISIERUNG sent.
            const own = (entry?.cases ?? []).map((c) => ownFrames(input.oracle, m.id, job.id, c));
            const sendsNothing = own.length > 0 && own.every((c) => c.sends.length === 0);
            const op = operationFor(job);
            const hold = op.kind === 'hold' && !!op.stopJob;
            const stopJob = hold ? (profile.jobs as CatalogJob[]).find((j) => j.id === op.stopJob) : undefined;
            if (job.args.length === 0) {
                const tel = bestTelegram(table, job.id);
                const v = mayRun(job, tel, practised(m.id, job.id), { moduleId: m.id, motion: 'parked', group: m.group });
                if (v.allowed) {
                    if (hold && op.stopJob !== job.id) {
                        const stop = stopJob ? bestTelegram(table, stopJob.id) : null;
                        if (!stop || stop.confidence !== 'single') {
                            item.why = `its stop ${op.stopJob} has no frame to send`;
                            out.push(item);
                            continue;
                        }
                        item.stopFrames = stop.sequence ?? [stop.hex];
                    }
                    item.frames = tel!.sequence ?? [tel!.hex];
                    item.status = 'runs';
                } else if (sendsNothing) {
                    item.status = 'external';
                    item.why = `EdiabasLib sends nothing for it${own[0].jobStatus ? ` (${own[0].jobStatus})` : ''}`;
                } else {
                    const c = own.find((x) => x.args.length === 0 && x.sends.length > 0);
                    const r = c ? agreedFrameFrom(input.oracle, results, m.id, m.address, job.id, []) : null;
                    if (r && !r.ok && outside(r.why)) {
                        item.status = 'external';
                        item.why = r.why;
                    } else item.why = !entry ? 'EdiabasLib was not run with it' : (item.disagree?.first ?? v.reason);
                }
                out.push(item);
                continue;
            }
            const starts = agreedCasesFrom(input.oracle, results, m.id, m.address, job.id);
            // The very sets the screen and the assistant offer (lib/agreedChoices `choicesOf`).
            const choices = choicesOf(job, profile.jobs as CatalogJob[], (id) => (id === job.id ? starts : agreedCasesFrom(input.oracle, results, m.id, m.address, id)));
            item.sets = choices.length;
            const first = choices[0];
            if (first) {
                const v = mayRun(job, telegramOfAgreed(first.start), practised(m.id, job.id, first.start.args), {
                    moduleId: m.id,
                    motion: 'parked',
                    group: m.group,
                    args: first.start.args,
                    agreed: first.start,
                });
                if (v.allowed) {
                    item.status = 'runs';
                    item.frames = first.start.sequence ? [...first.start.sequence] : [first.start.hex];
                    if (first.stop) item.stopFrames = first.stop.sequence ? [...first.stop.sequence] : [first.stop.hex];
                } else item.why = v.reason;
            } else if (sendsNothing) {
                item.status = 'external';
                item.why = `EdiabasLib sends nothing for it with any value tried${own[0].jobStatus ? ` (${own[0].jobStatus})` : ''}`;
            } else if (entry && own.some((c) => c.sends.length > 0) && own.filter((c) => c.sends.length > 0).every((c) => { const r = agreedFrameFrom(input.oracle, results, m.id, m.address, job.id, c.args); return !r.ok && outside(r.why); })) {
                item.status = 'external';
                item.why = (() => { const c = own.find((x) => x.sends.length > 0)!; const r = agreedFrameFrom(input.oracle, results, m.id, m.address, job.id, c.args); return r.ok ? '' : r.why; })();
            } else {
                item.why = !entry
                    ? 'EdiabasLib was not run with it'
                    : entry.untried
                      ? entry.untried
                      : starts.length && hold
                        ? `no set whose stop (${op.stopJob}) was compared too`
                        : (item.disagree?.first ?? 'no set agreed');
            }
            out.push(item);
        }
    }
    return out;
}

'use client';

/**
 * What a job that drives something may send: what the app and EdiabasLib build alike.
 *
 * The owner decided (2026-11-15) which jobs run on the car, and (2026-11-18) that every one the table
 * opens must run — with values or without, one frame or several, on every module the app carries. The
 * app builds what it sends by running the module's own SGBD code (./jobFrame.ts, ./vm.ts). Before that
 * goes to a car it must be what BMW's own job runner builds for the same values and the same answers:
 * `job-frames.oracle.json` records, for each job and each set of values tried, what EdiabasLib sent and
 * what it was answered (tools/sgbd/gen_job_frames.py). A run is open only where
 *   - EdiabasLib was run with exactly those values and sent something, and the app's job, handed
 *     EdiabasLib's answers in turn, builds exactly the frames EdiabasLib sent, in order; or
 *   - for a number between two values EdiabasLib was run with: every value tried from one to the other
 *     (the other values as they were) agreed on a single frame, and the app's job builds one frame.
 * Anything else is not offered and not sent: values nobody compared are values nobody checked.
 *
 * A job with no values is the case with no values: its frame joins the module's telegram table
 * (`withAgreedFrames`), so every view that sends a job's telegram sends this one.
 *
 * What this proves is the bytes. Whether the module does what the job says is proved only on a car.
 */

import { readEcuData } from '../ecuData.ts';
import { finishFrame, jobFrameFrom } from './jobFrame.ts';
import { loadSgbdResults, type SgbdResultsTable } from './results.ts';
import { traceSgbdJob, type SgbdTables } from './vm.ts';
import type { Telegram, TelegramTable } from '../telegrams.ts';

/** How gen_job_frames.py tried an argument: every choice, a spread of numbers, or not at all (free text, bytes). */
export type OracleArgKind = 'choice' | 'number' | 'text';

export interface OracleCase {
    args: string[];
    /** The frames EdiabasLib sent, in order, checksum included. */
    sends: string[];
    /** What each was answered in the simulation (schema 2). */
    answers?: string[];
    jobStatus: string | null;
}

export interface OracleEntry {
    sgbd: string;
    kinds?: OracleArgKind[];
    values: string[][];
    cases: OracleCase[];
    /** Why the job was not run at all (an argument takes free text or bytes). */
    untried?: string;
}

export interface JobFramesOracle {
    schema: number;
    jobs: Record<string, OracleEntry>;
    generatedAt?: string;
}

declare const agreed: unique symbol;

/**
 * What a run sends, where the app and EdiabasLib build it alike. Only this file makes one, so a gate
 * handed one knows it was compared; the gate still checks it is for this job and these values.
 */
export interface AgreedFrame {
    readonly moduleId: string;
    readonly jobId: string;
    readonly args: readonly string[];
    /** The first frame (the only one, for most jobs), checksum included, lowercase hex. */
    readonly hex: string;
    /** Every frame of a run that sends several, in order, the first included. Absent: one frame. */
    readonly sequence?: readonly string[];
    /** `exact`: EdiabasLib was run with these values. `range`: a number between two tried values. */
    readonly basis: 'exact' | 'range';
    readonly [agreed]: true;
}

export type AgreedResult = { ok: true; frame: AgreedFrame } | { ok: false; why: string };

const key = (moduleId: string, jobId: string) => `${moduleId}:${jobId}`;
const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
const fromBase64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const bytesOf = (hex: string) => Uint8Array.from(hex.trim().split(/\s+/), (h) => parseInt(h, 16));
const make = (f: Omit<AgreedFrame, typeof agreed>) => f as unknown as AgreedFrame;

/** The case EdiabasLib was run with for exactly these values, agreed or not. */
function exactAgreement(entry: OracleEntry, table: SgbdResultsTable | null, moduleId: string, address: number, jobId: string, c: OracleCase): AgreedResult {
    if (c.sends.length === 0) return { ok: false, why: `EdiabasLib sends nothing for ${jobId}(${c.args.join(';')})${c.jobStatus ? ` — ${c.jobStatus}` : ''}` };
    if (c.sends.length === 1) {
        const built = jobFrameFrom(table, address, jobId, c.args);
        if (!built.ok) return { ok: false, why: built.why };
        if (built.hex !== c.sends[0]) return { ok: false, why: `the app builds ${built.hex}, EdiabasLib ${c.sends[0]}` };
        return { ok: true, frame: make({ moduleId, jobId, args: [...c.args], hex: built.hex, basis: 'exact' }) };
    }
    // Several frames: the job, handed EdiabasLib's answers in turn, must build EdiabasLib's frames in turn.
    const code = table?.jobs[jobId];
    if (!table || !code) return { ok: false, why: `the code of ${jobId} is not carried` };
    if (!c.answers || c.answers.length !== c.sends.length) return { ok: false, why: `EdiabasLib's answers to ${jobId} were not recorded` };
    const answers = c.answers;
    let mismatch: string | null = null;
    let traced;
    try {
        traced = traceSgbdJob(
            { code: fromBase64(code.code), base: code.base },
            {
                args: c.args,
                tables: table.tables as SgbdTables,
                maxSends: c.sends.length + 1,
                reply: (req, i) => {
                    if (i >= c.sends.length) return null;
                    const built = finishFrame(req, address);
                    if (!built.ok || built.hex !== c.sends[i]) {
                        mismatch = `frame ${i + 1}: the app builds ${built.ok ? built.hex : built.why}, EdiabasLib ${c.sends[i]}`;
                        return null;
                    }
                    return bytesOf(answers[i]);
                },
            },
        );
    } catch (e) {
        return { ok: false, why: `the job did not run: ${e instanceof Error ? e.message : String(e)}` };
    }
    if (mismatch) return { ok: false, why: mismatch };
    if (traced.requests.length < c.sends.length) return { ok: false, why: `the app's job sends ${traced.requests.length} frames, EdiabasLib ${c.sends.length}` };
    // Past EdiabasLib's last frame the job may ask again (a status it polls): only a frame it already sent.
    if (traced.requests.length > c.sends.length) {
        const extra = finishFrame(traced.requests[c.sends.length], address);
        if (!extra.ok || !c.sends.includes(extra.hex)) return { ok: false, why: `after EdiabasLib's last frame the app's job would send ${extra.ok ? extra.hex : extra.why}` };
    }
    void entry;
    return { ok: true, frame: make({ moduleId, jobId, args: [...c.args], hex: c.sends[0], sequence: [...c.sends], basis: 'exact' }) };
}

const asNumber = (v: string): number | null => {
    if (!/^-?(0x[0-9a-f]+|\d+(\.\d+)?)$/i.test(v.trim())) return null;
    const n = v.trim().toLowerCase().includes('0x') ? parseInt(v, 16) : Number(v);
    return Number.isFinite(n) ? n : null;
};

/**
 * For each number argument, the stretches EdiabasLib's tried values cover without a gap: every tried
 * value from one end to the other agreed on a single frame, with the other values as in `around`.
 */
function numberSpans(
    entry: OracleEntry,
    table: SgbdResultsTable | null,
    moduleId: string,
    address: number,
    jobId: string,
    around: readonly string[],
    i: number,
): Array<{ lo: number; hi: number; integer: boolean }> {
    const tried: Array<{ n: number; ok: boolean; integer: boolean }> = [];
    for (const c of entry.cases) {
        if (!c.args.every((v, j) => j === i || v === around[j])) continue;
        const n = asNumber(c.args[i]);
        if (n === null) continue;
        const r = exactAgreement(entry, table, moduleId, address, jobId, c);
        tried.push({ n, ok: r.ok && !r.frame.sequence, integer: Number.isInteger(n) });
    }
    tried.sort((a, b) => a.n - b.n);
    const spans: Array<{ lo: number; hi: number; integer: boolean }> = [];
    let run: typeof tried = [];
    const close = () => {
        if (run.length >= 2) spans.push({ lo: run[0].n, hi: run[run.length - 1].n, integer: run.every((x) => x.integer) });
        run = [];
    };
    for (const t of tried) {
        if (t.ok) run.push(t);
        else close();
    }
    close();
    return spans;
}

/** What may be sent for these values, if the app and EdiabasLib build it alike. Pure. */
export function agreedFrameFrom(
    oracle: JobFramesOracle | null,
    table: SgbdResultsTable | null,
    moduleId: string,
    address: number,
    jobId: string,
    args: readonly string[],
): AgreedResult {
    const entry = oracle?.jobs[key(moduleId, jobId)];
    if (!entry) return { ok: false, why: `EdiabasLib's frames for ${jobId} are not here to compare with` };
    const exact = entry.cases.find((x) => same(x.args, args));
    if (exact) return exactAgreement(entry, table, moduleId, address, jobId, exact);
    // A number between tried values: every other value as in a case EdiabasLib was run with, and each
    // number that differs from that case inside a stretch every tried value of which agreed.
    const kinds = entry.kinds;
    if (!kinds || kinds.length !== args.length) return { ok: false, why: `${jobId}(${args.join(';')}) was not compared with EdiabasLib` };
    const numbers = kinds.flatMap((k, i) => (k === 'number' ? [i] : []));
    const base = entry.cases.find((c) => c.args.length === args.length && c.args.every((v, i) => kinds[i] === 'number' ? v === entry.values[i][0] : v === args[i]));
    if (!base || numbers.length === 0) return { ok: false, why: `${jobId}(${args.join(';')}) was not compared with EdiabasLib` };
    for (const i of numbers) {
        if (args[i] === base.args[i]) continue;
        const n = asNumber(args[i]);
        const inside = n !== null && numberSpans(entry, table, moduleId, address, jobId, base.args, i).some((s) => n >= s.lo && n <= s.hi && (!s.integer || Number.isInteger(n)));
        if (!inside) return { ok: false, why: `${args[i]} for ${jobId}'s argument ${i + 1} is outside what EdiabasLib was run with` };
    }
    const built = jobFrameFrom(table, address, jobId, args);
    if (!built.ok) return { ok: false, why: built.why };
    return { ok: true, frame: make({ moduleId, jobId, args: [...args], hex: built.hex, basis: 'range' }) };
}

/**
 * Every set of values EdiabasLib was run with that the app may send, in the order it was run. The
 * screen and the assistant choose among these; a number between them is checked by `agreedFrameFrom`.
 */
export function agreedCasesFrom(
    oracle: JobFramesOracle | null,
    table: SgbdResultsTable | null,
    moduleId: string,
    address: number,
    jobId: string,
): AgreedFrame[] {
    const entry = oracle?.jobs[key(moduleId, jobId)];
    if (!entry) return [];
    const out: AgreedFrame[] = [];
    for (const c of entry.cases) {
        const r = exactAgreement(entry, table, moduleId, address, jobId, c);
        if (r.ok) out.push(r.frame);
    }
    return out;
}

/** Which arguments of a job are numbers the screen may type within the stretches EdiabasLib covered. */
export function numberArgs(oracle: JobFramesOracle | null, moduleId: string, jobId: string): number[] {
    return (oracle?.jobs[key(moduleId, jobId)]?.kinds ?? []).flatMap((k, i) => (k === 'number' ? [i] : []));
}

/** The agreed frame as the telegram the gate and the link take: certain, its sequence along. */
export function telegramOfAgreed(frame: AgreedFrame): Telegram {
    const control = parseInt(frame.hex.split(' ')[2] ?? '0', 16);
    return {
        hex: frame.hex,
        cmd: control,
        cmdName: 'built by its own code, as EdiabasLib builds it',
        occurrences: 1,
        confidence: 'single',
        ...(frame.sequence ? { sequence: [...frame.sequence] } : {}),
    };
}

/**
 * The module's telegram table with every job that takes no values given the frame(s) its own code
 * and EdiabasLib build alike. Where the table's scraped frame differs, EdiabasLib's is the one: BMW's
 * runner is the reference, the scrape a reading of it. Pure.
 */
export function withAgreedFrames(table: TelegramTable, oracle: JobFramesOracle | null, results: SgbdResultsTable | null): TelegramTable {
    if (!oracle) return table;
    const jobs = { ...table.jobs };
    const prefix = `${table.module}:`;
    for (const [k, entry] of Object.entries(oracle.jobs)) {
        if (!k.startsWith(prefix) || entry.values.length !== 0) continue;
        const jobId = k.slice(prefix.length);
        const c = entry.cases.find((x) => x.args.length === 0);
        if (!c) continue;
        const r = exactAgreement(entry, results, table.module, table.address, jobId, c);
        if (r.ok) jobs[jobId] = [telegramOfAgreed(r.frame)];
    }
    return { ...table, jobs };
}

/**
 * What a run of a job that takes values is called in the permit, the log and the ledger: the job and
 * the part it drives, its first value (`STEUERN_STELLGLIED(HYDROPUMPE)`), as a procedure is called by
 * its program (`TESTPRG_STARTEN(0x01)`). Practising one part opens no other. A job without values is
 * called by its id.
 */
export function runName(jobId: string, args: readonly string[] | undefined): string {
    return args && args.length ? `${jobId}(${args[0]})` : jobId;
}

/** Whether this frame is the agreed one for this job and these values: what a gate asks. */
export function isAgreedFor(frame: AgreedFrame | undefined, moduleId: string, jobId: string, args: readonly string[] | undefined, hex: string): boolean {
    return !!frame && !!args && frame.moduleId === moduleId && frame.jobId === jobId && same(frame.args, args) && frame.hex === hex;
}

let oracleOnce: Promise<JobFramesOracle | null> | null = null;

export function loadJobFramesOracle(): Promise<JobFramesOracle | null> {
    oracleOnce ??= readEcuData('job-frames.oracle.json')
        .then((r) => (r.ok ? (r.json() as Promise<JobFramesOracle>) : null))
        .catch(() => null);
    return oracleOnce;
}

/** What may be sent for these values, if the app and EdiabasLib build it alike. */
export async function agreedFrame(moduleId: string, address: number, jobId: string, args: readonly string[]): Promise<AgreedResult> {
    const [oracle, table] = await Promise.all([loadJobFramesOracle(), loadSgbdResults(moduleId)]);
    return agreedFrameFrom(oracle, table, moduleId, address, jobId, args);
}

/** Every set of values the app may send for this job. */
export async function agreedCases(moduleId: string, address: number, jobId: string): Promise<AgreedFrame[]> {
    const [oracle, table] = await Promise.all([loadJobFramesOracle(), loadSgbdResults(moduleId)]);
    return agreedCasesFrom(oracle, table, moduleId, address, jobId);
}

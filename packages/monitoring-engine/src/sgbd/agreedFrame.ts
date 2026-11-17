'use client';

/**
 * The frames a job that takes values may send: the ones the app and EdiabasLib build alike.
 *
 * The owner decided (2026-11-15) that the jobs that drive something run with values chosen on the
 * screen. The app builds such a frame by running the module's own SGBD code (./jobFrame.ts). Before a
 * frame like that goes to a car it must be the frame BMW's own job runner builds for the same values:
 * `job-frames.oracle.json` of the ECU data records, for each job and each set of values tried, what
 * EdiabasLib sent (tools/sgbd/gen_job_frames.py). A set of values is open only where
 *   - EdiabasLib was run with exactly those values,
 *   - it sent exactly one frame (a job that first sends something else, an IDENT, is not this one), and
 *   - the app builds that same frame.
 * Anything else is not offered and not sent: values nobody compared are values nobody checked.
 *
 * What this proves is the bytes. Whether the module does what the job says is proved only on a car.
 */

import { readEcuData } from '../ecuData.ts';
import { jobFrameFrom, type JobFrame } from './jobFrame.ts';
import { loadSgbdResults, type SgbdResultsTable } from './results.ts';
import type { Telegram } from '../telegrams.ts';

export interface JobFramesOracle {
    schema: number;
    jobs: Record<string, { sgbd: string; values: string[][]; cases: { args: string[]; sends: string[]; jobStatus: string | null }[] }>;
    generatedAt?: string;
}

declare const agreed: unique symbol;

/**
 * A frame for chosen values that the app and EdiabasLib build alike. Only `agreedFrameFrom` makes one,
 * so a gate handed one knows it was compared; the gate still checks it is for this job and these values.
 */
export interface AgreedFrame {
    readonly moduleId: string;
    readonly jobId: string;
    readonly args: readonly string[];
    readonly hex: string;
    readonly [agreed]: true;
}

export type AgreedResult = { ok: true; frame: AgreedFrame } | { ok: false; why: string };

const key = (moduleId: string, jobId: string) => `${moduleId}:${jobId}`;
const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/** The frame for these values, if the app and EdiabasLib build it alike. Pure. */
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
    const c = entry.cases.find((x) => same(x.args, args));
    if (!c) return { ok: false, why: `${jobId}(${args.join(';')}) was not compared with EdiabasLib` };
    if (c.sends.length !== 1) {
        return {
            ok: false,
            why: c.sends.length ? `EdiabasLib sends ${c.sends.length} frames for these values, not one` : 'EdiabasLib sends nothing for these values',
        };
    }
    const built: JobFrame = jobFrameFrom(table, address, jobId, args);
    if (!built.ok) return { ok: false, why: built.why };
    if (built.hex !== c.sends[0]) return { ok: false, why: `the app builds ${built.hex}, EdiabasLib ${c.sends[0]}` };
    return { ok: true, frame: { moduleId, jobId, args: [...args], hex: built.hex } as unknown as AgreedFrame };
}

/**
 * Every set of values the app may send for this job, in the order EdiabasLib was run with them. The
 * screen and the assistant choose among these and no others.
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
        const r = agreedFrameFrom(oracle, table, moduleId, address, jobId, c.args);
        if (r.ok) out.push(r.frame);
    }
    return out;
}

/** The agreed frame as the telegram the gate and the link take: one frame, certain. */
export function telegramOfAgreed(frame: AgreedFrame): Telegram {
    const control = parseInt(frame.hex.split(' ')[2] ?? '0', 16);
    return { hex: frame.hex, cmd: control, cmdName: 'built for the values chosen', occurrences: 1, confidence: 'single' };
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

/** The frame for these values, if the app and EdiabasLib build it alike. */
export async function agreedFrame(moduleId: string, address: number, jobId: string, args: readonly string[]): Promise<AgreedResult> {
    const [oracle, table] = await Promise.all([loadJobFramesOracle(), loadSgbdResults(moduleId)]);
    return agreedFrameFrom(oracle, table, moduleId, address, jobId, args);
}

/** Every set of values the app may send for this job. */
export async function agreedCases(moduleId: string, address: number, jobId: string): Promise<AgreedFrame[]> {
    const [oracle, table] = await Promise.all([loadJobFramesOracle(), loadSgbdResults(moduleId)]);
    return agreedCasesFrom(oracle, table, moduleId, address, jobId);
}

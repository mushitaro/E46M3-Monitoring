/**
 * Starting one job that drives something — the same steps whoever started it.
 *
 * ACTUATOR's RUN (after its confirmation) and the assistant's `monitoring_actuate` (after the
 * owner's spoken OK) both come here, so there is one path from an allowed verdict to a sent frame
 * and an armed output: the gate's permit for exactly those bytes, the link's measurement before it
 * sends, and — for a start that leaves something on — the stop resolved before it is armed, with the
 * time-out that ends it by itself. Nothing here decides whether the job may run: the verdict comes
 * from the gate (`mayActuate`), and only its allowed shape is accepted.
 *
 * Pure apart from the two calls it is handed, so vitest (node) holds it.
 */

import {
    DEFAULT_RUN_TIMEOUT_S,
    bestTelegram,
    decisionFor,
    isReadNature,
    operationFor,
    permitFor,
    runName,
    stopPermitOf,
    type ActuationPermit,
    type AgreedFrame,
    type CatalogJob,
    type Motion,
    type RunVerdict,
    type SendRequirement,
    type TelegramTable,
} from '@tsunagi/monitoring-engine';
import type { Phase as ArgPhase } from './actuatorArgs';
import type { ArmedJob } from './arming';

type Phase = Exclude<ArgPhase, 'stop'>;

export interface StartActuation {
    moduleId: string;
    job: CatalogJob;
    phase: Phase;
    verdict: Extract<RunVerdict, { allowed: true }>;
    telegrams: TelegramTable | null;
    /**
     * For a job that takes values: the values chosen (the verdict's frame is the one agreed for them),
     * and, for a start, the agreed frame of its stop for the same part (its `stopArgs` over these
     * values). A start whose stop is not in hand is not sent: nothing is left on that cannot be ended.
     */
    args?: readonly string[];
    stop?: AgreedFrame;
    /** Send a job's frame: the link's run path, which owns the busy lock, the log and the preflight. */
    send: (jobId: string, hex: string, requires?: SendRequirement, permit?: ActuationPermit) => Promise<unknown>;
    arm: (entry: ArmedJob) => void;
    now: number;
}

export interface Started {
    /** The link answered: the frame went out and was not refused by the measurement. */
    sent: boolean;
    /** Left on, with its stop armed (a start whose job has a release). */
    armed: boolean;
    /** When it stops by itself, if armed. */
    timeoutS: number | null;
}

export async function startActuation(p: StartActuation): Promise<Started> {
    const withValues = p.job.args.length > 0;
    // A job that takes values is sent, permitted and recorded per part it drives (agreedFrame.runName).
    const name = runName(p.job.id, withValues ? p.args : undefined);
    const stopId = operationFor(p.job).stopJob;
    // Its stop is the same job or its companion over the same part, built and agreed before anything is
    // sent: a start of one whose stop is not in hand does not go.
    if (withValues && p.phase === 'start' && stopId && (!p.stop || p.stop.jobId !== stopId || p.stop.moduleId !== p.moduleId)) return { sent: false, armed: false, timeoutS: null };
    // On a car, a frame that drives something goes with the gate's permit for exactly its bytes;
    // the link measures the car (stationary, battery, engine) before it sends.
    const permit = permitFor(p.verdict, p.moduleId, name, p.now) ?? undefined;
    const result = await p.send(name, p.verdict.telegram.hex, p.verdict.requires, permit);
    // Not started (refused, not measured, no answer): nothing to stop, nothing armed.
    if (result === null || result === undefined) return { sent: false, armed: false, timeoutS: null };
    if (p.phase !== 'start') return { sent: true, armed: false, timeoutS: null };
    const stopTelegram = withValues ? p.stop : stopId ? bestTelegram(p.telegrams, stopId) : null;
    const stopHex = stopTelegram?.hex;
    const stopName = withValues && stopId ? runName(stopId, p.stop?.args) : stopId;
    // Cannot resolve the release? Then it was never armed: there is no state where an output is on
    // and nothing knows how to end it (lib/arming).
    if (!stopId || !stopHex || !stopName) return { sent: true, armed: false, timeoutS: null };
    const timeoutS = p.verdict.actuation?.timeoutS ?? DEFAULT_RUN_TIMEOUT_S;
    p.arm({
        jobId: p.job.id,
        stopJobId: stopName,
        stopHex,
        at: p.now,
        stopPermit: permit && stopTelegram ? stopPermitOf(permit, stopName, stopTelegram, p.stop?.args) : undefined,
        timeoutS,
        moduleId: p.moduleId,
        ...(withValues && p.args ? { args: [...p.args] } : {}),
    });
    return { sent: true, armed: true, timeoutS };
}
/**
 * What the owner's table says of a job for the assistant, before any value is chosen and before the
 * owner's words: a read is read, an item kept off or shown only is not run, an item kept for a person
 * on the screen is theirs (`screen: true`: the caller puts it on the screen for them). Asked first, so
 * a write is refused as a write, not as "no set of values" (IJ F08). Null: the assistant may go on.
 */
export function tableRefusal(
    moduleId: string,
    job: Pick<CatalogJob, 'id' | 'class'>,
    group: string | undefined,
    args?: readonly string[],
): { reason: string; screen: boolean; stop: 'route' | 'S6' } | null {
    const d = decisionFor(moduleId, job, group, args);
    if (isReadNature(d.nature)) return { reason: `${job.id} reads; it is read with the read tools (monitoring_read and the rest), not started.`, screen: false, stop: 'route' };
    if (d.how === 'off') {
        // Said by what it is (MM02 F26): a safety device's deployment, a write — then the owner's rule.
        const what = d.nature === 'a_safety' ? `${job.id} deploys a safety device` : d.nature === 'w' ? `${job.id} writes to the module (coding, programming, identity or flash)` : null;
        return { reason: `${what ? `${what}: ` : ''}the owner keeps ${what ? 'it' : job.id} off, and it is not run from here at all. Tell the owner it cannot be done.`, screen: false, stop: 'S6' };
    }
    if (d.how === 'show') return { reason: `The owner shows ${job.id} on the screen only: it is not run.`, screen: false, stop: 'S6' };
    if (d.who !== 'ai')
        return { reason: `The owner's table keeps ${job.id} for a person on the screen. It has been put on the screen for them to press: say so.`, screen: true, stop: 'route' };
    return null;
}

/**
 * Words that only hesitate are not an OK (IJ07: 「うーん、どうしようかな」「まあいいか」). The assistant is
 * told to ask again; a clear yes said with them (「うーん、いいよ」) is a yes. A no or a wait is never one.
 */
const NO = /ううん|いいえ|いや(?!、?いいよ)|だめ|ダメ|やめ|待って|まって|ストップ|\bno\b|\bnope\b|\bwait\b|don'?t|\bstop\b/i;
const HESITANT = /うーん|う〜ん|うーむ|ううむ|どうしよう|まあいいか|まぁいいか|まあ、?いいか|迷|悩|かな|たぶん|多分|やっぱ|どうかな|\bhmm+\b|\bmaybe\b|not sure|i guess|\bperhaps\b|let me think/i;
const YES = /いいよ|いいです|いいね|いいぞ|はい|お願い|おねがい|やって|動かして|どうぞ|オッケー|オーケー|\bok\b|\bokay\b|\byes\b|\bsure\b|go ahead|うん(?!ー)/i;

/** Why the owner's words are not an OK, or null when they are one. */
export function notAnOk(ownerSaid: string): string | null {
    const said = ownerSaid.trim();
    if (!said) return 'Read back what will move and its preconditions, wait for the owner\'s OK, and pass their words as owner_said.';
    if (NO.test(said)) return `The owner's words are a no or a wait, not an OK (「${said}」). Nothing was started.`;
    // The last thing said decides: 「うーん、いいよ」 ends on a yes, 「動かしていいかな」 on a question.
    const last = said.split(/[、。,.!！?？\s]+/).filter(Boolean).at(-1) ?? said;
    if (HESITANT.test(last) || (HESITANT.test(said) && !YES.test(last)))
        return `The owner's words only hesitate (「${said}」): that is not an OK, and nothing was started. Ask again whether to run it, and wait for a clear yes.`;
    return null;
}

/**
 * Whether the assistant may start this job, before the gate is asked: the owner's table says who
 * (policy.ts `who`), and the assistant starts nothing while the car moves (the owner, 2026-11-16:
 * "走行中の AI は読むだけ"), nor on words that are not a clear OK. Its reasons are sentences for the
 * assistant to say. A yes here is not a yes to send: the same gate the screen asks comes after, and
 * the link measures before it sends.
 */
export function assistantMayStart(
    moduleId: string,
    job: Pick<CatalogJob, 'id' | 'class'>,
    group: string | undefined,
    motion: Motion,
    ownerSaid: string,
    /** The values chosen, for a job whose nature depends on one (SMG II's lamps against its valves). */
    args?: readonly string[],
): { ok: true } | { ok: false; reason: string; stop: 'route' | 'S1' | 'S3' | 'S6'; screen?: boolean } {
    const table = tableRefusal(moduleId, job, group, args);
    if (table) return { ok: false, reason: table.reason, stop: table.stop, ...(table.screen ? { screen: true } : {}) };
    if (motion === 'moving') return { ok: false, reason: 'The car is moving: the assistant only reads while it moves. Ask again parked.', stop: 'S1' };
    const words = notAnOk(ownerSaid);
    if (words) return { ok: false, reason: words, stop: 'S3' };
    return { ok: true };
}

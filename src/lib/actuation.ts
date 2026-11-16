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
    stopPermit,
    type ActuationPermit,
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
    // On a car, a frame that drives something goes with the gate's permit for exactly its bytes;
    // the link measures the car (stationary, battery, engine) before it sends.
    const permit = permitFor(p.verdict, p.moduleId, p.job.id, p.now) ?? undefined;
    const result = await p.send(p.job.id, p.verdict.telegram.hex, p.verdict.requires, permit);
    // Not started (refused, not measured, no answer): nothing to stop, nothing armed.
    if (result === null || result === undefined) return { sent: false, armed: false, timeoutS: null };
    if (p.phase !== 'start') return { sent: true, armed: false, timeoutS: null };
    const stopId = operationFor(p.job).stopJob;
    const stopHex = stopId ? bestTelegram(p.telegrams, stopId)?.hex : undefined;
    // Cannot resolve the release? Then it was never armed: there is no state where an output is on
    // and nothing knows how to end it (lib/arming).
    if (!stopId || !stopHex) return { sent: true, armed: false, timeoutS: null };
    const timeoutS = p.verdict.actuation?.timeoutS ?? DEFAULT_RUN_TIMEOUT_S;
    p.arm({
        jobId: p.job.id,
        stopJobId: stopId,
        stopHex,
        at: p.now,
        stopPermit: permit ? stopPermit(permit, stopId, stopHex) : undefined,
        timeoutS,
    });
    return { sent: true, armed: true, timeoutS };
}

/**
 * Whether the assistant may start this job, before the gate is asked: the owner's table says who
 * (policy.ts `who`), and the assistant starts nothing while the car moves (the owner, 2026-11-16:
 * "走行中の AI は読むだけ"). Its reasons are sentences for the assistant to say. A yes here is not a
 * yes to send: the same gate the screen asks comes after, and the link measures before it sends.
 */
export function assistantMayStart(
    moduleId: string,
    job: Pick<CatalogJob, 'id' | 'class'>,
    group: string | undefined,
    motion: Motion,
    ownerSaid: string,
): { ok: true } | { ok: false; reason: string } {
    const d = decisionFor(moduleId, job, group);
    if (isReadNature(d.nature)) return { ok: false, reason: `${job.id} reads; it is read with the read tools (monitoring_read and the rest), not started.` };
    if (d.how === 'off') return { ok: false, reason: `The owner keeps ${job.id} off: it is not run from here at all.` };
    if (d.how === 'show') return { ok: false, reason: `The owner shows ${job.id} on the screen only: it is not run.` };
    if (d.who !== 'ai')
        return { ok: false, reason: `The owner's table keeps ${job.id} for a person on the screen. monitoring_stage puts it there for them to press.` };
    if (motion === 'moving') return { ok: false, reason: 'The car is moving: the assistant only reads while it moves. Ask again parked.' };
    if (!ownerSaid.trim())
        return { ok: false, reason: 'Read back what will move and its preconditions, wait for the owner\'s OK, and pass their words as owner_said.' };
    return { ok: true };
}

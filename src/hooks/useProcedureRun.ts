'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { JobRunResult } from '@/hooks/useDs2Link';
import {
    STOP_JOB,
    decodeTestStatus,
    finishedWell,
    stillRunning,
    type ProcedurePlan,
} from '@/lib/procedureRun';
import type { ActuationPermit, NotSent, SendRequirement } from '@tsunagi/monitoring-engine';

/**
 * Driving one SMG II test program, and knowing when it is over.
 *
 * The loop is the ECU's, not ours: `TESTPRG_STARTEN` is re-sent until its answer
 * reports something other than "running", because that is how this controller
 * reports progress — see `lib/procedureRun` for the quotes. So this hook is an
 * awaited loop rather than a `setInterval`: one exchange is in flight at a time,
 * a slow answer delays the next ask instead of stacking on top of it, and the
 * link's command gate never has to arbitrate between two of our own requests.
 *
 * ## Leaving always stops the gearbox
 *
 * Every ending — finished, refused, aborted, the dialog closed, the component
 * unmounted — sends `TESTPRG_STOP`. It is sent even when the ECU has already
 * said it finished, because the cost of a redundant stop is one frame and the
 * cost of a missed one is a clutch actuator left energised. The unmount path is
 * the one that cannot await, so it fires the stop and does not wait for it:
 * an unawaited stop that reaches the ECU is worth more than a tidy teardown that
 * never sent one.
 */
export type RunPhase = 'idle' | 'starting' | 'running' | 'ended';

export interface ProcedureRunState {
    phase: RunPhase;
    /** Seconds since START went out. The wizard shows it against durMaxSec. */
    elapsedSec: number;
    /** The ECU's own status byte, 0..3, or null before the first answer. */
    statusByte: number | null;
    /** Infobyte 1 — the key into this procedure's activity vocabulary. */
    infoByte: number | null;
    /** The last answer as it arrived, printed beside the decode. */
    rawResponse: string | null;
    /** How many times the status has been asked. */
    polls: number;
    error: string | null;
}

const IDLE: ProcedureRunState = {
    phase: 'idle',
    elapsedSec: 0,
    statusByte: null,
    infoByte: null,
    rawResponse: null,
    polls: 0,
    error: null,
};

/** How a run ended, as the dialog, the page and the assistant say it (IJ06). */
export interface ProcedureOutcome {
    ended: 'ok' | 'notOk' | 'aborted' | 'refused' | 'failed';
    /** The link's sentence for a failure: the module's refusal with its status, or why it was not sent. */
    error: string | null;
    /** The module's negative answer, when it refused a step. */
    refusedStatus: number | null;
    /** The link's own refusal before sending (the engine not as asked, moving, battery), with what it measured. */
    notSent?: NotSent | null;
}

/** The status byte of a module's refusal, read from the link's sentence (ds2-core `assertPositive`). */
export function refusedStatusOf(error: string | null): number | null {
    const m = error ? /rejected by the ECU:.*\(status 0x([0-9a-f]{2})\)/i.exec(error) : null;
    return m ? Number.parseInt(m[1], 16) : null;
}

export function useProcedureRun(
    send: (jobId: string, hex: string, requires?: SendRequirement, permit?: ActuationPermit) => Promise<JobRunResult | null>,
    /** Why the last send came back empty: the link's own sentence and shape, read straight after the await. */
    why?: () => { error: string | null; notSent: NotSent | null },
) {
    const [state, setState] = useState<ProcedureRunState>(IDLE);
    const cancelled = useRef(false);
    const stopHex = useRef<string | null>(null);
    // The stop's permit (runGate.procedurePermits): on a car the release goes with it, never measured.
    const stopPermit = useRef<ActuationPermit | undefined>(undefined);

    /** Fire TESTPRG_STOP. Never throws — an ending must not fail to end. */
    const sendStop = useCallback(async () => {
        const hex = stopHex.current;
        if (!hex) return;
        stopHex.current = null;
        try {
            // `none`: an ending is never held back by the speed preflight.
            await send(STOP_JOB, hex, 'none', stopPermit.current);
        } catch {
            // The link reports its own failures. Swallowing here only stops one
            // failed stop from masking the reason the run ended.
        }
    }, [send]);

    // Unmount is an ending too. It cannot await, so it fires and lets go — see
    // the note at the top.
    //
    // The dependency array is EMPTY, and the callback is reached through a ref
    // rather than closed over. `send` is the link's `runRead`, whose identity
    // this hook does not control; listing `sendStop` here would re-run this
    // cleanup on any render that changed it — cancelling a live procedure and
    // firing a stop in the middle of a run that nobody asked to end. An unmount
    // effect that fires on a re-render is not an unmount effect.
    const sendStopRef = useRef(sendStop);
    sendStopRef.current = sendStop;
    useEffect(() => {
        return () => {
            cancelled.current = true;
            void sendStopRef.current();
        };
    }, []);

    const abort = useCallback(async () => {
        cancelled.current = true;
        await sendStop();
        setState((s) => (s.phase === 'ended' ? s : { ...s, phase: 'ended' }));
    }, [sendStop]);

    const start = useCallback(
        async (plan: ProcedurePlan): Promise<ProcedureOutcome> => {
            const ended = (error: string | null): ProcedureOutcome => {
                const refusedStatus = refusedStatusOf(error);
                return { ended: refusedStatus !== null ? 'refused' : 'failed', error, refusedStatus };
            };
            const aborted: ProcedureOutcome = { ended: 'aborted', error: null, refusedStatus: null };
            cancelled.current = false;
            stopHex.current = plan.stopHex;
            stopPermit.current = plan.permits.stop;
            setState({ ...IDLE, phase: 'starting' });

            // The ECU's rule, not a habit of ours: STOP goes first, even with
            // nothing running. `lib/procedureRun` quotes it.
            const cleared = await send(STOP_JOB, plan.stopHex, 'none', plan.permits.stop);
            if (cancelled.current) return aborted;
            if (cleared?.error) {
                setState((s) => ({ ...s, phase: 'ended', error: cleared.error }));
                return ended(cleared.error);
            }
            stopHex.current = plan.stopHex;

            const began = Date.now();
            let polls = 0;
            setState((s) => ({ ...s, phase: 'running' }));

            // The first START and every re-ask are the same call. Splitting them
            // would give the first answer a different path from the rest, and
            // the first answer is the one that says whether it started at all.
            for (;;) {
                if (cancelled.current) return aborted;
                // The first START is measured (stationary, battery, engine as the procedure asks) and
                // counts as the run; every re-ask after it is the same run asked again.
                const answer = await send(plan.startJobId, plan.startHex, 'parked', polls === 0 ? plan.permits.start : plan.permits.follow);
                polls++;
                if (cancelled.current) return aborted;

                if (!answer || answer.error) {
                    // The module's refusal (a negative answer, with its status) or the link's reason
                    // for not sending (moving, battery), said in the dialog — not a bare "no answer".
                    const told = why?.() ?? null;
                    const error = answer?.error ?? told?.error ?? 'no answer';
                    const notSent = told?.notSent ?? null;
                    setState((s) => ({
                        ...s,
                        phase: 'ended',
                        error,
                        elapsedSec: Math.round((Date.now() - began) / 1000),
                    }));
                    await sendStop();
                    return { ...ended(error), ...(notSent ? { ended: 'failed' as const, notSent } : {}) };
                }

                const decoded = decodeTestStatus(answer.response);
                const elapsedSec = Math.round((Date.now() - began) / 1000);
                setState((s) => ({
                    ...s,
                    elapsedSec,
                    polls: s.polls + 1,
                    rawResponse: answer.response,
                    statusByte: decoded?.statusByte ?? null,
                    infoByte: decoded?.infoByte ?? null,
                }));

                // An answer we cannot read is an ending, not a reason to keep
                // asking: a loop that cannot recognise its own stop condition
                // runs until the operator gives up, which is the worst way for a
                // gearbox procedure to end.
                if (!decoded) {
                    setState((s) => ({ ...s, phase: 'ended', error: 'unreadable status' }));
                    await sendStop();
                    return { ended: 'failed', error: 'unreadable status', refusedStatus: null };
                }
                if (!stillRunning(decoded.statusByte)) {
                    setState((s) => ({ ...s, phase: 'ended' }));
                    await sendStop();
                    return { ended: finishedWell(decoded.statusByte) ? 'ok' : 'notOk', error: null, refusedStatus: null };
                }
                await sleep(plan.statusIntervalMs);
            }
        },
        [send, sendStop, why],
    );

    const reset = useCallback(() => {
        cancelled.current = true;
        setState(IDLE);
    }, []);

    return {
        state,
        start,
        abort,
        reset,
        /** True while the gearbox is working — the wizard's one-way-out rule. */
        live: state.phase === 'starting' || state.phase === 'running',
        finishedWell: state.statusByte !== null && finishedWell(state.statusByte),
    };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

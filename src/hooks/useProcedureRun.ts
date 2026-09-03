'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { JobRunResult } from '@/hooks/useDs2Link';
import {
    START_JOB,
    STOP_JOB,
    decodeTestStatus,
    finishedWell,
    stillRunning,
    type ProcedurePlan,
} from '@/lib/procedureRun';

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

export function useProcedureRun(send: (jobId: string, hex: string) => Promise<JobRunResult | null>) {
    const [state, setState] = useState<ProcedureRunState>(IDLE);
    const cancelled = useRef(false);
    const stopHex = useRef<string | null>(null);

    /** Fire TESTPRG_STOP. Never throws — an ending must not fail to end. */
    const sendStop = useCallback(async () => {
        const hex = stopHex.current;
        if (!hex) return;
        stopHex.current = null;
        try {
            await send(STOP_JOB, hex);
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
        async (plan: ProcedurePlan) => {
            cancelled.current = false;
            stopHex.current = plan.stopHex;
            setState({ ...IDLE, phase: 'starting' });

            // The ECU's rule, not a habit of ours: STOP goes first, even with
            // nothing running. `lib/procedureRun` quotes it.
            const cleared = await send(STOP_JOB, plan.stopHex);
            if (cancelled.current) return;
            if (cleared?.error) {
                setState((s) => ({ ...s, phase: 'ended', error: cleared.error }));
                return;
            }
            stopHex.current = plan.stopHex;

            const began = Date.now();
            setState((s) => ({ ...s, phase: 'running' }));

            // The first START and every re-ask are the same call. Splitting them
            // would give the first answer a different path from the rest, and
            // the first answer is the one that says whether it started at all.
            for (;;) {
                if (cancelled.current) return;
                const answer = await send(START_JOB, plan.startHex);
                if (cancelled.current) return;

                if (!answer || answer.error) {
                    setState((s) => ({
                        ...s,
                        phase: 'ended',
                        error: answer?.error ?? 'no answer',
                        elapsedSec: Math.round((Date.now() - began) / 1000),
                    }));
                    await sendStop();
                    return;
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
                    return;
                }
                if (!stillRunning(decoded.statusByte)) {
                    setState((s) => ({ ...s, phase: 'ended' }));
                    await sendStop();
                    return;
                }
                await sleep(plan.statusIntervalMs);
            }
        },
        [send, sendStop],
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

'use client';

import { useCallback, useRef, useState } from 'react';
import {
    NO_ARMED,
    arm as armIn,
    disarm as disarmIn,
    pendingStops,
    type ArmedJob,
    type ArmedMap,
} from '@/lib/arming';

/**
 * The React skin over `lib/arming`. The rules live there and are tested there;
 * what is here is the part that cannot be pure — sending, and the ordering
 * around teardown.
 *
 * ## Why `stopAll` is awaited, and never in an effect cleanup
 *
 * An effect cleanup cannot await. If the release were written as one, React
 * would call it, get a promise back, drop it, and continue — and by the time
 * that promise wanted the link, `disconnect()` would already have closed it. The
 * output would stay energised with the page no longer able to reach the ECU.
 *
 * So the caller awaits `stopAll()` at every point where the app stops being able
 * to send: before `disconnect()`, on an ECU change, on a tab change, on a
 * language change. Those are explicit calls on purpose. A teardown that has to
 * happen before another teardown is not something to leave to a framework's
 * ordering.
 *
 * ## No busy lock
 *
 * Arming does not take the app's busy lock. An energised output is not a write
 * in flight: the operator must stay able to switch tabs, read the log, and above
 * all press STOP. What the header shows instead is ENGAGED — the same violet
 * pulse, from `anyArmed`, holding nothing.
 */
export interface ArmingLink {
    /** Send a job's telegram. The same call the run path uses. */
    send: (jobId: string, hex: string) => Promise<unknown>;
}

export interface Arming {
    armed: ArmedMap;
    anyArmed: boolean;
    /**
     * Record that a job's output is energised.
     *
     * Takes the stop it will use, so there is no reachable state in which
     * something is running and nothing knows how to end it.
     */
    arm: (entry: ArmedJob) => void;
    /**
     * Send one job's stop and disarm it.
     *
     * **Not gated, and it does not care what the link says.** An armed output is
     * a physical thing that is on; the release goes out and the row disarms
     * whether the ECU answered, refused or timed out. The truthful state after a
     * failed stop is "we sent it and do not know" — never "still armed", which
     * would leave the operator pressing a button they have already pressed.
     */
    stop: (jobId: string) => Promise<void>;
    /** Every stop, oldest first, each one awaited. Safe to call when empty. */
    stopAll: () => Promise<void>;
}

export function useActuatorArming(link: ArmingLink): Arming {
    const [armed, setArmed] = useState<ArmedMap>(NO_ARMED);
    // `stopAll` runs during teardown, after the last render that could have
    // closed over the state. The ref is what it reads, so a release cannot be
    // skipped because a callback was made one render too early.
    const armedRef = useRef<ArmedMap>(NO_ARMED);

    const write = useCallback((next: ArmedMap) => {
        armedRef.current = next;
        setArmed(next);
    }, []);

    const arm = useCallback(
        (entry: ArmedJob) => {
            write(armIn(armedRef.current, entry));
        },
        [write],
    );

    const stopOne = useCallback(
        async (entry: ArmedJob) => {
            // Disarm FIRST. If the send throws, the row must not be left armed —
            // and if the operator presses again while this one is in flight, the
            // second press should find nothing rather than send a second stop.
            write(disarmIn(armedRef.current, entry.jobId));
            await link.send(entry.stopJobId, entry.stopHex).catch(() => {
                // Swallowed on purpose. The caller's own log already records the
                // failure; rethrowing here would abort `stopAll` partway and
                // leave later outputs energised because an earlier one failed.
            });
        },
        [link, write],
    );

    const stop = useCallback(
        async (jobId: string) => {
            const entry = armedRef.current.get(jobId);
            if (!entry) return;
            await stopOne(entry);
        },
        [stopOne],
    );

    const stopAll = useCallback(async () => {
        for (const entry of pendingStops(armedRef.current)) {
            await stopOne(entry);
        }
    }, [stopOne]);

    return { armed, anyArmed: armed.size > 0, arm, stop, stopAll };
}

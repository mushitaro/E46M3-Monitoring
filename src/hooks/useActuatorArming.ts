'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
    NO_ARMED,
    arm as armIn,
    disarm as disarmIn,
    pendingStops,
    type ArmedJob,
    type ArmedMap,
    type StopHow,
    type Stopped,
} from '@/lib/arming';
import type { ActuationPermit, SendRequirement } from '@tsunagi/monitoring-engine';

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
    send: (jobId: string, hex: string, requires?: SendRequirement, permit?: ActuationPermit) => Promise<unknown>;
    /** The stops, written straight to the transport as the page goes away (link session `lastGasp`). */
    lastGasp?: (stopHexes: readonly string[]) => number;
}

/** Where a page that went away with something on leaves word of it, for the page that opens next. */
export const LEFT_RUNNING_KEY = 'monitoring.actuator.leftRunning';

/** What a page that went away with something on left behind (`leave`). */
export interface LeftRunning {
    moduleId: string | null;
    jobId: string;
    args: string[] | null;
    timeoutS: number | null;
    at: number;
    leftAt: number;
    /** The stop was handed to the transport as the page went. */
    stopWritten: boolean;
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
     * would leave the operator pressing a button they have already pressed. A
     * stop nobody answered is kept and sent again when the line comes back
     * (`resendUnconfirmed`).
     */
    stop: (jobId: string, how?: StopHow) => Promise<Stopped | null>;
    /** Every stop, oldest first, each one awaited. Safe to call when empty. What it stopped. */
    stopAll: (how?: StopHow) => Promise<Stopped[]>;
    /** The last stop, as the screen's notice line and the assistant say it. */
    last: Stopped | null;
    /** The stops sent with no answer (the line was gone): sent again once the line is back. */
    resendUnconfirmed: () => Promise<Stopped[]>;
    /** The page is going away: write every stop to the wire now, and leave word of it for the next page. */
    leave: () => void;
}

export function useActuatorArming(link: ArmingLink): Arming {
    const [armed, setArmed] = useState<ArmedMap>(NO_ARMED);
    const [last, setLast] = useState<Stopped | null>(null);
    // `stopAll` runs during teardown, after the last render that could have
    // closed over the state. The ref is what it reads, so a release cannot be
    // skipped because a callback was made one render too early.
    const armedRef = useRef<ArmedMap>(NO_ARMED);
    // Stops nobody answered (the line was gone), oldest first.
    const unconfirmed = useRef<ArmedJob[]>([]);
    // The link's calls, read when a stop goes rather than when a callback was made.
    const linkRef = useRef(link);
    useEffect(() => {
        linkRef.current = link;
    });

    // The time-outs (policy: always stoppable). One per armed job; cleared when it is stopped.
    const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

    const write = useCallback((next: ArmedMap) => {
        armedRef.current = next;
        setArmed(next);
    }, []);

    // Reached through a ref: the time-out fires after the render that armed it.
    const stopRef = useRef<(jobId: string, how?: StopHow) => Promise<Stopped | null>>(async () => null);

    const arm = useCallback(
        (entry: ArmedJob) => {
            write(armIn(armedRef.current, entry));
            if (entry.timeoutS && entry.timeoutS > 0) {
                timers.current.set(entry.jobId, setTimeout(() => void stopRef.current(entry.jobId, 'timeout'), entry.timeoutS * 1000));
            }
        },
        [write],
    );

    const sendStop = useCallback(async (entry: ArmedJob, how: StopHow): Promise<Stopped> => {
        // `none`: a STOP is never held back by the speed preflight. A failed speed read must not
        // be the reason an output stays energised. On a car it carries the permit its start was given.
        // A failure is swallowed on purpose: the link's own log records it, and rethrowing here would
        // abort `stopAll` partway and leave later outputs energised because an earlier one failed.
        const answer = await linkRef.current.send(entry.stopJobId, entry.stopHex, 'none', entry.stopPermit).catch(() => null);
        const confirmed = answer !== null && answer !== undefined;
        unconfirmed.current = unconfirmed.current.filter((e) => e.jobId !== entry.jobId);
        if (!confirmed) unconfirmed.current.push(entry);
        const done: Stopped = { entry, how, at: Date.now(), confirmed };
        setLast(done);
        return done;
    }, []);

    const stopOne = useCallback(
        async (entry: ArmedJob, how: StopHow): Promise<Stopped> => {
            // Disarm FIRST. If the send throws, the row must not be left armed —
            // and if the operator presses again while this one is in flight, the
            // second press should find nothing rather than send a second stop.
            write(disarmIn(armedRef.current, entry.jobId));
            const timer = timers.current.get(entry.jobId);
            if (timer) clearTimeout(timer);
            timers.current.delete(entry.jobId);
            return sendStop(entry, how);
        },
        [write, sendStop],
    );

    const stop = useCallback(
        async (jobId: string, how: StopHow = 'stop') => {
            const entry = armedRef.current.get(jobId);
            if (!entry) return null;
            return stopOne(entry, how);
        },
        [stopOne],
    );

    useEffect(() => {
        stopRef.current = stop;
    }, [stop]);

    const stopAll = useCallback(
        async (how: StopHow = 'stop') => {
            const out: Stopped[] = [];
            for (const entry of pendingStops(armedRef.current)) out.push(await stopOne(entry, how));
            return out;
        },
        [stopOne],
    );

    const resendUnconfirmed = useCallback(async () => {
        const out: Stopped[] = [];
        for (const entry of [...unconfirmed.current]) out.push(await sendStop(entry, 'lineBack'));
        return out;
    }, [sendStop]);

    const leave = useCallback(() => {
        const on = pendingStops(armedRef.current);
        if (on.length === 0) return;
        const written = linkRef.current.lastGasp?.(on.map((e) => e.stopHex)) ?? 0;
        const left: LeftRunning[] = on.map((e) => ({
            moduleId: e.moduleId ?? null,
            jobId: e.jobId,
            args: e.args ? [...e.args] : null,
            timeoutS: e.timeoutS ?? null,
            at: e.at,
            leftAt: Date.now(),
            stopWritten: written > 0,
        }));
        try {
            localStorage.setItem(LEFT_RUNNING_KEY, JSON.stringify(left));
        } catch {
            /* storage refused: the stop itself has gone out */
        }
    }, []);

    return { armed, anyArmed: armed.size > 0, arm, stop, stopAll, last, resendUnconfirmed, leave };
}

/** What the page before this one left running, read once and forgotten (the screen and the assistant keep it for the session). */
export function takeLeftRunning(): LeftRunning[] {
    try {
        const raw = localStorage.getItem(LEFT_RUNNING_KEY);
        if (!raw) return [];
        localStorage.removeItem(LEFT_RUNNING_KEY);
        const parsed = JSON.parse(raw) as LeftRunning[];
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

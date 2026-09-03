/**
 * Which actuator outputs are currently energised, as a value.
 *
 * The state machine lives here, apart from React, because the properties that
 * matter are properties of the machine and this repo's vitest runs under
 * `environment: 'node'` — a rule that can only be checked by mounting a
 * component is a rule nobody checks.
 *
 * ## The invariant: you cannot arm what you cannot stop
 *
 * `arm` takes the stop it will use. A job with no resolvable stop cannot enter
 * the map at all, so there is no state in which something is running and the UI
 * has no way to end it. The predecessor armed first and looked for the stop
 * afterwards; the difference shows up exactly once, in the case where the lookup
 * fails, with an output already energised.
 *
 * (`pulse-unreleasable` jobs — the DSC/ASC solenoid latches — are not armed at
 * all. They actuate and stay, the SGBD offers no release, and pretending they
 * are "armed" would imply a STOP exists. Their row says so instead.)
 *
 * ## Disarming is unconditional
 *
 * `disarm` removes the entry whatever the ECU answered. If the stop frame went
 * out and the reply was a timeout, the truthful UI state is "we sent the stop
 * and do not know" — and the one thing it must not do is keep the row armed with
 * a STOP the operator has already pressed. Safety here is admitting the send
 * happened, not tracking a confirmation the link cannot give.
 */

export interface ArmedJob {
    /** The job that energised the output. */
    jobId: string;
    /** The job whose telegram ends it, and that frame. Resolved BEFORE arming. */
    stopJobId: string;
    stopHex: string;
    /** When it was armed. Rendered as an elapsed time; never used for logic. */
    at: number;
}

export type ArmedMap = ReadonlyMap<string, ArmedJob>;

export const NO_ARMED: ArmedMap = new Map();

export function arm(state: ArmedMap, entry: ArmedJob): ArmedMap {
    const next = new Map(state);
    next.set(entry.jobId, entry);
    return next;
}

export function disarm(state: ArmedMap, jobId: string): ArmedMap {
    if (!state.has(jobId)) return state;
    const next = new Map(state);
    next.delete(jobId);
    return next;
}

export function isArmed(state: ArmedMap, jobId: string): boolean {
    return state.has(jobId);
}

/**
 * Are this row's argument fields locked?
 *
 * DERIVED, never stored. The predecessor kept a `syncArgLock` that walked the
 * DOM and set `disabled` on inputs, which is a second copy of "is this armed"
 * that has to be re-synchronised on every path that changes the first. Here the
 * answer is the same expression the STOP button reads.
 */
export function argsLocked(state: ArmedMap, jobId: string): boolean {
    return isArmed(state, jobId);
}

/**
 * The stops to send, oldest first.
 *
 * Order is not cosmetic: several energised outputs are released in the order
 * they were engaged, so a later one cannot depend on an earlier one still being
 * on and be released into a state its start never saw.
 */
export function pendingStops(state: ArmedMap): ArmedJob[] {
    return [...state.values()].sort((a, b) => a.at - b.at);
}

/**
 * Is a STOP button ever allowed to be disabled? No.
 *
 * Written as a function so it can be asserted, and so the answer lives beside
 * the state rather than in a component's JSX. An armed output is a physical
 * thing that is on; every route to turning it off must stay pressable, including
 * while a write is in flight and including while the gate would refuse a start.
 */
export function stopIsPressable(state: ArmedMap, jobId: string): boolean {
    return isArmed(state, jobId);
}

/**
 * Why a frame was not sent, as a shape and not only a sentence: the link's last checks before the
 * bytes go (session.ts `preflight`, `preflightRun`, the permit check). A caller that shows the reason
 * to a person and hands it to an assistant (GREN BLUE SUITE's `maintenance_car_run`) maps this one
 * shape, so both are told the same thing with the values measured at that moment.
 *
 * The gate's own refusals (not practised, not this owner's decision, …) are not here: they come back
 * from `mayRun` / `mayActuate` as `{ allowed: false, reason }` before anything reaches the link.
 */
import type { Motion } from '../vehicleState.ts';

export type NotSentReason =
    /** The car's state could not be measured over the line (no answer, a refusal, a short block). */
    | 'link'
    /** The DME did not say 0 km/h. */
    | 'moving'
    /** The battery read under the minimum, or not at all. */
    | 'voltage'
    /** The engine was not as the job's own SGBD asks (stopped or running). */
    | 'engine'
    /** The permit does not cover these bytes, module or job. */
    | 'permission';

/** What was measured just before the decision; a field left out was not measured. */
export interface NotSentMeasured {
    motion?: Motion;
    speedKmh?: number | null;
    voltageV?: number | null;
    rpm?: number | null;
    /** What the job's SGBD asked of the engine. */
    engineWanted?: 'off' | 'run';
    /** The minimum battery voltage that lets a run go. */
    minVoltageV?: number;
}

export interface NotSent {
    reason: NotSentReason;
    /** The job (or what) that was not sent. */
    what: string;
    measured: NotSentMeasured;
    /** The same sentence `lastError()` holds. */
    message: string;
}

export class NotSentError extends Error {
    readonly notSent: NotSent;
    constructor(what: string, reason: NotSentReason, why: string, measured: NotSentMeasured = {}) {
        const message = `${what}: not sent — ${why}.`;
        super(message);
        this.name = 'NotSentError';
        this.notSent = { reason, what, measured, message };
    }
}

/** The shape of a refusal, or null when the error was something else (a failed exchange, a bug). */
export function notSentOf(e: unknown): NotSent | null {
    return e instanceof NotSentError ? e.notSent : null;
}

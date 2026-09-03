/**
 * How the ACTUATOR row is operated: one button, two buttons, or one with a
 * warning that there is no second one.
 *
 * The predecessor decided this by name — `DSC_SIM_*` was latching, and
 * `IO_STATUS_VORGEBEN` was a hold, because those strings were in the code. This
 * port has the same facts as DATA, with provenance, for all 1,524 jobs: the
 * SGBD said the DSC solenoids latch, and it said the pin drive holds. Deriving
 * the style from `op` means a job that gains a stop counterpart in the SGBD
 * gains a STOP button in the UI, with nobody editing a name list.
 *
 *   app-stop        the app must send the stop      -> hold
 *   companion-job   another job ends it             -> hold
 *   none            it latches; the SGBD has none   -> pulse-unreleasable
 *   self            the ECU ends it                 -> pulse
 *
 * `companion-job` is a hold and not a pulse even though the operator presses a
 * different job to end it: what matters to the row is whether something is left
 * running after the press, and it is. Which job to press is the STOP button's
 * business, and `stopJob` names it.
 */
import type { JobOperation } from './jobOps';

export type ExecStyle = 'pulse' | 'hold' | 'pulse-unreleasable';

export function execStyleOf(op: Pick<JobOperation, 'termination'>): ExecStyle {
    switch (op.termination) {
        case 'app-stop':
        case 'companion-job':
            return 'hold';
        case 'none':
            // It actuated and stayed. There is no stop, and the UI must not
            // offer one — a STOP that cannot work is worse than an absent one,
            // because the operator presses it and believes the thing stopped.
            return 'pulse-unreleasable';
        default:
            return 'pulse';
    }
}

// There is no `hasStopButton` here on purpose. `jobOps.hasStopControl` already
// answers that question off the same field, and a second function answering it
// off the style would be a second derivation of one fact. The test asserts the
// two agree over every shipped job rather than letting them drift.

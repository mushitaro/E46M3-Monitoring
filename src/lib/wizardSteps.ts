/**
 * The SMG II guided procedure, as a reducer.
 *
 * Four steps — PREREQ, SAFETY, RUN, RESULT — and one rule that matters more than
 * the rest: **while the gearbox is working, the only way out is ABORT.** A test
 * program runs for up to sixteen minutes with the clutch actuator energised, and
 * a stray Escape or a mis-aimed tap that dismissed the dialog would leave the
 * procedure running in the ECU with nothing on screen tracking it.
 *
 * The predecessor enforced that inside the modal's own event handlers
 * (`if (isRunning() || ctx?.busy) return;`), which is correct and unprovable —
 * it can only be exercised by dispatching a keydown at a live DOM. Here it is
 * `canDismiss(state)`, a function of the state, so the property is a test.
 *
 * ## Dismissing is aborting
 *
 * Every exit that is not "the procedure finished" marks the run aborted. There
 * is no quiet close: if the operator leaves, the RESULT step says ABORTED rather
 * than showing nothing, because "did that finish?" is the question they will
 * have, and a dialog that vanishes answers it wrongly by implying yes.
 */

export type WizardStep = 'prereq' | 'safety' | 'run' | 'result';

export const WIZARD_STEPS: readonly WizardStep[] = ['prereq', 'safety', 'run', 'result'];

export interface WizardState {
    step: WizardStep;
    /** Which acknowledgements have been ticked, by key. */
    ticked: ReadonlySet<string>;
    /** Set once the ECU has answered, or once the run was abandoned. */
    result: { ok: boolean; aborted: boolean } | null;
}

export interface WizardShape {
    /** Boxes the operator must tick before leaving PREREQ. */
    prereqChecks: readonly string[];
    /** Boxes required before leaving SAFETY. */
    safetyChecks: readonly string[];
}

export type WizardAction =
    | { type: 'toggle'; key: string }
    | { type: 'next' }
    | { type: 'back' }
    | { type: 'started' }
    | { type: 'finished'; ok: boolean }
    | { type: 'abort' }
    | { type: 'dismiss' };

export function initialWizard(): WizardState {
    return { step: 'prereq', ticked: new Set(), result: null };
}

/**
 * Is the procedure live in the ECU right now?
 *
 * RUN with no result. Everything below keys off this rather than off the step
 * alone, because RUN with a result is the moment between the ECU answering and
 * the view moving on, and the dialog is dismissible again there.
 */
export function isRunning(s: WizardState): boolean {
    return s.step === 'run' && s.result === null;
}

/** Escape, a backdrop, a tab change: may this dialog go away? */
export function canDismiss(s: WizardState): boolean {
    return !isRunning(s);
}

/** May the operator move on from where they are? */
export function canAdvance(s: WizardState, shape: WizardShape): boolean {
    if (s.step === 'prereq') return shape.prereqChecks.every((k) => s.ticked.has(k));
    if (s.step === 'safety') return shape.safetyChecks.every((k) => s.ticked.has(k));
    // RUN advances when the ECU answers, not when anyone presses anything.
    return false;
}

/** May they go back? Not once the ECU is working. */
export function canGoBack(s: WizardState): boolean {
    return s.step === 'safety';
}

export function wizardReducer(s: WizardState, a: WizardAction, shape: WizardShape): WizardState {
    switch (a.type) {
        case 'toggle': {
            // Ticks are frozen while the ECU works. Nothing on RUN is a decision
            // any more, and a box that still moves invites the belief that it does.
            if (isRunning(s)) return s;
            const ticked = new Set(s.ticked);
            if (ticked.has(a.key)) ticked.delete(a.key);
            else ticked.add(a.key);
            return { ...s, ticked };
        }
        case 'next': {
            if (!canAdvance(s, shape)) return s;
            return { ...s, step: s.step === 'prereq' ? 'safety' : 'run' };
        }
        case 'back':
            return canGoBack(s) ? { ...s, step: 'prereq' } : s;
        case 'started':
            return s.step === 'safety' ? { ...s, step: 'run', result: null } : s;
        case 'finished':
            // Only a live run can be finished. A late answer arriving after an
            // abort must not overwrite ABORTED with DONE.
            return isRunning(s) ? { ...s, step: 'result', result: { ok: a.ok, aborted: false } } : s;
        case 'abort':
            return isRunning(s) ? { step: 'result', ticked: s.ticked, result: { ok: false, aborted: true } } : s;
        case 'dismiss':
            // Leaving is aborting. If the run was live this is refused outright
            // (ABORT is the only exit); anywhere else it records that the
            // operator left rather than that the procedure completed.
            if (isRunning(s)) return s;
            if (s.result) return s;
            return { ...s, step: 'result', result: { ok: false, aborted: true } };
        default:
            return s;
    }
}

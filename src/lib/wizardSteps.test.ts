import { describe, expect, it } from 'vitest';
import {
    canAdvance,
    canDismiss,
    canGoBack,
    initialWizard,
    isRunning,
    wizardReducer,
    type WizardAction,
    type WizardShape,
    type WizardState,
} from './wizardSteps';

const SHAPE: WizardShape = {
    prereqChecks: ['engine_warm', 'battery'],
    safetyChecks: ['nobody_near'],
};

const run = (s: WizardState, ...as: WizardAction[]) =>
    as.reduce((acc, a) => wizardReducer(acc, a, SHAPE), s);

const tickAll = (s: WizardState, keys: readonly string[]) =>
    run(s, ...keys.map((key) => ({ type: 'toggle', key }) as WizardAction));

/** Walk to the RUN step with the gearbox working. */
function running(): WizardState {
    let s = initialWizard();
    s = tickAll(s, SHAPE.prereqChecks);
    s = run(s, { type: 'next' });
    s = tickAll(s, SHAPE.safetyChecks);
    s = run(s, { type: 'next' });
    return s;
}

describe('while the gearbox is working there is exactly one way out', () => {
    it('cannot be dismissed', () => {
        // The property the predecessor could only enforce inside a DOM keydown
        // handler. A test program runs for up to sixteen minutes with the clutch
        // actuator energised; a stray Escape would leave it running in the ECU
        // with nothing on screen tracking it.
        const s = running();
        expect(isRunning(s)).toBe(true);
        expect(canDismiss(s)).toBe(false);
        expect(run(s, { type: 'dismiss' })).toBe(s);
    });

    it('cannot go back, and cannot be advanced by pressing anything', () => {
        const s = running();
        expect(canGoBack(s)).toBe(false);
        expect(canAdvance(s, SHAPE)).toBe(false);
        expect(run(s, { type: 'back' })).toBe(s);
        expect(run(s, { type: 'next' })).toBe(s);
    });

    it('freezes the tick boxes', () => {
        // Nothing on this step is a decision any more, and a box that still
        // moves invites the belief that it is.
        const s = running();
        expect(run(s, { type: 'toggle', key: 'nobody_near' })).toBe(s);
    });

    it('ABORT works, and lands on a result that says so', () => {
        const s = run(running(), { type: 'abort' });
        expect(s.step).toBe('result');
        expect(s.result).toEqual({ ok: false, aborted: true });
        expect(canDismiss(s)).toBe(true);
    });
});

describe('a late answer cannot overwrite an abort', () => {
    it('keeps ABORTED when the ECU replies afterwards', () => {
        const aborted = run(running(), { type: 'abort' });
        const late = run(aborted, { type: 'finished', ok: true });
        expect(late.result).toEqual({ ok: false, aborted: true });
    });

    it('records a real completion when the run was still live', () => {
        const done = run(running(), { type: 'finished', ok: true });
        expect(done.step).toBe('result');
        expect(done.result).toEqual({ ok: true, aborted: false });
    });
});

describe('leaving before the run is leaving, and it says so', () => {
    it('marks a dismissal from PREREQ as aborted rather than closing quietly', () => {
        // "Did that finish?" is the question the operator will have, and a
        // dialog that simply vanishes answers it wrongly by implying yes.
        const s = run(initialWizard(), { type: 'dismiss' });
        expect(s.step).toBe('result');
        expect(s.result).toEqual({ ok: false, aborted: true });
    });

    it('does not re-abort a finished run', () => {
        const done = run(running(), { type: 'finished', ok: true });
        expect(run(done, { type: 'dismiss' })).toBe(done);
    });
});

describe('the gates between steps', () => {
    it('will not leave PREREQ until every box is ticked', () => {
        let s = initialWizard();
        expect(canAdvance(s, SHAPE)).toBe(false);
        expect(run(s, { type: 'next' }).step).toBe('prereq');

        s = run(s, { type: 'toggle', key: 'engine_warm' });
        expect(canAdvance(s, SHAPE)).toBe(false);

        s = run(s, { type: 'toggle', key: 'battery' });
        expect(canAdvance(s, SHAPE)).toBe(true);
        expect(run(s, { type: 'next' }).step).toBe('safety');
    });

    it('will not leave SAFETY until its own box is ticked', () => {
        let s = tickAll(initialWizard(), SHAPE.prereqChecks);
        s = run(s, { type: 'next' });
        expect(run(s, { type: 'next' }).step).toBe('safety');
        s = run(s, { type: 'toggle', key: 'nobody_near' }, { type: 'next' });
        expect(s.step).toBe('run');
    });

    it('lets SAFETY go back, and un-ticking there locks the way forward again', () => {
        let s = tickAll(initialWizard(), SHAPE.prereqChecks);
        s = run(s, { type: 'next' });
        expect(canGoBack(s)).toBe(true);
        s = run(s, { type: 'back' });
        expect(s.step).toBe('prereq');
        s = run(s, { type: 'toggle', key: 'battery' }); // un-tick
        expect(canAdvance(s, SHAPE)).toBe(false);
    });

    it('takes no shortcut: a procedure with no boxes still walks all four steps', () => {
        const none: WizardShape = { prereqChecks: [], safetyChecks: [] };
        let s = initialWizard();
        expect(canDismiss(s)).toBe(true);
        s = wizardReducer(s, { type: 'next' }, none);
        expect(s.step).toBe('safety');
        s = wizardReducer(s, { type: 'next' }, none);
        expect(s.step).toBe('run');
        expect(canDismiss(s)).toBe(false);
    });
});

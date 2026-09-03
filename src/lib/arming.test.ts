import { describe, expect, it } from 'vitest';
import {
    NO_ARMED,
    arm,
    argsLocked,
    disarm,
    isArmed,
    pendingStops,
    stopIsPressable,
    type ArmedJob,
} from './arming';

const entry = (jobId: string, at: number, stopJobId = `${jobId}_AUS`): ArmedJob => ({
    jobId,
    stopJobId,
    stopHex: '12 04 0c 1a',
    at,
});

describe('arming', () => {
    it('starts empty and stays empty when nothing is armed', () => {
        expect(NO_ARMED.size).toBe(0);
        expect(isArmed(NO_ARMED, 'STEUERN_EKP')).toBe(false);
        expect(pendingStops(NO_ARMED)).toEqual([]);
    });

    it('carries the stop with the entry, so an armed job always has one', () => {
        // The type makes this unavoidable rather than remembered: there is no
        // shape of ArmedJob without a stopJobId and a frame to send.
        const s = arm(NO_ARMED, entry('STEUERN_EKP', 1));
        expect(s.get('STEUERN_EKP')!.stopJobId).toBe('STEUERN_EKP_AUS');
        expect(s.get('STEUERN_EKP')!.stopHex).toBeTruthy();
    });

    it('does not mutate the map it was given', () => {
        const before = arm(NO_ARMED, entry('A', 1));
        const after = arm(before, entry('B', 2));
        expect(before.size).toBe(1);
        expect(after.size).toBe(2);
        expect(disarm(after, 'A').size).toBe(1);
        expect(after.size).toBe(2);
    });

    it('returns the same map when disarming something that is not armed', () => {
        // Identity, so a React consumer does not re-render on a no-op.
        const s = arm(NO_ARMED, entry('A', 1));
        expect(disarm(s, 'B')).toBe(s);
    });

    it('re-arming replaces the entry rather than stacking two', () => {
        const s = arm(arm(NO_ARMED, entry('A', 1)), entry('A', 2));
        expect(s.size).toBe(1);
        expect(s.get('A')!.at).toBe(2);
    });
});

describe('the argument lock is the same fact as the STOP button', () => {
    it('locks a row exactly while it is armed', () => {
        const s = arm(NO_ARMED, entry('A', 1));
        expect(argsLocked(s, 'A')).toBe(true);
        expect(argsLocked(s, 'B')).toBe(false);
        expect(argsLocked(disarm(s, 'A'), 'A')).toBe(false);
    });

    it('never disagrees with isArmed, for any sequence of arms and disarms', () => {
        // The predecessor kept the lock as DOM state that had to be re-synced on
        // every path. Two copies of one fact is one missed path from a row whose
        // fields are editable while its output is energised.
        let s = NO_ARMED;
        const ids = ['A', 'B', 'C'];
        const ops: Array<[string, 'arm' | 'disarm']> = [
            ['A', 'arm'], ['B', 'arm'], ['A', 'disarm'], ['C', 'arm'],
            ['B', 'disarm'], ['A', 'arm'], ['C', 'disarm'], ['A', 'disarm'],
        ];
        for (const [id, op] of ops) {
            s = op === 'arm' ? arm(s, entry(id, 1)) : disarm(s, id);
            for (const x of ids) {
                expect(argsLocked(s, x)).toBe(isArmed(s, x));
                expect(stopIsPressable(s, x)).toBe(isArmed(s, x));
            }
        }
        expect(s.size).toBe(0);
    });
});

describe('a STOP is pressable whenever its output is on', () => {
    it('is true while armed and false otherwise — there is no third answer', () => {
        const s = arm(NO_ARMED, entry('A', 1));
        expect(stopIsPressable(s, 'A')).toBe(true);
        expect(stopIsPressable(s, 'B')).toBe(false);
    });

    it('takes no argument that could ever disable it', () => {
        // The signature is the guarantee. There is no `busy`, no verdict and no
        // mode to thread in, so no future edit can make a STOP conditional on
        // one without changing this line and this test.
        expect(stopIsPressable.length).toBe(2);
    });
});

describe('stopping everything', () => {
    it('releases oldest first', () => {
        // Not cosmetic: outputs come off in the order they went on, so a later
        // one is never released into a state its start never saw.
        let s = NO_ARMED;
        s = arm(s, entry('THIRD', 300));
        s = arm(s, entry('FIRST', 100));
        s = arm(s, entry('SECOND', 200));
        expect(pendingStops(s).map((e) => e.jobId)).toEqual(['FIRST', 'SECOND', 'THIRD']);
    });

    it('gives every pending stop a frame to send', () => {
        let s = NO_ARMED;
        s = arm(s, entry('A', 1));
        s = arm(s, entry('B', 2));
        for (const e of pendingStops(s)) {
            expect(e.stopHex).toBeTruthy();
            expect(e.stopJobId).toBeTruthy();
        }
    });
});

import { describe, expect, it } from 'vitest';
import { ADOPT_AFTER_DISCONNECTED_MS, shouldAdoptBuild, updateHold } from './adoptBuild';

const base = { waiting: true, linkState: 'disconnected', disconnectedSince: 0, now: ADOPT_AFTER_DISCONNECTED_MS, unsaved: false, updating: false };

describe('a new build is taken only when nothing is lost', () => {
    it('swaps once the link has been down a while and nothing is unsaved', () => {
        expect(shouldAdoptBuild(base)).toBe(true);
    });

    it('never while the link is up — connected, busy, recording or running PROBE', () => {
        for (const linkState of ['connected', 'connecting', 'busy', 'logging']) {
            expect(shouldAdoptBuild({ ...base, linkState }), linkState).toBe(false);
        }
    });

    it('not for a cable that blinks: the link must have been down long enough', () => {
        expect(shouldAdoptBuild({ ...base, now: ADOPT_AFTER_DISCONNECTED_MS - 1 })).toBe(false);
        expect(shouldAdoptBuild({ ...base, disconnectedSince: null })).toBe(false);
    });

    it('not while something on the screen is unsaved, nor with nothing waiting, nor twice', () => {
        expect(shouldAdoptBuild({ ...base, unsaved: true })).toBe(false);
        expect(shouldAdoptBuild({ ...base, waiting: false })).toBe(false);
        expect(shouldAdoptBuild({ ...base, updating: true })).toBe(false);
    });
});

describe('what still holds a waiting build', () => {
    it('is the cable while the link is up, whatever is unsaved', () => {
        expect(updateHold({ linkState: 'connected', unsaved: true })).toBe('link');
        expect(updateHold({ linkState: 'logging', unsaved: false })).toBe('link');
    });

    it('is the unsaved session once the cable is let go: it does not go by itself then', () => {
        expect(updateHold({ linkState: 'disconnected', unsaved: true })).toBe('unsaved');
        expect(shouldAdoptBuild({ waiting: true, linkState: 'disconnected', disconnectedSince: 0, now: ADOPT_AFTER_DISCONNECTED_MS * 10, unsaved: true, updating: false })).toBe(false);
    });

    it('is only the idle minute when nothing else holds it', () => {
        expect(updateHold({ linkState: 'disconnected', unsaved: false })).toBe('minute');
    });
});

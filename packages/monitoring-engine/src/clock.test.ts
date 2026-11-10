import { afterEach, describe, expect, it } from 'vitest';
import { appNow, isAnchored, learnServerTime, onAnchor, resetClock } from './clock';

afterEach(resetClock);

describe('the app clock', () => {
    it('only goes forward', () => {
        const a = appNow();
        const b = appNow();
        expect(b).toBeGreaterThanOrEqual(a);
    });

    it('takes the server time when the device is years off, and not for a few seconds', () => {
        const now = appNow();
        expect(learnServerTime(new Date(now + 5_000).toUTCString(), now, now)).toBe(0);
        const server = Date.UTC(2026, 10, 4, 9, 0, 0);
        const step = learnServerTime(new Date(server).toUTCString(), now, now);
        expect(Math.abs(step)).toBeGreaterThan(60_000);
        expect(Math.abs(appNow() - (server + 500))).toBeLessThan(2_000);
    });

    it('says once, when it first hears the server, how far it stepped', () => {
        const steps: number[] = [];
        const off = onAnchor((s) => steps.push(s));
        expect(isAnchored()).toBe(false);
        const now = appNow();
        learnServerTime(new Date(now).toUTCString(), now, now);
        learnServerTime(new Date(now + 20 * 365 * 86_400_000).toUTCString(), now, now);
        off();
        expect(isAnchored()).toBe(true);
        expect(steps).toEqual([0]);
    });

    it('ignores a missing or broken header', () => {
        expect(learnServerTime(null, 0, 0)).toBe(0);
        expect(learnServerTime('not a date', 0, 0)).toBe(0);
    });
});

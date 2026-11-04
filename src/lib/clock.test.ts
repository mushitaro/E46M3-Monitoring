import { afterEach, describe, expect, it } from 'vitest';
import { appNow, learnServerTime, resetClock } from './clock';

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

    it('ignores a missing or broken header', () => {
        expect(learnServerTime(null, 0, 0)).toBe(0);
        expect(learnServerTime('not a date', 0, 0)).toBe(0);
    });
});

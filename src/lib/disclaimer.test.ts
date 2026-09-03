import { describe, expect, it } from 'vitest';
import { DISCLAIMER_VERSION, isAcknowledged } from './disclaimer';

describe('isAcknowledged', () => {
    it('has not been agreed to when nothing is stored', () => {
        expect(isAcknowledged(null)).toBe(false);
    });

    it('accepts the version it was shown', () => {
        expect(isAcknowledged('3', 3)).toBe(true);
    });

    it('re-asks when the text has moved on', () => {
        // The whole point of storing a version rather than a boolean: a
        // statement that got STRONGER because we learned something is exactly
        // the edit that must not go unread.
        expect(isAcknowledged('1', 2)).toBe(false);
    });

    it('does not re-ask someone who has already seen a later build', () => {
        // Downgrading, or a stale tab. They have agreed to something at least as
        // strong; asking again would be asking them to agree to less.
        expect(isAcknowledged('5', 2)).toBe(true);
    });

    it('treats junk as not agreed', () => {
        for (const junk of ['', 'yes', 'true', '1.5', 'NaN', ' ']) {
            expect(isAcknowledged(junk, 1), junk).toBe(false);
        }
    });

    it('ships a whole-number version', () => {
        expect(Number.isInteger(DISCLAIMER_VERSION)).toBe(true);
        expect(DISCLAIMER_VERSION).toBeGreaterThan(0);
    });
});

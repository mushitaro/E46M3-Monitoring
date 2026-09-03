import { describe, expect, it } from 'vitest';
import { normCode } from './faultCode';

describe('normCode', () => {
    it('makes the two spellings of one code meet', () => {
        expect(normCode('0x2A')).toBe(normCode(' 0x2a '));
    });

    it('does not uppercase the x — the bug this function exists for', () => {
        // `"0x2A".toUpperCase()` is `"0X2A"`. A table keyed that way misses
        // EVERY code while each individual lookup looks perfectly reasonable,
        // which is why this is pinned rather than remembered.
        expect(normCode('0x2A')).not.toBe('0X2A');
        expect(normCode('0x2A')).toBe('0x2a');
    });

    it('leaves a code that is already normal alone', () => {
        expect(normCode('0x2a')).toBe('0x2a');
    });
});

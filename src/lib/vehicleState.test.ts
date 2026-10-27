import { describe, expect, it } from 'vitest';
import { VEHICLE_STATE_MAX_AGE_MS, motionOf, vehicleStateFrom } from './vehicleState';

const at = 1_000_000;
const state = (speedKmh: number | null, speedCanKmh: number | null) => ({ speedKmh, speedCanKmh, rpm: null, voltageV: null, at });

describe('whether the car is standing still', () => {
    it('is parked only when every speed that answered reads zero', () => {
        expect(motionOf(state(0, 0), at)).toBe('parked');
        expect(motionOf(state(0, null), at)).toBe('parked');
        expect(motionOf(state(null, 0), at)).toBe('parked');
    });

    it('is moving when either source reads above zero — a disagreement reads as the unsafe side', () => {
        expect(motionOf(state(0, 0.0625), at)).toBe('moving');
        expect(motionOf(state(3, 0), at)).toBe('moving');
    });

    it('is unknown with no reading, no speed in it, or a stale one — never parked by default', () => {
        expect(motionOf(null, at)).toBe('unknown');
        expect(motionOf(state(null, null), at)).toBe('unknown');
        expect(motionOf(state(0, 0), at + VEHICLE_STATE_MAX_AGE_MS + 1)).toBe('unknown');
        // A clock that went backwards is not evidence either.
        expect(motionOf(state(0, 0), at - 1)).toBe('unknown');
        expect(motionOf(state(NaN, null), at)).toBe('unknown');
    });
});

describe('a state from live-block values', () => {
    it('takes speed from block 19 and the rest from block 3', () => {
        expect(vehicleStateFrom({ '19:v': 0, '19:v_asc': 0, '3:n': 880, '3:ub': 13.6 }, at)).toEqual({
            speedKmh: 0,
            speedCanKmh: 0,
            rpm: 880,
            voltageV: 13.6,
            at,
        });
    });

    it('is no state at all without a speed — block 3 alone cannot say the car is still', () => {
        expect(vehicleStateFrom({ '3:n': 0, '3:ub': 12.4 }, at)).toBeNull();
    });

    it('keeps the last engine speed and voltage when only block 19 was read', () => {
        const prior = { speedKmh: 0, speedCanKmh: 0, rpm: 900, voltageV: 13.9, at: at - 100 };
        expect(vehicleStateFrom({ '19:v': 0, '19:v_asc': null }, at, prior)).toMatchObject({ rpm: 900, voltageV: 13.9, speedCanKmh: null });
    });
});

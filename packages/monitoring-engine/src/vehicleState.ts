/**
 * Is the car standing still? Measured, never ticked.
 *
 * The preconditions used to be the operator's checkboxes (PLAN §4-4): "stationary" was whatever
 * the person tapped. The app can read the answer, so it does. Speed comes from the MSS54's live
 * block 19 — `v`, the speed input wired to the DME, and `v_asc`, the speed DSC sends on CAN —
 * the same frame TUNER reads on the car every eighth sample. Engine speed and supply voltage come
 * from block 3 when that has been read too.
 *
 * Three answers, and the third is the important one. A reading that is missing, undecodable or
 * older than `VEHICLE_STATE_MAX_AGE_MS` is `unknown`, and unknown is treated as moving by every
 * gate that asks: a null is a question nobody answered, not a zero (PLAN §4-5b).
 */

export type Motion = 'parked' | 'moving' | 'unknown';

export interface VehicleState {
    /** `19:v`, km/h. Null when not read or not decodable. */
    speedKmh: number | null;
    /** `19:v_asc`, km/h, from DSC over CAN. */
    speedCanKmh: number | null;
    /** `3:n`, rpm. */
    rpm: number | null;
    /** `3:ub`, V. */
    voltageV: number | null;
    /** `Date.now()` when the speed was read. */
    at: number;
}

/** A reading older than this says nothing about now. */
export const VEHICLE_STATE_MAX_AGE_MS = 5000;

/**
 * The CAN speed (`v_asc`) is a 1/16 km/h count, and a car standing still has been recorded
 * reading 9 counts (0.5625 km/h) on it while the direct input `v` read 0. One km/h is the floor
 * below which the CAN figure is not taken as motion — and only when `v` itself answered 0; with
 * no direct speed the CAN figure alone must be exactly zero, as before.
 */
export const CAN_SPEED_FLOOR_KMH = 1;

/**
 * Parked means BOTH speed sources that answered say zero, and at least one answered.
 *
 * Either one above zero is moving (CAN below `CAN_SPEED_FLOOR_KMH` excepted, see there): on a car whose wheel-speed input and CAN speed disagree, the
 * disagreement is itself a fault worth finding, and the safe reading of it is the moving one.
 */
export function motionOf(s: VehicleState | null, now: number): Motion {
    if (!s || now - s.at > VEHICLE_STATE_MAX_AGE_MS || now < s.at) return 'unknown';
    const speeds = [s.speedKmh, s.speedCanKmh].filter((v): v is number => v !== null && Number.isFinite(v));
    if (speeds.length === 0) return 'unknown';
    if (s.speedKmh === 0 && s.speedCanKmh !== null && Number.isFinite(s.speedCanKmh)) {
        return s.speedCanKmh < CAN_SPEED_FLOOR_KMH ? 'parked' : 'moving';
    }
    return speeds.every((v) => v === 0) ? 'parked' : 'moving';
}

/** The decoded values of one or more live blocks, keyed `selection:symbol`. */
export type LiveValues = Partial<Record<string, number | null>>;

/** A state from live-block values, or null when no speed was among them. */
export function vehicleStateFrom(values: LiveValues, at: number, prior: VehicleState | null = null): VehicleState | null {
    const num = (k: string) => {
        const v = values[k];
        return typeof v === 'number' && Number.isFinite(v) ? v : null;
    };
    const speedKmh = num('19:v');
    const speedCanKmh = num('19:v_asc');
    if (speedKmh === null && speedCanKmh === null) return null;
    return {
        speedKmh,
        speedCanKmh,
        rpm: num('3:n') ?? prior?.rpm ?? null,
        voltageV: num('3:ub') ?? prior?.voltageV ?? null,
        at,
    };
}

/**
 * The car PRACTICE stands in for: which modules answer, what each holds in its fault memory, and
 * how fast the car is going. One object, read by the simulated responders every time they answer.
 *
 * The defaults are a late E46 M3 with SMG II and navigation, parked, with the DME holding its two
 * stored faults and every other module clean. Nothing in the app changes them; the end-to-end
 * scenarios do, through the test hook a test build alone carries (lib/e2e.ts), to put the car the
 * scenario needs behind the real transport and link — a fault in the DSC, a drive at 40 km/h.
 *
 * It models state, as practiceEcu.ts does: a module that is not fitted is not on the bus and does
 * not answer, so silence in a scan means what it means on a car.
 */

export interface PracticeFault {
    code: number;
    /** The record's type byte (MSS54: which condition it is). */
    type: number;
    frequency: number;
}

export interface PracticeCar {
    /** Road speed the DME reports (blocks' km/h fields). 0 = parked. */
    speedKmh: number;
    /** The DME's stored faults, encoded as the MSS54 records them. */
    dmeFaults: PracticeFault[];
    /** Addresses of the modules fitted besides the DME. */
    fitted: number[];
    /** Raw fault-read answers by address, for modules the app does not decode. Absent = clean. */
    moduleFaults: Record<number, number[]>;
}

/** Late E46 M3, SMG II, navigation, RDC: the modules such a car carries (index addresses). */
export const PRACTICE_FITTED: readonly number[] = [
    0x32, // SMG II
    0x56, // DSC (late cars; early ones have ASC MK20 at the same address)
    0x57, // steering angle LWS5
    0x70, // tyre pressure RDC
    0xa4, // airbag MRS
    0x44, // immobiliser EWS
    0x00, // body GM5
    0x80, // instrument cluster
    0xd0, // light switch centre
    0x50, // multifunction wheel
    0xe8, // rain sensor
    0x5b, // climate IHKA
    0x60, // park distance control
    0x68, // radio
    0xf0, // on-board monitor
    0x7f, // navigation computer
];

/** "No fault stored": a count byte of zero, the shape most DS2 bodies answer with. */
export const CLEAN = [0x00];

function defaults(): PracticeCar {
    return {
        speedKmh: 0,
        dmeFaults: [
            { code: 0x2a, type: 0x08, frequency: 3 },
            { code: 0xd1, type: 0x02, frequency: 1 },
        ],
        fitted: [...PRACTICE_FITTED],
        moduleFaults: {},
    };
}

/** The one car PRACTICE answers as. Mutated in place, so a responder built before a change sees it. */
export const practiceCar: PracticeCar = defaults();

/** Back to the defaults: the start of every scenario. */
export function resetPracticeCar(): void {
    Object.assign(practiceCar, defaults());
}

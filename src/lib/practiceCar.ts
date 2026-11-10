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

/**
 * What a module says to the common IDENT (`<addr> 04 00`), as far as the group files read it: the
 * hardware number and the diagnosis index (lib/variants). The rest of the answer is synthetic.
 *
 * `data`: the answer's data as it is, for a module whose IDENT is not laid out as text — the
 * instrument cluster's is BCD (`kombiIdentData`).
 */
export type PracticeIdent =
    | {
          /** Two characters: the answer's bytes 10..11. */
          hw: string;
          /** Two characters: the answer's bytes 14..15. */
          diag: string;
      }
    | { data: readonly number[] };

/**
 * The instrument cluster's IDENT data, laid out as KOMBI46's and KOMBI46R's own IDENT jobs read it:
 * the part number in BCD (bytes 3..6), then hardware number, coding index and diagnosis index, one
 * BCD byte each (7, 8, 9), the bus index, the week and year, and the rest. D_0080 chooses by the
 * diagnosis index read as a number: 48–53 KOMBI46, 54–64 KOMBI46R. The part number is no real one.
 */
export function kombiIdentData(diagIndex: number): number[] {
    return [0x09, 0x99, 0x99, 0x99, 0x01, 0x00, diagIndex, 0x00, 0x12, 0x03, 0x00, 0x00, 0x00];
}

/**
 * The late E46 M3's: MSS54 (`1B`/`90`, D_0012 → MSS54DS0), SMG II (`2F`, D_0032 → SMG2) and the
 * late cluster (diagnosis index 0x60, D_0080 → KOMBI46R).
 */
export const M3_IDENTS: Readonly<Record<number, PracticeIdent>> = {
    0x12: { hw: '1B', diag: '90' },
    0x32: { hw: '2F', diag: '00' },
    0x80: { data: kombiIdentData(0x60) },
};

/**
 * A DS2 E46 that is not an M3: MS43 (`19`/`10`, D_0012 → MS430DS0), the GS20 automatic (`29`,
 * D_0032 → GS20) and the early cluster (0x50, D_0080 → KOMBI46): the same cluster family as an M3's.
 */
export const NON_M3_IDENTS: Readonly<Record<number, PracticeIdent>> = {
    0x12: { hw: '19', diag: '10' },
    0x32: { hw: '29', diag: '00' },
    0x80: { data: kombiIdentData(0x50) },
};

/** The part number every practice module answers with: seven digits no group file lists. */
export const PRACTICE_PART_NUMBER = '9999999';

/**
 * The data of a DS2 IDENT answer, laid out as the group files read it: part number (7 characters),
 * hardware number (2), coding index (2), diagnosis index (2), bus index (2), the date (4, unknown
 * here), and the rest. 42 bytes, as the MSS54's own answer on the car is.
 */
export function ds2IdentData(ident: PracticeIdent): number[] {
    if ('data' in ident) return [...ident.data];
    const text = PRACTICE_PART_NUMBER + ident.hw + '00' + ident.diag + '60';
    return [...Array.from(text, (c) => c.charCodeAt(0)), 0xff, 0xff, 0xff, 0xff, ...Array.from('00001158520401', (c) => c.charCodeAt(0)), ...new Array(9).fill(0xff)];
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
    /** The line has gone quiet: no module answers, not even the echo (a cable pulled, a K-line dropped). */
    lineDown: boolean;
    /**
     * The DSC MK60 (KWP2000-shaped frames on the DS2 line, wire address 0xB8; lib/kwpOnDs2): its
     * stored codes, two bytes each, with their status byte. Null: not fitted, and nothing answers.
     */
    dscMk60: { code: number; status: number }[] | null;
    /**
     * What each address answers to its IDENT, where it matters (lib/variants). An address not listed
     * answers with `00`/`00`, which no group rule maps to anything this app carries.
     */
    idents: Record<number, PracticeIdent>;
    /**
     * What the instrument cluster answers to its VIN read (AIF block 2, `80 05 02 02`; lib/clusterVin):
     * the VIN's last seven, two letters and five digits. Made up. Null: it refuses the read.
     */
    clusterVin: string | null;
    /** How many times the cluster has been asked for it: the scan's "once", seen from the car. */
    clusterVinReads: number;
}

/** The practice car's VIN, last seven: made up, and no car's. */
export const PRACTICE_VIN_SHORT = 'JR12345';

/**
 * The cluster's answer to AIF block 2, as the SGBD reads it (lib/clusterVin): the block number, two
 * characters, then the five digits in BCD, padded with a zero nibble the SGBD drops.
 */
export function clusterVinAnswer(short: string): number[] {
    const digits = `${short.slice(2)}0`;
    return [0x02, short.charCodeAt(0), short.charCodeAt(1), ...[0, 2, 4].map((i) => parseInt(digits.slice(i, i + 2), 16))];
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
        lineDown: false,
        // The owner's car (2026-11-10): a MK60 with one code stored. Its layout is ISO 14230's, which is
        // what the app reads it as; the real one has not answered yet.
        dscMk60: [{ code: 0x5d90, status: 0x24 }],
        idents: { ...M3_IDENTS },
        clusterVin: PRACTICE_VIN_SHORT,
        clusterVinReads: 0,
    };
}

/** The one car PRACTICE answers as. Mutated in place, so a responder built before a change sees it. */
export const practiceCar: PracticeCar = defaults();

/** Back to the defaults: the start of every scenario. */
export function resetPracticeCar(): void {
    Object.assign(practiceCar, defaults());
}

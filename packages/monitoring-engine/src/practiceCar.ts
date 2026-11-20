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
    /** Whether the engine runs (idles when parked). The battery and engine preflight read it. */
    engineRunning: boolean;
    /** A battery voltage to report instead of the alternator's or the battery's at rest. Null: as the engine says. */
    batteryV: number | null;
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
     * A DME that is an MS43 (a non-M3 E46; the IDENT is `idents[0x12]`): its fault memory, answered in the
     * MS43's own layout (fault-layouts.json `ms430ds0`: the count in the quick test, then 10-byte records —
     * code, type bits with 0x40 "present now", frequency). Null: the DME answers as the M3's MSS54.
     */
    ms43Faults: { code: number; present: boolean; count: number }[] | null;
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
    /**
     * Every frame the practice car heard, in order (practiceEcu's port), so a test judges what was sent
     * on the wire rather than what the app says it sent. Kept to the last 20,000.
     */
    wire: PracticeWireFrame[];
    /** Answers to give instead of the car's own, frame by frame: a refusal, silence, a short or late answer. */
    inject: PracticeInjection[];
    /** A drive the car follows: speed, rpm, pedal, gear and the cams over time. Null: parked or `speedKmh`. */
    drive: PracticeDrive | null;
}

/** One frame as the practice car heard it. */
export interface PracticeWireFrame {
    /** Date.now() when it arrived. */
    at: number;
    /** The module it was addressed to (0xB8: the DSC MK60's KWP frames). */
    to: number;
    /** The frame, hex bytes with spaces, checksum included. */
    hex: string;
}

/**
 * An answer the practice car gives in place of its own, for frames that match: the module, and if given
 * the control byte (DS2) or service (KWP) and the first payload bytes. `skip` lets that many matches
 * through first; `times` (default 1) is how many it then takes.
 *
 *   - `negative`: the module refuses (DS2 status 0xA2, KWP 7F <sid> 22);
 *   - `silent`: the echo, and no answer;
 *   - `short`: an answer of one byte;
 *   - `busy`: the module says busy (DS2 0xA1);
 *   - `slow`: the module's own answer, `delayMs` late.
 */
export interface PracticeInjection {
    to: number;
    ctrl?: number;
    /** Hex of the payload's first bytes, spaces allowed. */
    data?: string;
    kind: 'negative' | 'silent' | 'short' | 'busy' | 'slow';
    times?: number;
    skip?: number;
    delayMs?: number;
}

/** A point of a drive. Values between points are interpolated; a missing value keeps the last one. */
export interface PracticeDrivePoint {
    /** Seconds from the drive's start. */
    t: number;
    gear?: number;
    kmh?: number;
    rpm?: number;
    /** Pedal, %. */
    pedal?: number;
    /** Intake and exhaust VANOS, target and actual, °CRK. */
    inSoll?: number;
    inIst?: number;
    exSoll?: number;
    exIst?: number;
}

export interface PracticeDrive {
    points: PracticeDrivePoint[];
    /** Date.now() at its start; set by the car the first time it is read when absent. */
    startedAt?: number;
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

/**
 * "No fault stored" where a module's own FS_LESEN reads more than the count byte, so a clean module
 * reads as clean and not as an answer cut short. Found by running each SGBD's own job on the answer
 * (lib/sgbd/faultRead): ZKE5 (and ZKE5_S12) read two bytes from `04 00`; ASCMK20 and DSC_E46, which
 * share 0x56, read a seven-byte record from `04 01`. All zeros: no entry, in their own reading.
 */
export const CLEAN_BY_ADDRESS: Readonly<Record<number, readonly number[]>> = {
    0x00: [0x00, 0x00],
    0x56: [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
};

/** What a module answers to its fault read when nothing is stored (the practice car's `moduleFaults` absent). */
export const cleanAnswer = (address: number): readonly number[] => CLEAN_BY_ADDRESS[address] ?? CLEAN;

function defaults(): PracticeCar {
    return {
        speedKmh: 0,
        engineRunning: true,
        batteryV: null,
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
        ms43Faults: null,
        idents: { ...M3_IDENTS },
        clusterVin: PRACTICE_VIN_SHORT,
        clusterVinReads: 0,
        wire: [],
        inject: [],
        drive: null,
    };
}

/** The one car PRACTICE answers as. Mutated in place, so a responder built before a change sees it. */
export const practiceCar: PracticeCar = defaults();

/** Back to the defaults: the start of every scenario. */
export function resetPracticeCar(): void {
    Object.assign(practiceCar, defaults());
}

/** Where a drive is now: every value interpolated between its points. Null when there is no drive. */
export function driveNow(now = Date.now()): Required<Omit<PracticeDrivePoint, 't'>> | null {
    const d = practiceCar.drive;
    if (!d || d.points.length === 0) return null;
    d.startedAt ??= now;
    const t = (now - d.startedAt) / 1000;
    const keys = ['gear', 'kmh', 'rpm', 'pedal', 'inSoll', 'inIst', 'exSoll', 'exIst'] as const;
    const out = { gear: 0, kmh: 0, rpm: 820, pedal: 0, inSoll: 0, inIst: 0, exSoll: 0, exIst: 0 };
    for (const k of keys) {
        const has = d.points.filter((p) => p[k] !== undefined);
        if (!has.length) continue;
        const after = has.findIndex((p) => p.t >= t);
        if (after === -1) out[k] = has[has.length - 1][k]!;
        else if (after === 0) out[k] = has[0][k]!;
        else {
            const a = has[after - 1];
            const b = has[after];
            // A gear steps; everything else moves smoothly.
            out[k] = k === 'gear' ? a[k]! : a[k]! + ((b[k]! - a[k]!) * (t - a.t)) / (b.t - a.t || 1);
        }
    }
    return out;
}

/** The speed the car reports now: its drive's, or `speedKmh`. */
export function practiceSpeed(): number {
    return driveNow()?.kmh ?? practiceCar.speedKmh;
}

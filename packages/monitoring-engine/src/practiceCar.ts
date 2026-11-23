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

/**
 * An E46 318i with the M43 (DS2): BMS46 (`61`/`10`, D_0012 → BMS46DS0) and the early cluster (0x50,
 * D_0080 → KOMBI46). Its gearbox is left out: what a 318i's 0x32 answers is not known here, so it answers
 * the `00`/`00` nothing maps.
 */
export const BMS46_IDENTS: Readonly<Record<number, PracticeIdent>> = {
    0x12: { hw: '61', diag: '10' },
    0x80: { data: kombiIdentData(0x50) },
};

/**
 * Where a DME that is not the MSS54 keeps one fault record in its fault-read answer (`12 05 04 01`): the
 * record's length, the code's and the frequency's offsets, and the "present now" bit — as its own SGBD's
 * FS_LESEN reads them (fault-layouts.json; practiceDme.test.ts holds this table to it). The answer is one
 * byte, then the records; the quick test's first byte (`12 05 04 00`) is their count.
 */
export const PRACTICE_DME_RECORDS: Readonly<Record<string, { length: number; code: number; frequency: number; present: { at: number; mask: number } }>> = {
    ms430ds0: { length: 10, code: 0, frequency: 2, present: { at: 1, mask: 0x40 } },
    bms46ds0: { length: 19, code: 0, frequency: 2, present: { at: 1, mask: 0x40 } },
    bms46ds1: { length: 20, code: 0, frequency: 3, present: { at: 1, mask: 0x40 } },
};

/**
 * Which of `PRACTICE_DME_RECORDS` a DME's IDENT selects, as D_0012 chooses (practiceDme.test.ts runs the
 * group's own rule on the same answer): `19` MS43, `61` BMS46 (`61A7` its DS1). Null: none of these.
 */
export function practiceDmeOf(ident: PracticeIdent | undefined): string | null {
    if (!ident || 'data' in ident) return null;
    const hw = ident.hw.toUpperCase();
    if (hw === '19') return 'ms430ds0';
    if (hw === '61') return ident.diag.toUpperCase() === 'A7' ? 'bms46ds1' : 'bms46ds0';
    return null;
}

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
     * SMG II's STATUS_IO_LESEN answer (0x32, `0B 03`), otherwise 128 zero bytes: the hydraulic
     * pressure SMG II reports (`phydBar`, bytes 50-51 as its own SGBD reads them, about 0.12 bar a step,
     * an unsigned word; see `smg2PhydBytes`), and any other byte by offset. Null: every byte zero,
     * which the SGBD's own code reads as 65524 bar (−12 as an unsigned word).
     */
    smg2Status: { phydBar?: number; bytes?: Record<number, number> } | null;
    /**
     * A DME that is not the MSS54 (a non-M3 E46: MS43, BMS46; the IDENT is `idents[0x12]`): its fault
     * memory, answered in the layout of the DME that IDENT selects (`practiceDmeOf`, `PRACTICE_DME_RECORDS`:
     * the count in the quick test, then records with the code, 0x40 "present now", the frequency). Null: the
     * DME answers as the M3's MSS54.
     */
    nonM3DmeFaults: { code: number; present: boolean; count: number }[] | null;
    /**
     * @deprecated The name `nonM3DmeFaults` had before the BMS46 joined it (scenarios written for the MS43,
     * GREN BLUE SUITE's among them). Read only where `nonM3DmeFaults` is null; a clear empties both.
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
    /**
     * What a sick S54 shows in the MSS54's live values (practice values, set by a scenario; nothing a
     * car said). Null: a healthy engine. See `PracticeSymptoms`.
     */
    symptoms: PracticeSymptoms | null;
    /**
     * The MSS54's learned values (adaptation blocks 6, 22, 38, 54 and 195), by the field's symbol
     * (`laa_offset1`, `lu_adapt[2]`, `auss_sum_adap[4]` …), in the field's own unit. A symbol not
     * listed reads as the zero of its own scale, which nobody can take for a car's. ADAPT_LOESCHEN
     * (`43 FF 00`) empties it, as the job says it does.
     */
    mss54Adapt: Record<string, number>;
    /** How many times the DME has been told to clear all its learned values (`43 FF 00`). */
    mss54AdaptClears: number;
    /**
     * SMG II's learned values: the answer to ADAPTIONSWERTE_LESEN (`40 <n>`), byte by offset, for each of
     * the job's three groups — 0 the clutch's adaptations, 1 the gearbox's, 2 the gearbox data (its
     * counters). A byte not listed is zero. Which byte its own code reads as which value: `SMG2_ADAPT_BYTES`.
     */
    smg2Adapt: Record<Smg2AdaptGroup, Record<number, number>>;
    /**
     * What SMG II learns when one of its test programs finishes (TESTPRG_STARTEN, by program number):
     * the bytes it then holds, by group. Set by a scenario — PRACTICE does not know what a real clutch or
     * gearbox would learn, so a program absent here changes nothing.
     */
    smg2Relearn: Record<number, Partial<Record<Smg2AdaptGroup, Record<number, number>>>>;
    /** Each ADAPTIONSWERTE_LOESCHEN SMG II was sent, by its argument (0 clutch curve, 1 gearbox data), in order. */
    smg2AdaptClears: number[];
    /** The test programs SMG II ran to their end, by program number, in order. */
    smg2ProgramsFinished: number[];
}

/** ADAPTIONSWERTE_LESEN's argument: 0 clutch adaptations, 1 gearbox adaptations, 2 gearbox data. */
export type Smg2AdaptGroup = 0 | 1 | 2;

/**
 * Where SMG II's own ADAPTIONSWERTE_LESEN code reads some of its values in each group's answer (found by
 * running that code on answers with one byte set; practiceSmg2Adapt.test.ts pins them). Big-endian words
 * where a value takes two bytes. Not every value: the rest are reached by offset.
 */
export const SMG2_ADAPT_BYTES = {
    /**
     * Clutch: the touch point, one byte (`KUPPL_SCHLEIF_PKT_WERT` as it is; in increments,
     * `KUPPL_SCHLEIF_PKT_INK_WERT`, about 2.56 a step with the disengaged position's byte added: 99 reads 97).
     */
    touchPoint: { group: 0, offset: 0 },
    /** Clutch: the valve's zero current, mA at 2 a step from 1002. */
    valveZeroCurrent: { group: 0, offset: 1 },
    /** Clutch: engaged and disengaged positions, increments at 2 a step from 830 and 400. */
    engagedPosition: { group: 0, offset: 3 },
    /** (A signed byte: 200 reads 288.) */
    disengagedPosition: { group: 0, offset: 4 },
    /** Clutch: how many times it was overloaded. */
    overloads: { group: 0, offset: 6 },
    /** Gearbox: the select-angle current offset (`OFF_I_WW_WERT`, mA), a word. */
    selectCurrentOffset: { group: 1, offset: 2 },
    /** Gearbox: shift-travel neutral position (`POS_SW_N_WERT`), a word. */
    shiftNeutral: { group: 1, offset: 14 },
    /** Gearbox data: race starts (`ANZ_RENNSTART_WERT`), one byte. */
    raceStarts: { group: 2, offset: 0 },
} as const;

/**
 * The clutch group as ADAPTIONSWERTE_LOESCHEN(0) leaves it: "Kupplungswerte werden auf Defaultwerte
 * zurueckgesetzt", and these are the bytes SMG II's own code reads as the defaults its own comments give
 * (touch point 97 increments, valve zero current 1002 mA, positions 830 and 400, overlap 0).
 */
export const SMG2_CLUTCH_DEFAULT_BYTES: Readonly<Record<number, number>> = { 0: 99 };

/**
 * ADAPTIONSWERTE_LOESCHEN, as its own SGBD says it works: argument 0 puts the clutch values back to their
 * defaults; argument 1 sets the gearbox data ("Getriebedaten", the name ADAPTIONSWERTE_LESEN gives its
 * group 2) to zero. The gearbox's adaptations (group 1) are not named by either, so they stay.
 */
export function clearPracticeSmg2Adaptations(arg: number): void {
    practiceCar.smg2AdaptClears.push(arg);
    if (arg === 0) practiceCar.smg2Adapt[0] = { ...SMG2_CLUTCH_DEFAULT_BYTES };
    else if (arg === 1) practiceCar.smg2Adapt[2] = {};
}

/** A test program ran to its end: SMG II now holds what the scenario says that program teaches it. */
export function finishPracticeSmg2Program(program: number): void {
    practiceCar.smg2ProgramsFinished.push(program);
    const learnt = practiceCar.smg2Relearn[program];
    if (!learnt) return;
    for (const g of [0, 1, 2] as const) if (learnt[g]) practiceCar.smg2Adapt[g] = { ...practiceCar.smg2Adapt[g], ...learnt[g] };
}

/** SMG II's answer to ADAPTIONSWERTE_LESEN for one group, `length` bytes long. */
export function practiceSmg2AdaptAnswer(group: number, length: number): Uint8Array {
    const out = new Uint8Array(length);
    const bytes = practiceCar.smg2Adapt[group as Smg2AdaptGroup] ?? {};
    for (const [k, v] of Object.entries(bytes)) if (Number(k) < length) out[Number(k)] = v & 0xff;
    return out;
}

/**
 * The symptoms the practice car's MSS54 shows, so a diagnosis can be practised end to end: a datalog that
 * shows the fault, a read of the learned values, a repair (a part, a calibration or a test), and a datalog
 * after it that shows the fault gone. Every value goes through the field's own scale, as the rest of
 * PRACTICE does, so what the app shows is what its decoder made of the bytes.
 */
export interface PracticeSymptoms {
    /** How far the idle swings either side, rpm (a healthy one: about 15). */
    idleRpmSwing?: number;
    /** The lambda controllers' factors, bank 1 and bank 2 (`la_f_regler1/2`, block 19). 1 = no correction. */
    lambdaFactor?: [number, number];
    /**
     * Rough running, cylinder 1 to 6 in the physical order, % (`ll_abw1..6` at idle, block 21; `lu[0..5]`,
     * block 179). A healthy cylinder: about 0.
     */
    roughness?: number[];
    /**
     * Misfires this driving cycle, cylinder 1 to 6 (`auss_sum_dc[0..5]`, adaptation block 22). They add to
     * the lifetime counters (`auss_sum_adap[0..5]`) unless `mss54Adapt` says otherwise.
     */
    misfires?: number[];
    /**
     * The cause is a learned value gone wrong, not a part: clearing the learned values (ADAPT_LOESCHEN)
     * cures it, and the next datalog reads healthy. False or absent: a part, which a clear does not cure.
     */
    curedByAdaptClear?: boolean;
}

/** The six cylinders' values of a symptom, a missing one as `healthy`. */
export function perCylinder(values: readonly number[] | undefined, healthy: number): number[] {
    return Array.from({ length: 6 }, (_, i) => values?.[i] ?? healthy);
}

/**
 * The value the practice car's MSS54 holds for one learned value: `mss54Adapt`'s, else the misfire counters
 * the symptoms imply, else null (the zero of its own scale).
 */
export function practiceAdaptation(symbol: string): number | null {
    const set = practiceCar.mss54Adapt[symbol];
    if (typeof set === 'number') return set;
    const m = /^auss_sum_(dc|adap)\[(\d)\]$/.exec(symbol);
    const misfires = practiceCar.symptoms?.misfires;
    if (m && misfires) return misfires[Number(m[2])] ?? null;
    return null;
}

/** ADAPT_LOESCHEN: every learned value back to its zero, and a symptom a learned value caused, gone. */
export function clearPracticeAdaptations(): void {
    practiceCar.mss54Adapt = {};
    practiceCar.mss54AdaptClears++;
    if (practiceCar.symptoms?.curedByAdaptClear) practiceCar.symptoms = null;
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
        // A pressure a working SMG II holds (its accumulator: roughly 40-80 bar), stated as practice's,
        // so a reading of it is not the zero answer's 65524 bar.
        smg2Status: { phydBar: 60 },
        nonM3DmeFaults: null,
        ms43Faults: null,
        idents: { ...M3_IDENTS },
        clusterVin: PRACTICE_VIN_SHORT,
        clusterVinReads: 0,
        wire: [],
        inject: [],
        drive: null,
        symptoms: null,
        mss54Adapt: {},
        mss54AdaptClears: 0,
        smg2Adapt: { 0: {}, 1: {}, 2: {} },
        smg2Relearn: {},
        smg2AdaptClears: [],
        smg2ProgramsFinished: [],
    };
}

/**
 * Two bytes (50-51 of STATUS_IO_LESEN's answer) SMG II's own SGBD reads as about `bar`. Its code turns
 * the big-endian word into bar at 0.12 bar a step, 0 bar at about 100 and truncating (found by running
 * that code on chosen words; sgbd/results.test.ts pins it within a bar). A practice value, not a model
 * of the sensor.
 */
export function smg2PhydBytes(bar: number): [number, number] {
    const raw = Math.max(0, Math.min(0xffff, Math.ceil((bar + 13) / 0.12)));
    return [raw >> 8, raw & 0xff];
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

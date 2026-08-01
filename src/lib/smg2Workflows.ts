'use client';

/**
 * SMG II guided procedures — the one place in this app where the ECU runs a
 * multi-step process by itself and tells you what it is doing.
 *
 * MSS54 and DSC expose actuators: you drive an output and watch. SMG II exposes
 * TEST PROGRAMS. You start one, the gearbox controller works for up to sixteen
 * minutes, and it reports back on two separate channels:
 *
 *   testStatus — the coarse state: condition not met / running / completed /
 *                did not end properly.
 *   activity   — WHAT it is doing right now, from a per-procedure vocabulary.
 *                Complete gearbox adaptation has 21 of these.
 *   fault      — the outcome, from a per-procedure vocabulary. Complete gearbox
 *                adaptation has 38 distinct result codes.
 *
 * Those vocabularies are why this file exists. A progress bar without them says
 * "62%"; with them it says "learning 3rd gear engagement point" and, at the end,
 * "slave-cylinder minimum stroke not reached" instead of a bare 0x01. That is
 * the difference between a tool you can act on and a tool you have to guess at.
 *
 * Extracted from the SGBD by tools/gen_smg2_workflows.py. The SEQUENCES are the
 * one thing here that is NOT from the SGBD — the tables define no order — and
 * the data says so in its own `note` field, which the UI reproduces rather than
 * quietly presenting a recommendation as a specification.
 */

export interface Bilingual {
    de?: string;
    ja: string;
    en: string;
}

/** A code the ECU reports, with what it means. */
export interface CodedText {
    code: string;
    de?: string;
    ja: string;
    en: string;
}

export interface Smg2Procedure {
    /** The TESTPRG_NR value. */
    id: string;
    testprg: string;
    cat: string;
    name: Bilingual;
    desc: { ja: string; en: string };
    durTyp: string;
    durMax: string;
    durMaxSec: number | null;
    /** Whether the engine must be running or stopped. */
    engine: 'off' | 'run' | string;
    /** True when TESTPRG_STOP must precede the start — the SGBD's own rule. */
    needsPrepare: boolean;
    /** True when TESTPRG_STARTEN's AUSWAHLBYTE selects something (e.g. which gear). */
    auswahl: boolean;
    /** Which result block to read when it finishes, if any. */
    readResults: string | null;
    risk: string;
    prereq: Array<{ ja: string; en: string }>;
    /** The progress vocabulary: what the ECU says it is doing. */
    activity: CodedText[];
    /** The outcome vocabulary: what the ECU says happened. */
    faults: CodedText[];
}

export interface Smg2Sequence {
    id: string;
    name: { ja: string; en: string };
    /** Why this order, and how much authority it has. Always shown. */
    note: { ja: string; en: string };
    /** testprg ids, in order. */
    steps: string[];
}

export interface Smg2Actuator {
    id: string;
    /** The STELLGL pin value. */
    pin: string;
    ja: string;
    en: string;
}

export interface Smg2Workflows {
    module: string;
    sgbd: string;
    address: number;
    source?: unknown;
    safety?: unknown;
    categories: Array<{ key: string; ja: string; en: string }>;
    actuators: Smg2Actuator[];
    /** The coarse state vocabulary, shared by every procedure. */
    testStatus: CodedText[];
    procedures: Smg2Procedure[];
    sequences: Smg2Sequence[];
}

let cached: Smg2Workflows | null | undefined;

/**
 * Returns null when the file is absent, rather than throwing. Only SMG II has
 * one; the calibration view asks for every module and must not break on the two
 * that legitimately have nothing to give.
 */
export async function loadSmg2Workflows(): Promise<Smg2Workflows | null> {
    if (cached !== undefined) return cached;
    try {
        const res = await fetch('./ecu-data/smg2-workflows.json', { cache: 'no-store' });
        cached = res.ok ? ((await res.json()) as Smg2Workflows) : null;
    } catch {
        cached = null;
    }
    return cached;
}

/** Look up a coded report. Unknown codes are reported AS unknown, never hidden. */
export function decodeCode(table: CodedText[], code: string): CodedText | null {
    const want = code.toLowerCase();
    return table.find((c) => c.code.toLowerCase() === want) ?? null;
}

export function procedureById(w: Smg2Workflows | null, id: string): Smg2Procedure | null {
    return w?.procedures.find((p) => p.id === id) ?? null;
}

/**
 * The wire protocol for running one, from the SGBD's own comments:
 *
 *   TESTPRG_STOP           "Must be sent BEFORE TESTPRG_STARTEN! (ECU timeout: 10s!)"
 *   TESTPRG_STARTEN(nr, auswahl)
 *   STATUS_TESTPRG         polled — testStatus + activity + fault
 *   TESTPRG_STOP           to abort (the fault vocabulary has 0x7F "aborted by user")
 *
 * The keep-alive is not optional: the ECU's diagnostic timeout is 10 s, and a
 * procedure can legitimately run for 960. Stop feeding it and the gearbox
 * controller drops the session mid-adaptation.
 */
export const SMG2_PROCEDURE_PROTOCOL: ReadonlyArray<{ job: string; why: string }> = [
    { job: 'TESTPRG_STOP', why: 'the SGBD requires it: "Must be sent BEFORE TESTPRG_STARTEN!"' },
    { job: 'TESTPRG_STARTEN', why: 'starts the program (TESTPRG_NR, and AUSWAHLBYTE where it takes a selection)' },
    { job: 'STATUS_TESTPRG', why: 'polled for testStatus, the activity code, and finally the result code' },
    { job: 'DIAGNOSE_ERHALTEN', why: 'keeps the session alive — the ECU timeout is 10 s and a run can last 960' },
];

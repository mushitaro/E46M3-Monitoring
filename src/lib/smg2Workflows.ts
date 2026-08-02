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
    /**
     * Which adaptation block holds what this procedure wrote, if any.
     *
     * `null` OR ABSENT — the generator omits the key rather than emitting null on
     * six of the fourteen. `readResultsNote` then says why, per procedure, because
     * the reasons differ: 0x0C writes nothing at all, 0x04 returns its measurement
     * inline, 0x08 writes an offset that is in neither block.
     */
    readResults?: string | null;
    readResultsNote?: { ja: string; en: string };
    /** A fact about this procedure the SGBD tables do not carry. */
    note?: { ja: string; en: string };
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

/**
 * Which adaptation block each `readResults` name means, and how to read it.
 *
 * This is the one line of glue the whole "show the values it recorded" feature
 * needed and did not have. The SGBD names the blocks (`clutch`, `gearbox`) and
 * names the job (`ADAPTIONSWERTE_LESEN`, argument `ADAPTION_LESEN` = 0 clutch /
 * 1 gearbox / 2 gearbox data) and never connects the two. Nothing in the app
 * connected them either, so the panel printed the literal string `gearbox` into
 * a readout and stopped there.
 *
 * `provenance: 'inferred'` because the SGBD does not state the mapping — it is
 * read off the result-name prefixes, and the UI says so.
 */
export const SMG2_RESULT_BLOCKS = {
    clutch: { job: 'ADAPTIONSWERTE_LESEN', arg: 'ADAPTION_LESEN', value: '0' },
    gearbox: { job: 'ADAPTIONSWERTE_LESEN', arg: 'ADAPTION_LESEN', value: '1' },
} as const;

export interface ResultBlockRef {
    job: string;
    arg: string;
    value: string;
    provenance: 'inferred';
}

/**
 * Where to read what this procedure wrote — or null, in which case the procedure
 * carries `readResultsNote` saying why, in its own words.
 */
export function readResultsFor(p: Smg2Procedure): ResultBlockRef | null {
    const key = p.readResults as keyof typeof SMG2_RESULT_BLOCKS | null | undefined;
    if (!key || !(key in SMG2_RESULT_BLOCKS)) return null;
    return { ...SMG2_RESULT_BLOCKS[key], provenance: 'inferred' };
}

/** Look up a coded report. Unknown codes are reported AS unknown, never hidden. */
export function decodeCode(table: CodedText[], code: string): CodedText | null {
    const want = code.toLowerCase();
    return table.find((c) => c.code.toLowerCase() === want) ?? null;
}

export function procedureById(w: Smg2Workflows | null, id: string): Smg2Procedure | null {
    return w?.procedures.find((p) => p.id === id) ?? null;
}

/*
 * The wire protocol for running a procedure lives in `jobOps.ts` — see
 * `PROCEDURE_OP` and `procedureOperation()`.
 *
 * A third copy of it used to sit here as `SMG2_PROCEDURE_PROTOCOL`, exported and
 * never imported by anything. It still named `STATUS_TESTPRG` and
 * `DIAGNOSE_ERHALTEN` long after both were shown not to exist, because nothing
 * read it and nothing tested it. Deleted rather than corrected: an unused copy
 * of a safety-relevant sequence is a place for the truth to rot.
 */

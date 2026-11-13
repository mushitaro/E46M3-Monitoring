'use client';

/**
 * A module's answer, read by its own SGBD job (lib/sgbd/vm): values with their names and units.
 *
 * `public/ecu-data/<id>.results.json` carries, for the jobs listed in `tools/gen_sgbd_results.py`,
 * the job's code and the tables it looks things up in. A job without an entry is shown as bytes, as
 * before. What comes back is labelled with where it came from: the SGBD's own reading, run here,
 * never checked against EDIABAS on this car until a recording says so.
 */

import { runSgbdJob, type SgbdResult, type SgbdTables } from './vm';

export interface SgbdResultsTable {
    module: string;
    sgbd: string;
    source: string;
    jobs: Record<string, { base: number; bytes: number; code: string; tables: string[] }>;
    tables: Record<string, string[][]>;
}

/** A numeric result with the unit its job names beside it (`…_WERT` with `…_EINH`). */
export interface ReadValue {
    name: string;
    value: number | string;
    unit: string | null;
}

export interface DecodedRead {
    /** Values, in the order the job reports them; units folded in, `JOB_STATUS` and the raw answer left out. */
    values: ReadValue[];
    /** The job's own verdict on the answer (`OKAY`, or why not). */
    status: string | null;
    /** Where the run stopped before its end, if it did: what it reported until then is kept. */
    stopped: { at: number; reason: string } | null;
    provenance: 'sgbd-job';
}

const cache = new Map<string, Promise<SgbdResultsTable | null>>();

export function loadSgbdResults(moduleId: string): Promise<SgbdResultsTable | null> {
    let hit = cache.get(moduleId);
    if (!hit) {
        hit = fetch(`./ecu-data/${moduleId}.results.json`, { cache: 'no-store' })
            .then((r) => (r.ok ? (r.json() as Promise<SgbdResultsTable>) : null))
            .catch(() => null);
        cache.set(moduleId, hit);
    }
    return hit;
}

const fromBase64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const bytesOf = (hex: string) => Uint8Array.from(hex.trim().split(/\s+/).filter(Boolean), (x) => parseInt(x, 16));

/**
 * The line's answer as the SGBD sees it: address, length, status, data, checksum. The app keeps the
 * address, the status and the data; the length and the checksum follow from them.
 */
export function answerFrame(address: number, status: number, payload: Uint8Array): Uint8Array {
    const out = new Uint8Array(payload.length + 4);
    out[0] = address;
    out[1] = out.length;
    out[2] = status;
    out.set(payload, 3);
    let x = 0;
    for (let i = 0; i < out.length - 1; i++) x ^= out[i];
    out[out.length - 1] = x;
    return out;
}

/** Folds `X_WERT` + `X_EINH` into one value with a unit; drops the bookkeeping results. */
export function foldResults(results: readonly SgbdResult[]): { values: ReadValue[]; status: string | null } {
    const units = new Map<string, string>();
    for (const r of results) if (r.name.endsWith('_EINH') && r.value.kind === 'text') units.set(r.name.slice(0, -5), r.value.value);
    const values: ReadValue[] = [];
    let status: string | null = null;
    for (const r of results) {
        if (r.name === 'JOB_STATUS' && r.value.kind === 'text') {
            status = r.value.value;
            continue;
        }
        if (r.name.startsWith('_') || r.name.endsWith('_EINH') || r.value.kind === 'bytes') continue;
        const stem = r.name.endsWith('_WERT') ? r.name.slice(0, -5) : null;
        values.push({ name: r.name, value: r.value.value as number | string, unit: (stem && units.get(stem)) || null });
    }
    return { values, status };
}

/**
 * Runs the job on the answer. Null when the table has no code for the job — the read stays bytes.
 * `request` is the frame sent (checksum included); the job checks it is the one it would send.
 */
export function decodeRead(table: SgbdResultsTable | null, jobId: string, request: string, answer: Uint8Array): DecodedRead | null {
    const job = table?.jobs[jobId];
    if (!table || !job) return null;
    const run = runSgbdJob(
        { code: fromBase64(job.code), base: job.base },
        { sent: bytesOf(request), answer, tables: table.tables as SgbdTables },
    );
    return { ...foldResults(run.results), stopped: run.stopped, provenance: 'sgbd-job' };
}

/** One fault-memory entry as the module's own FS_LESEN reports it: one result set. */
export interface SgbdFault {
    /** `F_ORT_NR`: the fault location's number in the module's own table. */
    code: number | null;
    /** `F_ORT_TEXT`, the SGBD's (German) text for the location; null when the job gave none. */
    text: string | null;
    /** `F_ARTn_TEXT` that the job filled (dashes and empties left out): what kind of fault, as the SGBD says. */
    kinds: string[];
    /** Everything else the set carries (frequency, conditions, `F_HFK`, …), folded with units. */
    values: ReadValue[];
}

export interface SgbdFaultRead {
    faults: SgbdFault[];
    /** The job's own verdict (`OKAY`, or why not). */
    status: string | null;
    /** Where the run stopped before its end: the entries read until then are kept, but the list may be short. */
    stopped: { at: number; reason: string } | null;
    provenance: 'sgbd-job';
}

const FAULT_KIND_TEXT = /^F_ART\d+_TEXT$/;

/**
 * A fault read, run through the module's own FS_LESEN: every page the app sent with the answer it
 * got, in order. Each result set that names a fault location (`F_ORT_NR`) is one entry; the job's
 * bookkeeping sets (the count, `JOB_STATUS`) are not. Null when the table has no code for the job.
 */
export function decodeFaultRead(
    table: SgbdResultsTable | null,
    exchanges: readonly { request: string; answer: Uint8Array }[],
    jobId = 'FS_LESEN',
): SgbdFaultRead | null {
    const job = table?.jobs[jobId];
    if (!table || !job || exchanges.length === 0) return null;
    const run = runSgbdJob(
        { code: fromBase64(job.code), base: job.base },
        { exchanges: exchanges.map((x) => ({ sent: bytesOf(x.request), answer: x.answer })), tables: table.tables as SgbdTables },
    );
    const sets = new Map<number, SgbdResult[]>();
    for (const r of run.results) sets.set(r.set, [...(sets.get(r.set) ?? []), r]);
    const faults: SgbdFault[] = [];
    let status: string | null = null;
    for (const rs of sets.values()) {
        const folded = foldResults(rs);
        status = folded.status ?? status;
        const at = (name: string) => folded.values.find((v) => v.name === name)?.value;
        const code = at('F_ORT_NR');
        if (code === undefined) continue;
        faults.push({
            code: typeof code === 'number' ? code : null,
            text: typeof at('F_ORT_TEXT') === 'string' ? (at('F_ORT_TEXT') as string) : null,
            kinds: folded.values
                .filter((v) => FAULT_KIND_TEXT.test(v.name) && typeof v.value === 'string' && !/^-*$/.test(v.value.trim()))
                .map((v) => v.value as string),
            values: folded.values.filter((v) => v.name !== 'F_ORT_NR' && v.name !== 'F_ORT_TEXT' && !FAULT_KIND_TEXT.test(v.name)),
        });
    }
    return { faults, status, stopped: run.stopped, provenance: 'sgbd-job' };
}

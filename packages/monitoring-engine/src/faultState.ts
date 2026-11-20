/**
 * Whether a stored fault is present now, in each module's own terms, and a scan as a saved session
 * keeps it.
 *
 * ## Present now, or stored only
 *
 * The owner's first question about a fault is whether it is there now or was once (U5). Each module
 * says so in its own way, and nothing here guesses past what it says:
 *
 *   - A module read by its own FS_LESEN (lib/sgbd/results) says it in its SGBD's words: `F_ARTn_TEXT`
 *     in a DS2 SGBD, `F_VORHANDEN_TEXT` in the MK60's — "Fehler momentan vorhanden" or "… momentan
 *     nicht vorhanden". Read from those words; any other wording is not known (null).
 *   - The MSS54, read by its own decoder, gives a type byte. Its SGBD (MSS54DS0, table FARTMATRIX) names
 *     the byte's bits A1..A8, low bit first: A1..A4 are `0001`..`1000` (the fault's kind), A6 "Fehler
 *     nach Entprellung abgespeichert", A7 "Fehler momentan vorhanden" / "… nicht vorhanden", A8
 *     "sporadischer" / "statischer Fehler". So present now is bit 6 (0x40) — the bit the other DS2 DMEs'
 *     own FS_LESEN reads as present too (fault-layouts.json: MS42, MS43, BMS46 at 0x40). Not yet seen on
 *     a car, and said so where it is shown (`MSS54_PRESENT_SOURCE`).
 */
import type { ErrorMemoryEntry } from '@tsunagi/ds2-mss54';
import { readCutShort, scanFaultCount, type ScanResult, type ScanRun } from './probe/scan.ts';

/** The MSS54 type byte's "present now" bit (FARTMATRIX A7, bit 6). */
export const MSS54_PRESENT_BIT = 0x40;
/** The MSS54 type byte's "sporadic" bit (FARTMATRIX A8, bit 7). */
export const MSS54_SPORADIC_BIT = 0x80;

/** Where the MSS54's present-now reading comes from, said beside it. */
export const MSS54_PRESENT_SOURCE =
    "MSS54DS0's own FARTMATRIX: bit 6 of the type byte is A7, 'Fehler momentan vorhanden'; the bit the other DS2 DMEs' FS_LESEN reads as present. Not yet confirmed on a car.";

/** Whether an MSS54 entry is present now (bit 6 of its type byte). */
export function mss54Present(errorType: number): boolean {
    return (errorType & MSS54_PRESENT_BIT) !== 0;
}

/** Whether an MSS54 entry is marked sporadic (bit 7 of its type byte). */
export function mss54Sporadic(errorType: number): boolean {
    return (errorType & MSS54_SPORADIC_BIT) !== 0;
}

/**
 * Present now or stored only, from the kind texts a module's own SGBD gave for the entry. Null when
 * none of them says (the SGBD reports no such kind, or words it otherwise).
 */
export function presentFromKinds(kinds: readonly string[]): boolean | null {
    for (const k of kinds) {
        const s = k.trim();
        if (/momentan\s+nicht\s+vorhanden|zur\s+Zeit\s+nicht\s+aktiv|^Fehler\s+nicht\s+(vorhanden|aktiv)$/i.test(s)) return false;
        if (/momentan\s+vorhanden|zur\s+Zeit\s+aktiv|aktuell\s+vorhanden|^Fehler\s+aktiv$/i.test(s)) return true;
    }
    return null;
}

/** A fault code as a module's catalogue spells it: `0x2A`, `0x5D8C`. */
export function hexCode(code: number): string {
    return `0x${code.toString(16).toUpperCase().padStart(code > 0xff ? 4 : 2, '0')}`;
}

/** One module of a scan, as a saved session keeps it: which module, how it went, and its faults. */
export interface SavedScanModule {
    address: string;
    /** The module its IDENT chose, or the one SGBD at the address; null where several stay possible (`?`). */
    module: string | null;
    outcome: ScanResult['outcome'];
    /** The codes as read, each with whether it is present now (null: not said). Null: nothing was read into the answer. */
    faults: Array<{ code: string; present: boolean | null }> | null;
    /** The read stopped part of the way: the list may be short. */
    cutShort?: true;
}

/**
 * A scan in a saved session: every module's faults, not only the module on the screen (SC02: the DSC's
 * two and the engine's one, kept before a clear). No bytes and no identity: the codes and how each
 * read went. Never the cluster's VIN read.
 */
export interface SavedScan {
    at: number;
    end: ScanRun['end'];
    modules: SavedScanModule[];
}

export function toSavedScan(run: ScanRun): SavedScan {
    return {
        at: run.endedAt,
        end: run.end,
        modules: run.results.map((r) => {
            const moduleId = r.variant?.moduleId ?? r.sgbdFaults?.module ?? (r.modules.length === 1 ? r.modules[0] : null);
            return {
                address: r.address,
                module: moduleId,
                outcome: r.outcome,
                faults: scanFaultCount(r) === null ? null : codesOf(r),
                ...(readCutShort(r) ? { cutShort: true as const } : {}),
            };
        }),
    };
}

function codesOf(r: ScanResult): Array<{ code: string; present: boolean | null }> {
    if (Array.isArray(r.decoded)) {
        return (r.decoded as ErrorMemoryEntry[]).map((e) => ({ code: hexCode(e.errorCode), present: mss54Present(e.errorType) }));
    }
    if (r.sgbdFaults) return r.sgbdFaults.faults.map((f) => ({ code: f.code === null ? '?' : hexCode(f.code), present: presentFromKinds(f.kinds) }));
    return (r.faults ?? []).map((f) => ({ code: f.code, present: f.present }));
}

/** How many faults a saved scan holds. */
export function savedScanFaults(s: SavedScan): number {
    return s.modules.reduce((n, m) => n + (m.faults?.length ?? 0), 0);
}

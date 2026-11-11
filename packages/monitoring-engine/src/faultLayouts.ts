/**
 * Reading a module's fault-read answer where the module's own SGBD reads it — for the modules the app
 * has no decoder of its own for (the MSS54 has one, in `@tsunagi/ds2-mss54`).
 *
 * The layouts are data: `fault-layouts.json`, written by `tools/sgbd/gen_fault_layouts.py`, which runs
 * each SGBD's own FS_LESEN in EdiabasLib's simulation, infers where the records sit, and writes a layout
 * only when EdiabasLib and the layout read random answers the same way (codes, order, frequencies, the
 * "present now" bit). So what is read here is what BMW's job reads from the same bytes. Whether a real
 * module answers with those bytes is another question: until one has, every fault decoded here is
 * `unverified` — the screen says so, and the intake report carries it (operator, 2026-11-11: KOMBI, DSC
 * and the DMEs first, "未検証" until a car).
 *
 * The bytes stay the answer. A decoded fault sits beside the raw read; it never replaces it.
 */
import { readEcuData } from './ecuData.ts';

export interface FaultLayout {
    sgbd: string;
    /** Where the number of records comes from: the quick test's first byte, the entries' first byte, or as many as fit. */
    count: 'quick' | 'entries' | 'fill';
    /** The first record's offset in the entries answer's payload. */
    start: number;
    /** Bytes per record. */
    length: number;
    /** The fault code's offset within a record (one byte, as the job's F_ORT_NR). */
    code: number;
    /** The frequency counter's offset within a record (F_HFK), or null where the job reports none from the bytes. */
    frequency: number | null;
    /** The counter is kept as its complement (`0xFF - byte`; DSC: `0x01` is 254 times). */
    frequencyInverted?: boolean;
    /** A record is an empty slot, and not a fault, when any of these bytes is zero (where nothing counts the records). */
    emptyIfZero?: number[];
    /** The bit that says "present now" (F_VORHANDEN, or the F_ART text "Fehler momentan vorhanden"); null where none was proved. */
    present: { at: number; mask: number } | null;
    /** The quick-test request (without checksum), when the count comes from it. */
    quick: string | null;
    /** The entries request (without checksum). */
    entries: string | null;
    /** Random answers on which EdiabasLib and this layout agreed. */
    checked: number;
}

export interface FaultLayouts {
    schema: 1;
    verifiedOnCar: boolean;
    modules: Record<string, FaultLayout>;
}

export const NO_FAULT_LAYOUTS: FaultLayouts = { schema: 1, verifiedOnCar: false, modules: {} };

/** One fault as the module's own job would report it. */
export interface DecodedFault {
    /** `0x2A`: the code as the module's fault-text table (FORTTEXTE) keys it. */
    code: string;
    count: number | null;
    /** Present now (true), stored (false), or not said by these bytes (null). */
    present: boolean | null;
}

/** Loaded once a page; anything missing or not understood is no layouts — nothing is decoded. */
export async function loadFaultLayouts(): Promise<FaultLayouts> {
    try {
        const res = await readEcuData('fault-layouts.json');
        if (!res.ok) return NO_FAULT_LAYOUTS;
        const data = (await res.json()) as FaultLayouts;
        return data?.schema === 1 && data.modules && typeof data.modules === 'object' ? data : NO_FAULT_LAYOUTS;
    } catch {
        return NO_FAULT_LAYOUTS;
    }
}

const bytesOf = (hex: string): number[] | null => {
    const compact = hex.replace(/\s+/g, '');
    if (compact.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(compact)) return null;
    return Array.from({ length: compact.length / 2 }, (_, i) => parseInt(compact.slice(i * 2, i * 2 + 2), 16));
};

/** Whether `request` (a whole frame as sent, checksum included) is the request `prefix` (no checksum) names. */
function isRequest(request: string, prefix: string | null): boolean {
    if (!prefix) return false;
    const r = bytesOf(request);
    const p = bytesOf(prefix);
    return !!r && !!p && r.length === p.length + 1 && p.every((b, i) => r[i] === b);
}

const hex2 = (n: number) => `0x${n.toString(16).toUpperCase().padStart(2, '0')}`;

/**
 * The faults in one fault read: the module's own frames as sent and the payloads that came back.
 * Null when the reads do not hold what the layout needs (no entries answer, or no quick test where the
 * count comes from it) — a partial read is not decoded.
 */
export function decodeFaultRead(layout: FaultLayout, reads: ReadonlyArray<{ request: string; response: string | null }>): DecodedFault[] | null {
    const entries = reads.find((r) => isRequest(r.request, layout.entries));
    const data = entries?.response != null ? bytesOf(entries.response) : null;
    if (!data) return null;
    let n: number;
    if (layout.count === 'quick') {
        const q = reads.find((r) => isRequest(r.request, layout.quick));
        const qb = q?.response != null ? bytesOf(q.response) : null;
        if (!qb || qb.length === 0) return null;
        n = qb[0];
    } else if (layout.count === 'entries') {
        n = data[0] ?? 0;
    } else {
        n = Math.max(0, Math.floor((data.length - layout.start) / layout.length));
    }
    const out: DecodedFault[] = [];
    for (let i = 0; i < n; i++) {
        const at = layout.start + i * layout.length;
        const rec = data.slice(at, at + layout.length);
        if (rec.length < layout.length) break;
        if ((layout.emptyIfZero ?? []).some((z) => rec[z] === 0)) continue;
        const f = layout.frequency;
        out.push({
            code: hex2(rec[layout.code]),
            count: f === null ? null : layout.frequencyInverted ? 0xff - rec[f] : rec[f],
            present: layout.present ? (rec[layout.present.at] & layout.present.mask) !== 0 : null,
        });
    }
    return out;
}

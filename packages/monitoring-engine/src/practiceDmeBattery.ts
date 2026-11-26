import { answerFrame, telemetryValues, type SgbdResultsTable } from './sgbd/results.ts';

/**
 * Where another E46's DME carries the battery in the block its own STATUS_UBATT reads, as that job's
 * own code reads it (sgbd/vm), so the practice car answers the battery-and-engine preflight
 * (link/session `preflightRun`, docs/NO-STOP.md §4 D3) the way such a DME would: the same way the fleet's
 * `rpm` rule places the engine speed. Learnt by running the job on probe answers, not written by hand.
 */
export interface PracticeBattery {
    /** The answer's data length the job reads to its end without running past it. */
    length: number;
    /** The bytes the voltage occupies, most significant first. */
    offsets: number[];
    /** volts = zero + scale × raw. */
    scale: number;
    zero: number;
}

const VOLTS = /^v$/i;

function volts(table: SgbdResultsTable, job: string, sent: string, data: Uint8Array): number | null {
    const v = telemetryValues(table, job, sent, answerFrame(0x12, 0xa0, data)).find((x) => VOLTS.test(x.unit ?? ''))?.value;
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** The rule, or null when the job does not read the battery from this block in a way probing can place. */
export function learnPracticeBattery(table: SgbdResultsTable, job: string, sent: string, base: Uint8Array, keep: readonly number[] = []): PracticeBattery | null {
    let data: Uint8Array | null = null;
    for (let length = Math.max(1, base.length); length <= 96 && !data; length++) {
        const d = new Uint8Array(length);
        d.set(base.subarray(0, length));
        if (volts(table, job, sent, d) !== null) data = d;
    }
    if (!data) return null;
    const at = (i: number, raw: number) => {
        const d = Uint8Array.from(data!);
        d[i] = raw;
        return volts(table, job, sent, d);
    };
    const v0 = volts(table, job, sent, data)!;
    const moves = [...data.keys()].filter((i) => !keep.includes(i) && (at(i, 0x40) !== v0 || at(i, 0x80) !== v0));
    if (moves.length < 1 || moves.length > 2) return null;
    // Two bytes: the one that moves the value more is the high byte.
    const offsets = moves.length === 2 && Math.abs((at(moves[1], 1) ?? 0) - v0) > Math.abs((at(moves[0], 1) ?? 0) - v0) ? [moves[1], moves[0]] : moves;
    const rule = (raw: number) => {
        const d = Uint8Array.from(data!);
        writeRaw(d, offsets, raw);
        return volts(table, job, sent, d);
    };
    const zero = rule(0);
    const one = rule(offsets.length === 2 ? 0x100 : 0x10);
    if (zero === null || one === null || one === zero) return null;
    const learned: PracticeBattery = { length: data.length, offsets, scale: (one - zero) / (offsets.length === 2 ? 0x100 : 0x10), zero };
    // Proved on the value the practice car parks with.
    const check = rule(rawFor(learned, 12.5));
    return check !== null && Math.abs(check - 12.5) < 0.5 ? learned : null;
}

function rawFor(rule: PracticeBattery, v: number): number {
    const max = 2 ** (8 * rule.offsets.length) - 1;
    return Math.min(max, Math.max(0, Math.round((v - rule.zero) / rule.scale)));
}

function writeRaw(d: Uint8Array, offsets: readonly number[], raw: number) {
    offsets.forEach((o, k) => (d[o] = (raw >> (8 * (offsets.length - 1 - k))) & 0xff));
}

/** The answer with the battery written where the DME's own job reads it (padded to the job's length). */
export function withPracticeBattery(rule: PracticeBattery, payload: Uint8Array, v: number): Uint8Array {
    const out = new Uint8Array(Math.max(rule.length, payload.length));
    out.set(payload);
    writeRaw(out, rule.offsets, rawFor(rule, v));
    return out;
}

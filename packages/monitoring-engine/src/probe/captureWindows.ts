import { MSS54_CHANNELS, type ChannelId } from '@tsunagi/ds2-mss54';
import { holds } from './criteria.ts';
import type { Clause } from './plan.ts';

/** The DME's own calculated gear (block 83), which the link reads beside a recording once a second. */
export const GEAR_CHANNEL = '83:gang' as ChannelId;
/** A gear read older than this is not this moment's gear. */
const GEAR_FRESH_S = 1.5;

interface Sample {
    time: number;
    values: Partial<Record<string, number | null>>;
}

/**
 * The same quantity from another block. Ten MSS54 quantities are in two blocks (`3:n` and `35:n` are
 * both the engine speed); a condition written on one holds on a sample that read the other.
 */
export function sameQuantity(channel: string): string[] {
    const m = /^(\d{1,3}):(.+)$/.exec(channel);
    if (!m) return [channel];
    const out = [channel];
    for (const [id, c] of MSS54_CHANNELS) if (id !== channel && c.field.symbol === m[2]) out.push(id);
    return out;
}

/** The gear the DME calculated at sample `i`: its last read at most 1.5 s before; null when none was. */
export function gearAt(samples: readonly Sample[], i: number): { value: number; readS: number } | null {
    const t = samples[i]?.time;
    if (t === undefined) return null;
    for (let k = i; k >= 0 && t - samples[k].time <= GEAR_FRESH_S; k--) {
        const g = samples[k].values[GEAR_CHANNEL];
        if (typeof g === 'number') return { value: g, readS: Math.round((t - samples[k].time) * 100) / 100 };
    }
    return null;
}

/** A sample's values with each condition's channel filled from the same quantity, and the gear as of then. */
function valuesFor(samples: readonly Sample[], i: number, clauses: readonly Clause[]): Record<string, number | null | undefined> {
    const v: Record<string, number | null | undefined> = { ...samples[i].values };
    for (const c of clauses) {
        if (typeof v[c.channel] === 'number') continue;
        if (c.channel === GEAR_CHANNEL) {
            v[c.channel] = gearAt(samples, i)?.value ?? null;
            continue;
        }
        for (const alt of sameQuantity(c.channel)) {
            if (typeof v[alt] === 'number') {
                v[c.channel] = v[alt];
                break;
            }
        }
    }
    return v;
}

/**
 * The stretches of the recording where every clause held, from `fromS` on: each `preS` before its first
 * sample and `postS` after its last, as a PROBE capture marks them. Two stretches closer than that join.
 */
export function captureWindows(samples: readonly Sample[], clauses: readonly Clause[], preS: number, postS: number, fromS = -Infinity, untilS = Infinity): Array<{ from: number; to: number; hit: number }> {
    const out: Array<{ from: number; to: number; hit: number }> = [];
    if (clauses.length === 0) return out;
    for (let i = 0; i < samples.length; i++) {
        const t = samples[i].time;
        if (t >= untilS) break;
        if (t < fromS || !holds(clauses, valuesFor(samples, i, clauses))) continue;
        const last = out[out.length - 1];
        if (last && t - preS <= last.to) last.to = Math.max(last.to, t + postS);
        else out.push({ from: Math.max(0, t - preS), to: t + postS, hit: t });
    }
    return out;
}

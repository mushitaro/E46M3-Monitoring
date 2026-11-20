/**
 * A DATALOG recording as one run in segments (operator's scenarios SC05, SC13, IJ24).
 *
 * A recording is one run from START to STOP. What it reads can change while it goes — the owner, or
 * the assistant on the owner's word, chooses other channels — and that is a segment boundary, not a
 * second recording: the time, the new channels, the blocks they cost and, once it has run a while,
 * the rate it got. A run is also cut every ten minutes (the journal's own ten minutes, `PART_S`): each
 * part is kept as an episode of its own, so a long drive is not one unkeepable lump.
 *
 * Pure: the shell holds the samples (views/datalog/useDatalog), the screen and the assistant read them
 * through these.
 */
import { MSS54_CHANNELS, type ChannelId } from '@tsunagi/ds2-mss54';
import { IDLE_MS, holds, type Clause } from '@tsunagi/monitoring-engine';

/** A recording is cut into parts this long (the journal's ten minutes: journal.ts `IDLE_MS`). */
export const PART_S = IDLE_MS / 1000;

/** The DME's own calculated gear (block 83), which the link reads beside a recording once a second. */
export const GEAR_CHANNEL = '83:gang' as ChannelId;
/** A gear read older than this is not this moment's gear. */
const GEAR_FRESH_S = 1.5;

export interface DatalogSegment {
    /** Seconds into the run it begins at. */
    from: number;
    /** `appNow()` when it began. */
    at: number;
    channels: ChannelId[];
    /** The DME's round trips per sample (its blocks). */
    blocks: number;
    /** Why it began: the run's start, other channels, or the ten-minute cut. */
    why: 'start' | 'channels' | 'part';
    /** Which ten-minute part of the run it is in, from 1. */
    part: number;
}

interface Sample {
    time: number;
    values: Partial<Record<string, number | null>>;
}

/** Each segment with what it got: its samples, seconds and effective rate. */
export function segmentStats(segments: readonly DatalogSegment[], samples: readonly Sample[]) {
    return segments.map((s, i) => {
        const to = segments[i + 1]?.from ?? Infinity;
        const own = samples.filter((x) => x.time >= s.from && x.time < to);
        const span = own.length > 1 ? own[own.length - 1].time - own[0].time : 0;
        return {
            ...s,
            samples: own.length,
            seconds: Math.round(span * 10) / 10,
            rateHz: span > 0 ? Math.round(((own.length - 1) / span) * 10) / 10 : null,
        };
    });
}

/** The channels of every segment, in the order they first appear: the columns the run recorded. */
export function channelsOf(segments: readonly DatalogSegment[]): ChannelId[] {
    const out: ChannelId[] = [];
    for (const s of segments) for (const c of s.channels) if (!out.includes(c)) out.push(c);
    return out;
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
export function captureWindows(samples: readonly Sample[], clauses: readonly Clause[], preS: number, postS: number, fromS = -Infinity): Array<{ from: number; to: number; hit: number }> {
    const out: Array<{ from: number; to: number; hit: number }> = [];
    if (clauses.length === 0) return out;
    for (let i = 0; i < samples.length; i++) {
        const t = samples[i].time;
        if (t < fromS || !holds(clauses, valuesFor(samples, i, clauses))) continue;
        const last = out[out.length - 1];
        if (last && t - preS <= last.to) last.to = Math.max(last.to, t + postS);
        else out.push({ from: Math.max(0, t - preS), to: t + postS, hit: t });
    }
    return out;
}

/** The sample nearest `t` seconds into the run; null for an empty run. */
export function nearestSample(samples: readonly Sample[], t: number): number | null {
    if (samples.length === 0) return null;
    let lo = 0;
    let hi = samples.length - 1;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (samples[mid].time < t) lo = mid + 1;
        else hi = mid;
    }
    if (lo > 0 && Math.abs(samples[lo - 1].time - t) <= Math.abs(samples[lo].time - t)) lo--;
    return lo;
}

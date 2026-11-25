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
import { type ChannelId } from '@tsunagi/ds2-mss54';
import { IDLE_MS } from '@tsunagi/monitoring-engine';

/** A recording is cut into parts this long (the journal's ten minutes: journal.ts `IDLE_MS`). */
export const PART_S = IDLE_MS / 1000;
export { captureWindows, gearAt, sameQuantity, GEAR_CHANNEL } from '@tsunagi/monitoring-engine';

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

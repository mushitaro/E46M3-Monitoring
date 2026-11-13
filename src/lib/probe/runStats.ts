/**
 * A run's spread, for the assistant (owner, 2026-11-13: 「今の最大最小ってどうなってんだろ」 had no
 * answer from the chat — the moment tool returns every channel's samples and a long run did not fit).
 * For the channels asked, over the whole run or the seconds asked: how many readings, min and max with
 * the run second each came at (the first, on a tie), and the mean. Absent channels were not read:
 * null, not zero.
 *
 * Pure: the bridge hands in the run's samples.
 */
import type { ProbeSample } from '@tsunagi/monitoring-engine';

export interface ChannelSpread {
    n: number;
    min: number;
    minAt: number;
    max: number;
    maxAt: number;
    mean: number;
}

const round = (v: number) => Math.round(v * 1000) / 1000;

export function runStats(
    samples: readonly ProbeSample[],
    channels: readonly string[],
    span: { from?: number; to?: number } = {},
): Record<string, ChannelSpread | null> {
    const from = span.from ?? -Infinity;
    const to = span.to ?? Infinity;
    const acc = new Map<string, { n: number; sum: number; min: number; minAt: number; max: number; maxAt: number }>();
    for (const s of samples) {
        if (s.t < from || s.t > to) continue;
        for (const c of channels) {
            const v = s.values[c];
            if (typeof v !== 'number' || !Number.isFinite(v)) continue;
            const x = acc.get(c);
            if (!x) {
                acc.set(c, { n: 1, sum: v, min: v, minAt: s.t, max: v, maxAt: s.t });
                continue;
            }
            x.n++;
            x.sum += v;
            if (v < x.min) [x.min, x.minAt] = [v, s.t];
            if (v > x.max) [x.max, x.maxAt] = [v, s.t];
        }
    }
    const out: Record<string, ChannelSpread | null> = {};
    for (const c of channels) {
        const x = acc.get(c);
        out[c] = x ? { n: x.n, min: round(x.min), minAt: round(x.minAt), max: round(x.max), maxAt: round(x.maxAt), mean: round(x.sum / x.n) } : null;
    }
    return out;
}

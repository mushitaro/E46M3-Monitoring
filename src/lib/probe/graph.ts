/**
 * The PROBE board's graph part (owner, 2026-11-09): what a driver takes in at a glance — the value
 * large, its colour from how far it is from its target, the last half minute of value and target as
 * lines, and beside it small the values that say what the car was doing.
 *
 * Pure: the view hands in the run's samples and draws what comes back. Every number is the run's
 * own; the one number of the assistant's is the band, and the view says so.
 */
import type { ProbeSample } from './criteria';

export interface GraphSpec {
    /** The value to watch. */
    value: string;
    /** Its target, when it has one (35:evan1_soll for 35:evan1_ist). */
    target?: string;
    context?: readonly string[];
    seconds: number;
    band?: number;
}

/** Off target, and which way; `none` when there is no target or no band to judge by. */
export type GraphTone = 'within' | 'above' | 'below' | 'none';

export interface Graph {
    /** The window, in run seconds. */
    from: number;
    to: number;
    /** The samples in the window that carry the value, thinned to at most `max`. */
    points: Array<{ t: number; value: number; target: number | null }>;
    /** The y range both lines share. */
    min: number;
    max: number;
    latest: { value: number; target: number | null; deviation: number | null; t: number } | null;
    tone: GraphTone;
    context: Array<{ channel: string; value: number | null }>;
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function graphOf(samples: readonly ProbeSample[], spec: GraphSpec, max = 240): Graph {
    // The newest at the right edge, always: a run shorter than the window starts part way across.
    const end = samples.length ? samples[samples.length - 1].t : 0;
    const from = end - spec.seconds;
    const window = samples.filter((s) => s.t >= from && finite(s.values[spec.value]));
    const all = window.map((s) => ({ t: s.t, value: s.values[spec.value] as number, target: spec.target && finite(s.values[spec.target]) ? (s.values[spec.target] as number) : null }));
    const points = all.length <= max ? all : Array.from({ length: max }, (_, k) => all[Math.round((k * (all.length - 1)) / (max - 1))]);
    const ys = all.flatMap((p) => (p.target === null ? [p.value] : [p.value, p.target]));
    const last = all[all.length - 1] ?? null;
    const deviation = last && last.target !== null ? last.value - last.target : null;
    const tone: GraphTone =
        deviation === null || spec.band === undefined ? 'none' : Math.abs(deviation) <= spec.band ? 'within' : deviation > 0 ? 'above' : 'below';
    // The newest reading of each context value, wherever in the run it was last read.
    const context = (spec.context ?? []).map((channel) => {
        for (let i = samples.length - 1; i >= 0; i--) {
            const v = samples[i].values[channel];
            if (finite(v)) return { channel, value: v };
        }
        return { channel, value: null };
    });
    return {
        from,
        to: end,
        points,
        min: ys.length ? Math.min(...ys) : 0,
        max: ys.length ? Math.max(...ys) : 0,
        latest: last ? { value: last.value, target: last.target, deviation, t: last.t } : null,
        tone,
        context,
    };
}

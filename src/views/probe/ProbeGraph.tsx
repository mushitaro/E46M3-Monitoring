'use client';

import type { ProbeSample } from '@tsunagi/monitoring-engine';
import { Provenance } from '../../components/ui';
import { useLang } from '../../lib/i18n';
import { BOARD_LIMITS, defaultReadouts, type Part, type Readout } from '../../lib/probe/board';
import { channelStats } from '../../lib/probe/compare';
import { graphOf, readoutsOf, type GraphTone } from '../../lib/probe/graph';
import { channelLabel } from './ValueCards';

type T = ReturnType<typeof useLang>['t'];
const num = (v: number | null | undefined) => (v == null ? '—' : String(Math.round(v * 100) / 100));

const READOUT_LABEL: Record<Readout, (t: T) => string> = {
    value: (t) => t.readout_value,
    target: (t) => t.graph_target,
    delta: () => 'Δ',
    max: (t) => t.readout_max,
    min: (t) => t.readout_min,
    mean: (t) => t.readout_mean,
};

/** The value and its difference carry the colour of how far off target it is; the target its line's blue; the run's spread the quiet ink. */
const readoutColour = (r: Readout, tone: GraphTone) => (r === 'value' || r === 'delta' ? TONE[tone] : r === 'target' ? SERIES.target : TONE.none);

/** Off target, as the diverging scale says it: above red, below blue, within or unjudged the ink. */
const TONE: Record<GraphTone, string> = { above: '#F87A7F', below: '#6CCBEF', within: '#F2F2F5', none: '#F2F2F5' };
/** The data series registry (tsunagi-m-design §1.10): measured feedback violet and thick, the target blue and dashed. */
const SERIES = { value: '#B9A6EE', target: '#0A9BDB' };


/**
 * A graph part: the value large, coloured by how far it is from its target (when the assistant gave
 * a band), the window's value and target as two lines, and the context values small. `large` is the
 * MULTI pane's, for a driver's glance; the board draws it compact.
 */
export function ProbeGraph({ part: p, samples, run, live = false, large = false, describe }: {
    part: Pick<Part, 'channels' | 'context' | 'seconds' | 'band' | 'show'>;
    samples: ProbeSample[];
    run: number;
    live?: boolean;
    large?: boolean;
    describe?: (id: string) => { name: string; unit: string };
}) {
    const { t, lang } = useLang();
    const [value, target] = p.channels ?? [];
    if (!value) return null;
    const g = graphOf(samples, { value, target, context: p.context, seconds: p.seconds ?? BOARD_LIMITS.seconds.default, band: p.band });
    const v = describe?.(value) ?? channelLabel(value, lang);
    if (!g.latest) return <p className="py-2 text-xs text-slate-500">{t.graph_noValue}</p>;
    // A tenth of the range above and below, so the thick line is not cut at the edges; a flat line sits in the middle.
    const pad = (g.max - g.min) * 0.1 || Math.max(1, Math.abs(g.max) * 0.05);
    const lo = g.min - pad;
    const span = g.max + pad - lo;
    const x = (tt: number) => ((tt - g.from) / (g.to - g.from || 1)) * 100;
    const y = (n: number) => 100 - ((n - lo) / span) * 100;
    const line = (pick: (q: (typeof g.points)[number]) => number | null) =>
        g.points.flatMap((q) => {
            const n = pick(q);
            return n === null ? [] : [`${x(q.t).toFixed(2)},${y(n).toFixed(2)}`];
        }).join(' ');
    const dev = g.latest.deviation;
    // The numbers drawn large, in the order asked; a target and difference not among them stay small beside.
    const show = p.show ?? defaultReadouts(p.channels);
    const big = readoutsOf(g, show.some((r) => r === 'max' || r === 'min' || r === 'mean') ? channelStats({ samples }).get(value) : undefined, show);
    const small = target ? (['target', 'delta'] as const).filter((r) => !show.includes(r)) : [];
    const size = large ? (big.length > 3 ? 'text-5xl' : 'text-6xl') : big.length > 3 ? 'text-2xl' : 'text-3xl';
    return (
        <div className={large ? 'flex h-full flex-col gap-2' : 'space-y-1'}>
            <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate text-xs text-slate-300">{v.name}</span>
                <span className="shrink-0 font-mono text-[10px] text-slate-600">
                    {live ? `${t.run_tag} ${run} · LIVE` : `${t.run_tag} ${run}`}
                </span>
            </div>
            <div className="flex flex-wrap items-end gap-x-5 gap-y-1">
                {big.map((r) => (
                    <div key={r.kind} className="min-w-0">
                        <p className="text-[11px] text-slate-500">{READOUT_LABEL[r.kind](t)}</p>
                        <p className="flex items-baseline gap-1">
                            <span className={`font-mono tabular-nums ${size}`} style={{ color: readoutColour(r.kind, g.tone) }}>
                                {r.kind === 'delta' && r.value !== null && r.value > 0 ? '+' : ''}
                                {num(r.value)}
                            </span>
                            <span className="text-xs text-slate-500">{v.unit}</span>
                        </p>
                    </div>
                ))}
                {g.latest.target !== null && small.length ? (
                    <span className="pb-1 font-mono text-xs tabular-nums text-slate-400">
                        {small.includes('target') ? `${t.graph_target} ${num(g.latest.target)}` : null}
                        {small.includes('delta') && dev !== null ? <span className="ml-2" style={{ color: TONE[g.tone] }}>Δ {dev > 0 ? '+' : ''}{num(dev)}</span> : null}
                    </span>
                ) : null}
            </div>
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" className={large ? 'min-h-0 w-full flex-1' : 'h-24 w-full'}>
                {target ? <polyline points={line((q) => q.target)} fill="none" stroke={SERIES.target} strokeWidth="1.5" strokeDasharray="4 3" vectorEffect="non-scaling-stroke" /> : null}
                <polyline points={line((q) => q.value)} fill="none" stroke={SERIES.value} strokeWidth="3" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            </svg>
            <div className="flex items-baseline justify-between gap-3 font-mono text-[10px] text-slate-600">
                <span>
                    {num(g.min)} – {num(g.max)} · {p.seconds ?? BOARD_LIMITS.seconds.default} s
                </span>
                {p.band !== undefined ? <Provenance>{t.graph_band(num(p.band))}</Provenance> : null}
            </div>
            {g.context.length ? (
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                    {g.context.map((c) => {
                        const l = describe?.(c.channel) ?? channelLabel(c.channel, lang);
                        return (
                            <span key={c.channel} className="flex items-baseline gap-1 text-[11px] text-slate-500">
                                {l.name}
                                <span className="font-mono tabular-nums text-slate-300">{num(c.value)}</span>
                                {l.unit}
                            </span>
                        );
                    })}
                </div>
            ) : null}
        </div>
    );
}

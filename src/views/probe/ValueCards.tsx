'use client';
import { MSS54_CHANNELS, type ChannelId } from '@tsunagi/ds2-mss54';
import { useLang } from '../../lib/i18n';
import { channelStats } from '../../lib/probe/compare';
import type { ProbeLive } from '../../lib/probe/runStore';

const num = (v: number | null | undefined) => v == null ? '—' : String(Math.round(v * 100) / 100);

export function channelLabel(id: string, lang: string): { name: string; unit: string } {
    const c = MSS54_CHANNELS.get(id as ChannelId);
    return c ? { name: lang === 'en' ? c.field.name : c.field.ja, unit: c.field.unit } : { name: id, unit: '' };
}

/**
 * The values as cards (operator, 2026-11-11: 「カードみたいなイメージ」): each channel's newest number
 * large with its unit, and its mean and spread small beneath — read at a glance from the driver's seat.
 * `large` is the MULTI pane's.
 */
export function ValueCards({ source, only, large = false, describe }: {
    source: Pick<ProbeLive, 'samples'>; only?: readonly string[]; large?: boolean;
    describe?(id: string): { name: string; unit: string } | null;
}) {
    const { lang } = useLang();
    const stats = [...channelStats(source)].filter(([k]) => !only || only.includes(k));
    const latest = latestValues(source);
    return (
        <div className={`grid gap-2 ${large ? 'grid-cols-2 lg:grid-cols-3' : 'grid-cols-2 sm:grid-cols-3'}`}>
            {stats.map(([k, x]) => {
                const l = describe?.(k) ?? channelLabel(k, lang);
                return (
                    <div key={k} className="min-w-0 rounded bg-slate-800/40 px-3 py-2">
                        <p className="truncate text-[11px] text-slate-400" title={k}>
                            {l.name}
                        </p>
                        <p className="flex items-baseline gap-1">
                            <span className={`font-mono tabular-nums text-slate-100 ${large ? 'text-5xl' : 'text-3xl'}`}>{num(latest.get(k))}</span>
                            <span className="text-xs text-slate-500">{l.unit}</span>
                        </p>
                        <p className="truncate font-mono text-[10px] tabular-nums text-slate-500">
                            ⌀ {num(x.mean)} · {num(x.min)}–{num(x.max)} · n {x.n}
                        </p>
                    </div>
                );
            })}
        </div>
    );
}

/**
 * The newest number each channel has had in a run in progress. Kept per sample list and carried on
 * from where it stopped, like `channelStats`: the board redraws once a sample.
 */
const newest = new WeakMap<readonly ProbeLive['samples'][number][], { seen: number; out: Map<string, number> }>();
export function latestValues(live: Pick<ProbeLive, 'samples'>): Map<string, number> {
    let memo = newest.get(live.samples);
    if (!memo || memo.seen > live.samples.length) {
        memo = { seen: 0, out: new Map() };
        newest.set(live.samples, memo);
    }
    for (let i = memo.seen; i < live.samples.length; i++) {
        for (const [k, v] of Object.entries(live.samples[i].values)) if (typeof v === 'number' && Number.isFinite(v)) memo.out.set(k, v);
    }
    memo.seen = live.samples.length;
    return new Map(memo.out);
}

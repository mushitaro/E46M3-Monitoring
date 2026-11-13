'use client';

import { ChevronDown, ChevronUp, ChevronsDownUp, ChevronsUpDown } from 'lucide-react';
import { MSS54_CHANNELS, formatErrorCode, type ChannelId, type ErrorMemoryEntry } from '@tsunagi/ds2-mss54';
import type { RawFaultRead } from '@/hooks/useDs2Link';
import type { ProbeProgress } from '@/hooks/useProbe';
import { DataList, DataRow, Field, Pane, Pill, Provenance, Section, TextButton, humanName } from '@/components/ui';
import { text as resolveText, type EcuProfile } from '@tsunagi/monitoring-engine';
import { normCode } from '@/lib/faultCode';
import { useLang } from '@/lib/i18n';
import { currentPlan } from '@/lib/notebook/rules';
import { BOARD_LIMITS, defaultReadouts, type Part, type PartKind, type Readout } from '@/lib/probe/board';
import { channelStats, compareRuns, type Comparison } from '@/lib/probe/compare';
import { graphOf, readoutsOf, type GraphTone } from '@/lib/probe/graph';
import type { ProbeLive, StoredRun } from '@/lib/probe/runStore';
import type { ScanRun } from '@tsunagi/monitoring-engine';
import { formOf } from '@/lib/probe/sessions';
import { standing } from '@/views/diagnosis/ScanView';
import type { ProbeSessions } from './useProbeSessions';

/** What the board draws from besides the session: the screen's own reads. */
export interface BoardData {
    ecuId: string;
    moduleName: (id: string) => string;
    faults: ErrorMemoryEntry[] | null;
    rawFaults: RawFaultRead[] | null;
    /** The module in session's catalogue, for the text of its fault codes. */
    catalog: EcuProfile | null;
    scan: ScanRun | null;
    progress: ProbeProgress | null;
    /** The run in progress (its samples grow in place; `progress` changing is what redraws). */
    live?: ProbeLive | null;
}

type T = ReturnType<typeof useLang>['t'];

const KIND_LABEL: Record<PartKind, (t: T) => string> = {
    message: (t) => t.part_message,
    faults: (t) => t.part_faults,
    scan: (t) => t.part_scan,
    plan: (t) => t.part_plan,
    judges: (t) => t.part_judges,
    compare: (t) => t.part_compare,
    values: (t) => t.part_values,
    graph: (t) => t.part_graph,
};

const num = (v: number | null | undefined) => (v === null || v === undefined ? '—' : String(Math.round(v * 100) / 100));
const day = (ms: number) => new Date(ms).toLocaleDateString();

/**
 * PROBE — the board (operator, 2026-11-02): the parts the assistant placed for the session on the
 * screen, in the owner's order. Each part is drawn from the tab's own data (lib/probe/board says
 * why); the owner opens, closes and moves them. With nothing placed, nothing is drawn.
 */
export function BoardView({ s, data }: { s: ProbeSessions; data: BoardData }) {
    const { t } = useLang();
    const parts = s.board?.parts ?? [];
    if (!s.current || parts.length === 0) {
        // Nothing placed yet: a run in progress shows its values, as cards; otherwise say what comes here.
        const live = data.live && data.live.sessionId === s.current && data.live.samples.length > 0 ? data.live : null;
        return (
            <Pane>
                {live ? (
                    <Section title={KIND_LABEL.values(t)} note={`${t.run_tag} ${live.n} · v${live.planV} · LIVE`}>
                        <ValueCards source={live} />
                    </Section>
                ) : (
                    <Empty>{t.board_listEmpty}</Empty>
                )}
            </Pane>
        );
    }
    return (
        <Pane>
            {parts.map((p, i) => (
                <Section
                    key={p.id}
                    title={KIND_LABEL[p.kind](t)}
                    note={p.title}
                    actions={
                        <span className="flex items-baseline gap-2">
                            <TextButton tone="neutral" Icon={ChevronUp} disabled={i === 0} onClick={() => s.move(p.id, -1)} aria-label={t.board_up} title={t.board_up} className="-my-2 px-1 py-2">
                                {null}
                            </TextButton>
                            <TextButton
                                tone="neutral"
                                Icon={ChevronDown}
                                disabled={i === parts.length - 1}
                                onClick={() => s.move(p.id, 1)}
                                aria-label={t.board_down}
                                title={t.board_down}
                                className="-my-2 px-1 py-2"
                            >
                                {null}
                            </TextButton>
                            <TextButton
                                tone="neutral"
                                Icon={p.open ? ChevronsDownUp : ChevronsUpDown}
                                onClick={() => s.toggle(p.id)}
                                aria-expanded={p.open}
                                aria-label={p.open ? t.board_close : t.board_open}
                                title={p.open ? t.board_close : t.board_open}
                                className="-my-2 px-1 py-2"
                            >
                                {null}
                            </TextButton>
                        </span>
                    }
                >
                    {p.open ? <PartBody part={p} s={s} data={data} /> : null}
                </Section>
            ))}
        </Pane>
    );
}

function Empty({ children }: { children: React.ReactNode }) {
    return <p className="py-2 text-xs text-slate-500">{children}</p>;
}

/** The run a part means in this session: the one named, or the last. */
function runOf(s: ProbeSessions, n: number | undefined): StoredRun | null {
    const runs = s.runs;
    if (n === undefined) return runs[runs.length - 1] ?? null;
    return runs.find((r) => r.n === n) ?? null;
}

/**
 * The two runs a compare part means: the later one in this session, and the earlier — named, or the
 * run before it, or else the last run of the session this one carries on (NEXT).
 */
export function comparedRuns(s: ProbeSessions, p: Part): { a: StoredRun; b: StoredRun } | null {
    const b = runOf(s, p.run);
    if (!b) return null;
    const own = p.against?.record ? s.runsOf(p.against.record) : null;
    if (own) {
        const a = p.against?.run ? own.find((r) => r.n === p.against!.run) : own[own.length - 1];
        return a ? { a, b } : null;
    }
    if (p.against?.run) {
        const a = s.runs.find((r) => r.n === p.against!.run);
        return a ? { a, b } : null;
    }
    const before = s.runs.filter((r) => r.n < b.n);
    if (before.length) return { a: before[before.length - 1], b };
    const prev = s.series.length > 1 ? s.series[s.series.length - 2] : null;
    const prevRuns = prev ? s.runsOf(prev) : [];
    return prevRuns.length ? { a: prevRuns[prevRuns.length - 1], b } : null;
}

export function compareOf(s: ProbeSessions, p: Part): Comparison | null {
    const pair = comparedRuns(s, p);
    if (!pair) return null;
    const forms = { a: formOf(s.entries, pair.a.sessionId, pair.a.planV), b: formOf(s.entries, pair.b.sessionId, pair.b.planV) };
    return compareRuns(pair.a, pair.b, { channels: p.channels, limit: 12, forms });
}

function PartBody({ part: p, s, data }: { part: Part; s: ProbeSessions; data: BoardData }) {
    const { lang, t } = useLang();
    const runLabel = (r: { record: string; n: number; planV: number; startedAt: number }) =>
        `${r.record === s.current ? '' : `${day(r.startedAt)} `}${t.run_tag} ${r.n} · v${r.planV}`;

    switch (p.kind) {
        case 'message':
            return (
                <div className="space-y-1">
                    <p className="whitespace-pre-line text-sm leading-relaxed text-slate-200">{p.text}</p>
                    <Provenance>{t.board_aiWords}</Provenance>
                </div>
            );

        case 'faults': {
            const wanted = p.module ?? data.ecuId;
            if (wanted !== data.ecuId) return <Empty>{t.board_otherModule(data.moduleName(data.ecuId))}</Empty>;
            if (data.faults !== null) {
                if (data.faults.length === 0) return <p className="py-2 text-xs text-emerald-400">{t.faults_none}</p>;
                const text = new Map((data.catalog?.faultText ?? []).map((f) => [normCode(f.code), f]));
                return (
                    <DataList>
                        {data.faults.map((f) => {
                            const code = formatErrorCode(f.errorCode);
                            const known = text.get(normCode(code));
                            return (
                                <DataRow
                                    key={`${f.number}-${f.errorCode}`}
                                    code={code}
                                    codeTone="danger"
                                    name={known && data.catalog ? resolveText(data.catalog, known.text, lang).text : humanName('')}
                                    trailing={<span className="shrink-0 font-mono text-[11px] text-slate-500">×{f.frequencyCounter}</span>}
                                />
                            );
                        })}
                    </DataList>
                );
            }
            if (data.rawFaults !== null) {
                return (
                    <DataList>
                        {data.rawFaults.map((r, i) => (
                            <DataRow key={i} name={humanName('')} ident={r.source} detail={<p className="break-all font-mono text-[11px] text-slate-400">{r.response}</p>} />
                        ))}
                    </DataList>
                );
            }
            return <Empty>{t.board_notRead}</Empty>;
        }

        case 'scan': {
            if (!data.scan) return <Empty>{t.board_noScan}</Empty>;
            const rows = data.scan.results.map((r) => ({ r, st: standing(r, t) })).sort((x, y) => x.st.rank - y.st.rank);
            return (
                <DataList>
                    {rows.map(({ r, st }) => (
                        <DataRow
                            key={r.address}
                            code={r.address}
                            name={humanName(r.modules.map((m) => data.moduleName(m)).join(' / '))}
                            trailing={<span className={`shrink-0 text-[11px] ${st.tone}`}>{st.word}</span>}
                        />
                    ))}
                </DataList>
            );
        }

        case 'plan': {
            const plan = currentPlan(s.entries.filter((e) => e.sessionId === s.current)).plan;
            if (!plan || plan.body.kind !== 'plan') return <Empty>{t.board_noPlan}</Empty>;
            const b = plan.body;
            return (
                <div className="space-y-3">
                    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                        <Field label="FORM" value={`v${b.v}`} />
                        <Field label={t.run_tag} value={s.runs.length} />
                        {data.progress && <Field label="PROBE" value={`${data.progress.settled}/${data.progress.total} · ${data.progress.samples}`} tone="text-amber-400" />}
                    </div>
                    <p className="text-sm text-slate-200">{b.purpose}</p>
                    {b.hypotheses && b.hypotheses.length > 0 && (
                        <DataList>
                            {b.hypotheses.map((h) => (
                                <DataRow key={h.id} code={h.id} name={humanName(h.text)} detail={<p className="text-[11px] text-slate-500">{h.refutedBy}</p>} />
                            ))}
                        </DataList>
                    )}
                    <DataList>
                        {b.steps.map((st) => (
                            <DataRow key={st.n} code={String(st.n)} name={humanName(st.do)} ident={st.kind} />
                        ))}
                    </DataList>
                </div>
            );
        }

        case 'judges': {
            const run = runOf(s, p.run);
            if (!run) return <Empty>{p.run ? t.board_noRunN(p.run) : t.board_noRun}</Empty>;
            const defs = new Map((formOf(s.entries, run.sessionId, run.planV)?.judge ?? []).map((j) => [j.id, j]));
            return (
                <div className="space-y-1">
                    <p className="font-mono text-[11px] text-slate-500">{runLabel({ record: run.sessionId, n: run.n, planV: run.planV, startedAt: run.startedAt })}</p>
                    <DataList>
                        {run.judges.map((j) => {
                            const d = defs.get(j.id);
                            return (
                                <DataRow
                                    key={j.id}
                                    leading={<Pill tone={j.pass === null ? 'neutral' : j.pass ? 'ok' : 'danger'}>{j.pass === null ? '—' : j.pass ? t.pass : t.fail}</Pill>}
                                    name={humanName('')}
                                    ident={j.id}
                                    trailing={
                                        <span className="flex shrink-0 items-baseline gap-2">
                                            <span className="font-mono text-[11px] tabular-nums text-slate-200">
                                                {num(j.value)}
                                                {d ? ` ${d.op} ${d.value}${d.unit ? ` ${d.unit}` : ''}` : ''}
                                            </span>
                                            <Provenance>{j.provenance}</Provenance>
                                        </span>
                                    }
                                />
                            );
                        })}
                    </DataList>
                </div>
            );
        }

        case 'compare': {
            const c = compareOf(s, p);
            if (!c) return <Empty>{s.runs.length === 0 ? t.board_noRun : t.board_noCompare}</Empty>;
            return (
                <div className="space-y-2">
                    <p className="font-mono text-[11px] text-slate-500">
                        {t.compare_runs(runLabel({ record: c.a.record, n: c.a.n, planV: c.a.planV, startedAt: c.a.startedAt }), runLabel({ record: c.b.record, n: c.b.n, planV: c.b.planV, startedAt: c.b.startedAt }))}
                        {' · '}
                        {t.compare_common(c.channels.length + c.judges.length)}
                    </p>
                    <DataList>
                        {c.channels.map((x) => (
                            <DataRow
                                key={x.channel}
                                name={humanName('')}
                                ident={x.channel}
                                trailing={
                                    <span className="shrink-0 font-mono text-[11px] tabular-nums text-slate-300">
                                        {num(x.a?.mean)} → {num(x.b?.mean)}
                                        <span className={`ml-2 ${x.delta ? 'text-amber-400' : 'text-slate-600'}`}>
                                            {x.delta !== null && x.delta > 0 ? '+' : ''}
                                            {num(x.delta)}
                                        </span>
                                    </span>
                                }
                            />
                        ))}
                        {c.judges.map((j) => (
                            <DataRow
                                key={`j-${j.id}`}
                                name={humanName('')}
                                ident={j.id}
                                trailing={
                                    <span className="shrink-0 font-mono text-[11px] tabular-nums text-slate-300">
                                        {num(j.a?.value)} → {num(j.b?.value)}
                                        <span className="ml-2">{j.b?.pass === null || j.b === null ? '—' : j.b.pass ? t.pass : t.fail}</span>
                                    </span>
                                }
                            />
                        ))}
                        {c.items?.added.map((i) => (
                            <DataRow
                                key={`+${i.key}`}
                                leading={<Pill tone="ok">{t.item_added}</Pill>}
                                name={humanName('')}
                                ident={i.label}
                                trailing={<span className="shrink-0 text-[11px] text-slate-500">{t.item_since(c.items!.to)}</span>}
                            />
                        ))}
                        {c.items?.removed.map((i) => (
                            <DataRow
                                key={`-${i.key}`}
                                leading={<Pill>{t.item_removed}</Pill>}
                                name={humanName('')}
                                ident={i.label}
                                trailing={<span className="shrink-0 text-[11px] text-slate-500">{t.item_until(c.items!.to)}</span>}
                            />
                        ))}
                    </DataList>
                </div>
            );
        }

        case 'values': {
            // While a run is going and the part does not name another run, the values are the live
            // ones: the latest sample of each channel, with the spread so far. Otherwise the stored run.
            const { live, run } = sourceOf(s, p, data.live);
            if (!live && !run) return <Empty>{p.run ? t.board_noRunN(p.run) : t.board_noRun}</Empty>;
            return (
                <div className="space-y-1">
                    <p className="font-mono text-[11px] text-slate-500">
                        {live
                            ? `${t.run_tag} ${live.n} · v${live.planV} · LIVE`
                            : runLabel({ record: run!.sessionId, n: run!.n, planV: run!.planV, startedAt: run!.startedAt })}
                    </p>
                    <ValueCards source={live ?? run!} only={p.channels} />
                </div>
            );
        }

        case 'graph':
            return <GraphPart part={p} s={s} live={data.live} />;
    }
}

/** The run a values or graph part draws: the one in progress when it is this session's and the part names no other. */
function sourceOf(s: ProbeSessions, p: Part, live: ProbeLive | null | undefined): { live: ProbeLive | null; run: StoredRun | null } {
    const l = live && live.sessionId === s.current && (p.run === undefined || p.run === live.n) ? live : null;
    return { live: l, run: l ? null : runOf(s, p.run) };
}

const samplesOf = (src: { live: ProbeLive | null; run: StoredRun | null }) => (src.live ? src.live.samples : src.run!.samples);

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

function channelLabel(id: string, lang: string): { name: string; unit: string } {
    const c = MSS54_CHANNELS.get(id as ChannelId);
    return c ? { name: lang === 'en' ? c.field.name : c.field.ja, unit: c.field.unit } : { name: id, unit: '' };
}

/**
 * A graph part: the value large, coloured by how far it is from its target (when the assistant gave
 * a band), the window's value and target as two lines, and the context values small. `large` is the
 * MULTI pane's, for a driver's glance; the board draws it compact.
 */
export function GraphPart({ part: p, s, live, large = false }: { part: Part; s: ProbeSessions; live: ProbeLive | null | undefined; large?: boolean }) {
    const { t, lang } = useLang();
    const [value, target] = p.channels ?? [];
    const src = sourceOf(s, p, live);
    if (!value) return null;
    if (!src.live && !src.run) return <Empty>{p.run ? t.board_noRunN(p.run) : t.board_noRun}</Empty>;
    const samples = samplesOf(src);
    const g = graphOf(samples, { value, target, context: p.context, seconds: p.seconds ?? BOARD_LIMITS.seconds.default, band: p.band });
    const v = channelLabel(value, lang);
    if (!g.latest) return <Empty>{t.graph_noValue}</Empty>;
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
    const big = readoutsOf(g, show.some((r) => r === 'max' || r === 'min' || r === 'mean') ? channelStats({ samples: samplesOf(src) }).get(value) : undefined, show);
    const small = target ? (['target', 'delta'] as const).filter((r) => !show.includes(r)) : [];
    const size = large ? (big.length > 3 ? 'text-5xl' : 'text-6xl') : big.length > 3 ? 'text-2xl' : 'text-3xl';
    return (
        <div className={large ? 'flex h-full flex-col gap-2' : 'space-y-1'}>
            <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate text-xs text-slate-300">{v.name}</span>
                <span className="shrink-0 font-mono text-[10px] text-slate-600">
                    {src.live ? `${t.run_tag} ${src.live.n} · LIVE` : `${t.run_tag} ${src.run!.n}`}
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
                        const l = channelLabel(c.channel, lang);
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

/**
 * The values as cards (operator, 2026-11-11: 「カードみたいなイメージ」): each channel's newest number
 * large with its unit, and its mean and spread small beneath — read at a glance from the driver's seat.
 * `large` is the MULTI pane's.
 */
export function ValueCards({ source, only, large = false }: { source: Pick<ProbeLive, 'samples'>; only?: readonly string[]; large?: boolean }) {
    const { lang } = useLang();
    const stats = [...channelStats(source)].filter(([k]) => !only || only.includes(k));
    const latest = latestValues(source);
    return (
        <div className={`grid gap-2 ${large ? 'grid-cols-2 lg:grid-cols-3' : 'grid-cols-2 sm:grid-cols-3'}`}>
            {stats.map(([k, x]) => {
                const l = channelLabel(k, lang);
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

/**
 * PROBE's MULTI: the picture of the board. The first open graph part, large; otherwise the first
 * open compare part, as bars of how far each value moved for its own spread; otherwise the
 * assistant's latest words; otherwise nothing.
 */
export function BoardViz({ s, live }: { s: ProbeSessions; live?: ProbeLive | null }) {
    const { t } = useLang();
    const parts = (s.board?.parts ?? []).filter((p) => p.open);
    // A graph is what a driver glances at: the first open one, large.
    const graph = parts.find((p) => p.kind === 'graph');
    if (graph) return <GraphPart part={graph} s={s} live={live} large />;
    const compare = parts.find((p) => p.kind === 'compare');
    const c = compare ? compareOf(s, compare) : null;
    if (c && c.channels.length > 0) {
        const rows = c.channels.slice(0, 8);
        return (
            <div className="flex h-full flex-col justify-center gap-2">
                <p className="font-mono text-[11px] text-slate-500">
                    {t.compare_runs(`${t.run_tag} ${c.a.n} · v${c.a.planV}`, `${t.run_tag} ${c.b.n} · v${c.b.planV}`)}
                </p>
                {rows.map((x) => (
                    <div key={x.channel} className="grid grid-cols-[6rem_minmax(0,1fr)] items-center gap-2">
                        <span className="truncate font-mono text-[11px] text-slate-400">{x.channel}</span>
                        <div className="h-1.5 bg-slate-900">
                            <div className="h-full bg-blue-500/70" style={{ width: `${Math.min(100, Math.round((x.relative ?? 0) * 100))}%` }} />
                        </div>
                    </div>
                ))}
            </div>
        );
    }
    // A run in progress with no graph placed: its own channels, a graph of the first and the rest as
    // cards (operator, 2026-11-12: VISU went black while recording). Nothing to draw is said, not black.
    const recording = live && live.sessionId === s.current && live.samples.length > 0 ? live : null;
    if (recording) {
        const channels = [...channelStats(recording)].map(([k]) => k);
        const first = channels[0];
        const auto = { id: 'auto', kind: 'graph', open: true, at: 0, channels: [first] } as Part;
        // The graph keeps half the pane; a glance takes in six values, not a whole block's worth.
        return (
            <div className="flex h-full flex-col gap-3">
                <div className="h-1/2 min-h-0 shrink-0">
                    <GraphPart part={auto} s={s} live={recording} large />
                </div>
                {channels.length > 1 ? (
                    <div className="min-h-0 flex-1 overflow-hidden">
                        <ValueCards source={recording} only={channels.slice(1, 7)} />
                    </div>
                ) : null}
            </div>
        );
    }
    const message = [...parts].reverse().find((p) => p.kind === 'message');
    if (message) {
        return (
            <div className="flex h-full flex-col justify-center gap-2">
                <p className="whitespace-pre-line text-base leading-relaxed text-slate-200">{message.text}</p>
                <Provenance>{t.board_aiWords}</Provenance>
            </div>
        );
    }
    const values = parts.find((p) => p.kind === 'values');
    const run = values ? sourceOf(s, values, live).run : null;
    if (values && run) return <ValueCards source={run} only={values.channels} large />;
    return (
        <div className="flex h-full items-center justify-center">
            <p className="text-sm text-slate-500">{t.board_vizEmpty}</p>
        </div>
    );
}

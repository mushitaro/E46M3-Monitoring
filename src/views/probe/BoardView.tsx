'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp, ChevronsDownUp, ChevronsUpDown, Radar } from 'lucide-react';
import { formatErrorCode, type ErrorMemoryEntry } from '@tsunagi/ds2-mss54';
import type { RawFaultRead } from '@/hooks/useDs2Link';
import type { ProbeProgress } from '@/hooks/useProbe';
import { DataList, DataRow, Field, Pane, Pill, Provenance, Section, TextButton, humanName } from '@/components/ui';
import type { EcuProfile } from '@tsunagi/monitoring-engine';
import { faultLabel } from '@/lib/faultText';
import { useLang } from '@/lib/i18n';
import { currentPlan } from '@/lib/notebook/rules';
import { BOARD_LIMITS, defaultReadouts, type Part, type PartKind, type Readout } from '@/lib/probe/board';
import { channelStats, compareRuns, type Comparison } from '@/lib/probe/compare';
import { pairTargets, pairTitle } from '@/lib/channelLabel';
import { graphOf, readoutsOf, type GraphTone } from '@/lib/probe/graph';
import type { ProbeLive, StoredRun } from '@/lib/probe/runStore';
import type { ScanRun } from '@tsunagi/monitoring-engine';
import { formOf } from '@/lib/probe/sessions';
import { standing } from '@/views/diagnosis/ScanView';
import { Awaiting } from '@/views/shared/Awaiting';
import { TEST_ID, tid } from '@/lib/testIds';
import { useProbeNames } from './names';
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
/** When a run started, to the minute: the compare line says when the earlier run was (SC04 step 2, F19). */
const when = (ms: number) => new Date(ms).toLocaleString([], { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
/** M/D HH:MM — a run's start, read at a glance. */
const clock = (ms: number) => {
    const d = new Date(ms);
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/**
 * PROBE — the board (operator, 2026-11-02): the parts the assistant placed for the session on the
 * screen, in the owner's order. Each part is drawn from the tab's own data (lib/probe/board says
 * why); the owner opens, closes and moves them. With nothing placed, nothing is drawn.
 */
export function BoardView({ s, data }: { s: ProbeSessions; data: BoardData }) {
    const { t } = useLang();
    const parts = s.board?.parts ?? [];
    if (!s.current || parts.length === 0) {
        // Nothing placed: a run in progress lists what it is taking, the numbers large on VISU only
        // (UX-08); once it stops, the last run stays, summed up (UX-07). Nothing at all is said once.
        const live = data.live && data.live.sessionId === s.current && data.live.samples.length > 0 ? data.live : null;
        const last = s.current ? s.runs[s.runs.length - 1] : undefined;
        return (
            <Pane>
                {live ? (
                    <Section title={KIND_LABEL.values(t)} note={`${t.run_tag} ${live.n} · v${live.planV} · LIVE`}>
                        <ValueRows source={live} only={plannedChannels(s, live)} />
                    </Section>
                ) : last ? (
                    <LastRun s={s} run={last} />
                ) : (
                    <Awaiting icon={Radar} label={t.awaiting_probe} />
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
    const names = useProbeNames();
    const runLabel = (r: { record: string; n: number; planV: number; startedAt: number }) =>
        // When it was taken, always: 「前回と比べて」 is answered with the day and time of the run before.
        `${r.record === s.current ? '' : `${day(r.startedAt)} `}${clock(r.startedAt)} ${t.run_tag} ${r.n} · v${r.planV}`;

    switch (p.kind) {
        // The part's title already says AI: its words are not labelled a second time (UX-10).
        case 'message':
            return <p className="whitespace-pre-line text-sm leading-relaxed text-slate-200">{p.text}</p>;

        case 'faults': {
            const wanted = p.module ?? data.ecuId;
            if (wanted !== data.ecuId) return <Empty>{t.board_otherModule(data.moduleName(data.ecuId))}</Empty>;
            if (data.faults !== null) {
                if (data.faults.length === 0) return <p className="py-2 text-xs text-emerald-400">{t.faults_none}</p>;
                return (
                    <DataList>
                        {data.faults.map((f) => {
                            const code = formatErrorCode(f.errorCode);
                            // The name slot's rule, as on DIAGNOSIS (UX-22, lib/faultText): a name a person
                            // wrote, else what it is with the SGBD's German beside it.
                            const label = faultLabel(data.catalog, code, lang);
                            return (
                                <DataRow
                                    key={`${f.number}-${f.errorCode}`}
                                    code={code}
                                    codeTone="danger"
                                    name={label?.text ?? humanName(label?.original ? t.fault_untranslated : '')}
                                    ident={label?.text ? undefined : label?.original || undefined}
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
                    <p className="text-sm text-slate-200">{names.text(b.purpose)}</p>
                    {b.hypotheses && b.hypotheses.length > 0 && (
                        <DataList>
                            {b.hypotheses.map((h) => (
                                <DataRow key={h.id} code={h.id} name={humanName(names.text(h.text))} detail={<p className="text-[11px] text-slate-500">{names.text(h.refutedBy)}</p>} />
                            ))}
                        </DataList>
                    )}
                    <DataList>
                        {b.steps.map((st) => (
                            <DataRow key={st.n} code={String(st.n)} name={humanName(names.text(st.do))} ident={st.kind} />
                        ))}
                    </DataList>
                    <Readings s={s} />
                </div>
            );
        }

        case 'judges': {
            const run = runOf(s, p.run);
            if (!run) return <Empty>{p.run ? t.board_noRunN(p.run) : t.board_noRun}</Empty>;
            const defs = new Map((formOf(s.entries, run.sessionId, run.planV)?.judge ?? []).map((j) => [j.id, j]));
            // Where the thresholds came from, said once when every one came from the same place; a
            // row says its own only where it differs (UX-10).
            const sources = new Set(run.judges.map((j) => j.provenance));
            const one = sources.size === 1 ? [...sources][0] : null;
            return (
                <div className="space-y-1">
                    <p className="font-mono text-[11px] text-slate-500">
                        {runLabel({ record: run.sessionId, n: run.n, planV: run.planV, startedAt: run.startedAt })}
                        {one ? ` · ${t.judges_source(t.judge_provenance[one as keyof typeof t.judge_provenance] ?? one)}` : ''}
                    </p>
                    <DataList>
                        {run.judges.map((j) => {
                            const d = defs.get(j.id);
                            const unit = d ? (d.unit ?? names.channel(d.channel).unit) : '';
                            return (
                                <DataRow
                                    key={j.id}
                                    leading={<Pill tone={j.pass === null ? 'neutral' : j.pass ? 'ok' : 'danger'}>{j.pass === null ? '—' : j.pass ? t.pass : t.fail}</Pill>}
                                    name={humanName(d ? names.judge(d) : '')}
                                    ident={j.id}
                                    trailing={
                                        <span className="flex shrink-0 items-baseline gap-2">
                                            <span className="font-mono text-[11px] tabular-nums text-slate-200">
                                                {num(j.value)}
                                                {unit ? ` ${unit}` : ''}
                                            </span>
                                            {!one && <Provenance>{t.judge_provenance[j.provenance as keyof typeof t.judge_provenance] ?? j.provenance}</Provenance>}
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
            const pair = comparedRuns(s, p);
            const judgeDefs = [
                ...(pair ? (formOf(s.entries, pair.b.sessionId, pair.b.planV)?.judge ?? []) : []),
                ...(pair ? (formOf(s.entries, pair.a.sessionId, pair.a.planV)?.judge ?? []) : []),
            ];
            return (
                <div className="space-y-2">
                    <p className="font-mono text-[11px] text-slate-500">
                        {t.compare_runs(
                            `${when(c.a.startedAt)} ${runLabel({ record: s.current ?? c.a.record, n: c.a.n, planV: c.a.planV, startedAt: c.a.startedAt })}`,
                            `${when(c.b.startedAt)} ${runLabel({ record: s.current ?? c.b.record, n: c.b.n, planV: c.b.planV, startedAt: c.b.startedAt })}`,
                        )}
                        {' · '}
                        {t.compare_common(c.channels.length + c.judges.length)}
                    </p>
                    <DataList>
                        {c.channels.map((x) => {
                            const l = names.channel(x.channel);
                            return (
                                <DataRow
                                    key={x.channel}
                                    name={humanName(l.name)}
                                    ident={l.ident}
                                    trailing={
                                        <span className="shrink-0 font-mono text-[11px] tabular-nums text-slate-300">
                                            {num(x.a?.mean)} → {num(x.b?.mean)}
                                            <span className={`ml-2 ${x.delta ? 'text-amber-400' : 'text-slate-600'}`}>
                                                {x.delta !== null && x.delta > 0 ? '+' : ''}
                                                {num(x.delta)}
                                            </span>
                                            {l.unit ? <span className="ml-1 text-slate-500">{l.unit}</span> : null}
                                        </span>
                                    }
                                />
                            );
                        })}
                        {c.judges.map((j) => (
                            <DataRow
                                key={`j-${j.id}`}
                                name={humanName(names.item({ key: '', kind: 'judge', label: j.id }, judgeDefs).name)}
                                ident={j.id}
                                trailing={
                                    <span className="shrink-0 font-mono text-[11px] tabular-nums text-slate-300">
                                        {num(j.a?.value)} → {num(j.b?.value)}
                                        <span className="ml-2">{j.b?.pass === null || j.b === null ? '—' : j.b.pass ? t.pass : t.fail}</span>
                                    </span>
                                }
                            />
                        ))}
                        {c.items?.added.map((i) => {
                            const n = names.item(i, judgeDefs);
                            return (
                                <DataRow
                                    key={`+${i.key}`}
                                    leading={<Pill tone="ok">{t.item_added}</Pill>}
                                    name={humanName(n.name)}
                                    ident={n.ident}
                                    trailing={<span className="shrink-0 text-[11px] text-slate-500">{t.item_since(c.items!.to)}</span>}
                                />
                            );
                        })}
                        {c.items?.removed.map((i) => {
                            const n = names.item(i, judgeDefs);
                            return (
                                <DataRow
                                    key={`-${i.key}`}
                                    leading={<Pill>{t.item_removed}</Pill>}
                                    name={humanName(n.name)}
                                    ident={n.ident}
                                    trailing={<span className="shrink-0 text-[11px] text-slate-500">{t.item_until(c.items!.to)}</span>}
                                />
                            );
                        })}
                    </DataList>
                    {/* Once, under the list, not on every removed row (UX-10). */}
                    {c.items && c.items.removed.length > 0 && <p className="text-[11px] text-slate-500">{t.item_keptNote}</p>}
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
                    <ValueCards source={live ?? run!} only={p.channels ?? plannedChannels(s, live ?? run!)} />
                </div>
            );
        }

        case 'graph':
            return <GraphPart part={p} s={s} live={data.live} />;
    }
}

/**
 * The channels a run in progress shows by itself: the ones its plan names (its samples, its captures'
 * conditions, its judgements), not every value of the blocks read for them. `3:*` and `smg2:JOB:*`
 * name a whole read. With no plan to go by, everything recorded.
 */
function plannedChannels(s: ProbeSessions, live: Pick<ProbeLive, 'samples'>): string[] {
    const recorded = [...channelStats(live)].map(([k]) => k);
    const plan = s.current ? currentPlan(s.entries.filter((e) => e.sessionId === s.current)).plan : null;
    if (!plan) return recorded;
    const named = new Set<string>();
    for (const st of plan.body.steps) {
        if (st.kind === 'sample') st.channels.forEach((c) => named.add(c));
        if (st.kind === 'capture') st.condition.forEach((c) => named.add(c.channel));
    }
    for (const j of plan.body.judge ?? []) named.add(j.channel);
    const wanted = (k: string) => named.has(k) || [...named].some((c) => c.endsWith(':*') && k.startsWith(c.slice(0, -1)));
    const out = recorded.filter(wanted);
    return out.length > 0 ? out : recorded;
}

/** The record's readings (the assistant's and the desk's), each with how sure it is: 確か・可能性・未確認. */
function Readings({ s }: { s: ProbeSessions }) {
    const { t } = useLang();
    const reads = s.entries.filter((e) => e.sessionId === s.current && e.body.kind === 'read');
    if (reads.length === 0) return null;
    return (
        <Section title={t.board_readings} count={reads.length}>
            <DataList>
                {reads.map((e) =>
                    e.body.kind === 'read' ? (
                        <DataRow key={e.id} leading={<Pill tone={e.body.sure === 'high' ? 'ok' : 'neutral'}>{t.sure[e.body.sure]}</Pill>} name={humanName(e.body.text)} />
                    ) : null,
                )}
            </DataList>
        </Section>
    );
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

/**
 * A graph part: the value large, coloured by how far it is from its target (when the assistant gave
 * a band), the window's value and target as two lines, and the context values small. `large` is the
 * MULTI pane's, for a driver's glance; the board draws it compact.
 */
export function GraphPart({ part: p, s, live, large = false }: { part: Part; s: ProbeSessions; live: ProbeLive | null | undefined; large?: boolean }) {
    const { t } = useLang();
    const names = useProbeNames();
    const [value, target] = p.channels ?? [];
    const src = sourceOf(s, p, live);
    if (!value) return null;
    if (!src.live && !src.run) return <Empty>{p.run ? t.board_noRunN(p.run) : t.board_noRun}</Empty>;
    const samples = samplesOf(src);
    const g = graphOf(samples, { value, target, context: p.context, seconds: p.seconds ?? BOARD_LIMITS.seconds.default, band: p.band });
    const v = names.channel(value);
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
                        const l = names.channel(c.channel);
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
 * large with its unit — read at a glance from the driver's seat. A target and its actual are one card
 * under one title, 実 large and 目標 beside it, so neither name is cut to tell them apart (UX-08). The
 * mean and spread are behind a press on the card (UX-10): at a glance, the number. `large` is the MULTI
 * pane's; `max` caps the cards a glance takes in.
 */
export function ValueCards({ source, only, large = false, max }: { source: Pick<ProbeLive, 'samples'>; only?: readonly string[]; large?: boolean; max?: number }) {
    const { t } = useLang();
    const names = useProbeNames();
    const [open, setOpen] = useState<string | null>(null);
    const stats = channelStats(source);
    const latest = latestValues(source);
    const groups = pairTargets([...stats.keys()].filter((k) => !only || only.includes(k))).slice(0, max);
    return (
        <div className={`grid gap-2 ${large ? 'grid-cols-2 lg:grid-cols-3' : 'grid-cols-2 sm:grid-cols-3'}`}>
            {groups.map((g) => {
                const key = g.join();
                const looks = g.map((c) => names.channel(c));
                // [target, actual]: the actual is the reading, large; the target small beside it.
                const [shownId, besideId] = g.length > 1 ? [g[1], g[0]] : [g[0], null];
                const unit = looks[0].unit;
                return (
                    <button
                        key={key}
                        type="button"
                        onClick={() => setOpen((o) => (o === key ? null : key))}
                        aria-expanded={open === key}
                        {...tid(TEST_ID.valueCard)}
                        className="min-w-0 rounded bg-slate-800/40 px-3 py-2 text-left"
                    >
                        <p className="truncate text-[11px] text-slate-400" title={looks.map((l) => `${l.name} · ${l.ident}`).join('\n')}>
                            {g.length > 1 ? pairTitle(looks[0].name, looks[1].name) : looks[0].name}
                        </p>
                        <p className="flex flex-wrap items-baseline gap-x-2">
                            {besideId && <span className="text-[11px] text-slate-500">{t.graph_actual}</span>}
                            <span className={`font-mono tabular-nums text-slate-100 ${large ? 'text-5xl' : 'text-3xl'}`}>{num(latest.get(shownId))}</span>
                            <span className="text-xs text-slate-500">{unit}</span>
                            {besideId && (
                                <span className="font-mono text-xs tabular-nums text-slate-400">
                                    {t.graph_target} {num(latest.get(besideId))}
                                </span>
                            )}
                        </p>
                        {open === key &&
                            g.map((c) => {
                                const x = stats.get(c);
                                return x ? (
                                    <p key={c} className="truncate font-mono text-[10px] tabular-nums text-slate-500">
                                        {g.length > 1 ? `${c === g[0] ? t.graph_target : t.graph_actual} ` : ''}⌀ {num(x.mean)} · {num(x.min)}–{num(x.max)} · n {x.n}
                                    </p>
                                ) : null;
                            })}
                    </button>
                );
            })}
        </div>
    );
}

/**
 * What a run in progress is taking, as rows: the name, its identifier and the number now. MAIN's
 * while the numbers are large on VISU — the same card is not drawn twice (UX-08).
 */
function ValueRows({ source, only }: { source: Pick<ProbeLive, 'samples'>; only?: readonly string[] }) {
    const names = useProbeNames();
    const latest = latestValues(source);
    const ids = [...channelStats(source).keys()].filter((k) => !only || only.includes(k));
    return (
        <DataList>
            {ids.map((k) => {
                const l = names.channel(k);
                return (
                    <DataRow
                        key={k}
                        name={humanName(l.name)}
                        ident={l.ident}
                        trailing={
                            <span className="shrink-0 font-mono text-xs tabular-nums text-slate-200">
                                {num(latest.get(k))}
                                {l.unit && <span className="ml-1 text-slate-500">{l.unit}</span>}
                            </span>
                        }
                    />
                );
            })}
        </DataList>
    );
}

/**
 * The last run, once it has stopped (UX-07): which run, how long, and each of its values summed up —
 * the most and the mean — with the moments its plan captured. What the board had a second ago does not
 * turn into an empty screen the moment STOP is pressed.
 */
function LastRun({ s, run }: { s: ProbeSessions; run: StoredRun }) {
    const { t } = useLang();
    const names = useProbeNames();
    const secs = Math.max(0, Math.round((run.endedAt - run.startedAt) / 1000));
    const elapsed = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
    const stats = channelStats(run);
    const ids = plannedChannels(s, run).filter((k) => stats.has(k));
    return (
        <Section title={t.part_values} note={t.probe_lastRun(run.n, run.planV, elapsed)}>
            <DataList>
                {ids.map((k) => {
                    const l = names.channel(k);
                    const x = stats.get(k)!;
                    return (
                        <DataRow
                            key={k}
                            name={humanName(l.name)}
                            ident={l.ident}
                            trailing={
                                <span className="shrink-0 font-mono text-[11px] tabular-nums text-slate-200">
                                    {t.readout_max} {num(x.max)} · {t.readout_mean} {num(x.mean)}
                                    {l.unit && <span className="ml-1 text-slate-500">{l.unit}</span>}
                                </span>
                            }
                        />
                    );
                })}
            </DataList>
            {run.captures.length > 0 && <p className="mt-2 text-[11px] text-slate-400">{t.probe_captured(run.captures.length)}</p>}
        </Section>
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
 * open compare part, as bars of how far each value moved for its own spread; otherwise a run in
 * progress, or the last run once it stopped (UX-07); otherwise the assistant's latest words.
 */
export function BoardViz({ s, live }: { s: ProbeSessions; live?: ProbeLive | null }) {
    const { t } = useLang();
    const names = useProbeNames();
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
                {rows.map((x) => {
                    const l = names.channel(x.channel);
                    return (
                        <div key={x.channel} className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)] items-center gap-2">
                            <span className="truncate text-[11px] text-slate-300" title={l.ident}>
                                {l.name}
                            </span>
                            <div className="h-1.5 bg-slate-900">
                                <div className="h-full bg-blue-500/70" style={{ width: `${Math.min(100, Math.round((x.relative ?? 0) * 100))}%` }} />
                            </div>
                        </div>
                    );
                })}
            </div>
        );
    }
    // A run in progress with no graph placed: its own channels, a graph of the first and up to two
    // more as cards (operator, 2026-11-12: VISU went black while recording) — a target and its actual
    // one card (UX-08). With a values part on the board the cards are MAIN's, and the graph has the pane.
    const recording = live && live.sessionId === s.current && live.samples.length > 0 ? live : null;
    const last = !recording && s.current ? s.runs[s.runs.length - 1] : undefined;
    const source = recording ?? last ?? null;
    const message = [...parts].reverse().find((p) => p.kind === 'message');
    if (source && (recording || !message)) {
        // The plan's values only: a block is read whole, but what it was read for is what is shown (D2-4).
        const channels = plannedChannels(s, source);
        const first = channels[0];
        const auto = { id: 'auto', kind: 'graph', open: true, at: 0, channels: [first] } as Part;
        const cardsOnMain = parts.some((p) => p.kind === 'values');
        const rest = channels.slice(1);
        if (!first) return <Awaiting icon={Radar} label={t.awaiting_probe} />;
        return (
            <div className="flex h-full flex-col gap-3">
                <div className={`${cardsOnMain || rest.length === 0 ? 'h-full' : 'h-1/2'} min-h-0 shrink-0`}>
                    <GraphPart part={auto} s={s} live={recording} large />
                </div>
                {!cardsOnMain && rest.length > 0 ? (
                    <div className="min-h-0 flex-1 overflow-hidden">
                        <ValueCards source={source} only={rest} max={2} />
                    </div>
                ) : null}
            </div>
        );
    }
    if (message) {
        return (
            <div className="flex h-full flex-col justify-center gap-2">
                <p className="whitespace-pre-line text-base leading-relaxed text-slate-200">{message.text}</p>
                <Provenance>{t.board_aiWords}</Provenance>
            </div>
        );
    }
    return <Awaiting icon={Radar} label={t.awaiting_probe} />;
}

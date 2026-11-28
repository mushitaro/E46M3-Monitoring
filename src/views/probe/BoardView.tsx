'use client';

import { BoardLayout } from './BoardLayout';
import { ValueCards, channelLabel } from './ValueCards';
export { ValueCards, latestValues } from './ValueCards';
import { formatErrorCode, type ErrorMemoryEntry } from '@tsunagi/ds2-mss54';
import type { RawFaultRead } from '@/hooks/useDs2Link';
import type { ProbeProgress } from '@/hooks/useProbe';
import { DataList, DataRow, Field, Pane, Pill, Provenance, Section, humanName } from '@/components/ui';
import { text as resolveText, type EcuProfile } from '@tsunagi/monitoring-engine';
import { normCode } from '@/lib/faultCode';
import { useLang } from '@/lib/i18n';
import { currentPlan } from '@/lib/notebook/rules';
import { type Part, type PartKind } from '@tsunagi/monitoring-engine';
import { ComparePanel } from './ComparePanel';
import { channelStats, compareRuns, type Comparison } from '@tsunagi/monitoring-engine';
import { ProbeGraph } from './ProbeGraph';
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
/** When a run started, to the minute: the compare line says when the earlier run was (SC04 step 2, F19). */
const when = (ms: number) => new Date(ms).toLocaleString([], { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
/** M/D HH:MM — a run's start, read at a glance. */
const clock = (ms: number) => {
    const d = new Date(ms);
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/**
 * PROBE — the board (operator, 2026-11-02): the parts the assistant placed for the session on the
 * screen, in the owner's order. Each part is drawn from the tab's own data (the engine's probe/board says
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
                        <ValueCards source={live} only={plannedChannels(s, live)} />
                    </Section>
                ) : (
                    <Empty>{t.board_listEmpty}</Empty>
                )}
            </Pane>
        );
    }
    return <BoardLayout parts={parts.map(p => ({
        id: p.id, title: KIND_LABEL[p.kind](t), note: p.title, open: p.open,
        body: () => <PartBody part={p} s={s} data={data} />,
    }))} onMove={s.move} onToggle={s.toggle} />;
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
        // When it was taken, always: 「前回と比べて」 is answered with the day and time of the run before.
        `${r.record === s.current ? '' : `${day(r.startedAt)} `}${clock(r.startedAt)} ${t.run_tag} ${r.n} · v${r.planV}`;

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
                    <Readings s={s} />
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
            return <ComparePanel values={c}
                before={`${when(c.a.startedAt)} ${runLabel({ record: s.current ?? c.a.record, n: c.a.n, planV: c.a.planV, startedAt: c.a.startedAt })}`}
                after={`${when(c.b.startedAt)} ${runLabel({ record: s.current ?? c.b.record, n: c.b.n, planV: c.b.planV, startedAt: c.b.startedAt })}`} />;
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

export function GraphPart({ part, s, live, large = false }: { part: Part; s: ProbeSessions; live: ProbeLive | null | undefined; large?: boolean }) {
    const { t } = useLang();
    const src = sourceOf(s, part, live);
    if (!part.channels?.length) return null;
    if (!src.live && !src.run) return <Empty>{part.run ? t.board_noRunN(part.run) : t.board_noRun}</Empty>;
    return <ProbeGraph part={part} samples={samplesOf(src)} run={src.live?.n ?? src.run!.n} live={!!src.live} large={large} />;
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
        // The plan's values only: a block is read whole, but what it was read for is what is shown (D2-4).
        const channels = plannedChannels(s, recording);
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

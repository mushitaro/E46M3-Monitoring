'use client';

import { ChevronDown, ChevronUp, ChevronsDownUp, ChevronsUpDown } from 'lucide-react';
import { formatErrorCode, type ErrorMemoryEntry } from '@tsunagi/ds2-mss54';
import type { RawFaultRead } from '@/hooks/useDs2Link';
import type { ProbeProgress } from '@/hooks/useProbe';
import { DataList, DataRow, Field, Pane, Pill, Provenance, Section, TextButton, humanName } from '@/components/ui';
import { text as resolveText, type EcuProfile } from '@/lib/ecuCatalog';
import { normCode } from '@/lib/faultCode';
import { useLang } from '@/lib/i18n';
import { currentPlan } from '@/lib/notebook/rules';
import type { Part, PartKind } from '@/lib/probe/board';
import { channelStats, compareRuns, type Comparison } from '@/lib/probe/compare';
import type { StoredRun } from '@/lib/probe/runStore';
import type { ScanRun } from '@/lib/probe/scan';
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
    if (!s.current || parts.length === 0) return <Pane>{null}</Pane>;
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
            const run = runOf(s, p.run);
            if (!run) return <Empty>{p.run ? t.board_noRunN(p.run) : t.board_noRun}</Empty>;
            const stats = [...channelStats(run)].filter(([k]) => !p.channels || p.channels.includes(k));
            return (
                <div className="space-y-1">
                    <p className="font-mono text-[11px] text-slate-500">{runLabel({ record: run.sessionId, n: run.n, planV: run.planV, startedAt: run.startedAt })}</p>
                    <DataList>
                        {stats.map(([k, x]) => (
                            <DataRow
                                key={k}
                                name={humanName('')}
                                ident={k}
                                trailing={
                                    <span className="shrink-0 font-mono text-[11px] tabular-nums text-slate-300">
                                        {num(x.mean)}
                                        <span className="ml-2 text-slate-500">
                                            {num(x.min)}–{num(x.max)} · n {x.n}
                                        </span>
                                    </span>
                                }
                            />
                        ))}
                    </DataList>
                </div>
            );
        }
    }
}

/**
 * PROBE's MULTI: the picture of the board. The first open compare part, as bars of how far each
 * value moved for its own spread; otherwise the assistant's latest words; otherwise nothing.
 */
export function BoardViz({ s }: { s: ProbeSessions }) {
    const { t } = useLang();
    const parts = (s.board?.parts ?? []).filter((p) => p.open);
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
    const message = [...parts].reverse().find((p) => p.kind === 'message');
    if (message) {
        return (
            <div className="flex h-full flex-col justify-center gap-2">
                <p className="whitespace-pre-line text-base leading-relaxed text-slate-200">{message.text}</p>
                <Provenance>{t.board_aiWords}</Provenance>
            </div>
        );
    }
    return null;
}

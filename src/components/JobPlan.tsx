'use client';

import { AlertTriangle, ArrowRight } from 'lucide-react';
import { MicroLabel, Pill } from '@/components/ui';
import { description, jobPreconditions, jobRiskOf, label, type CatalogJob } from '@/lib/ecuCatalog';
import { hasStopControl, jobOperation, type OpKind } from '@/lib/jobOps';
import { bestTelegram, telegramIsCertain, type TelegramTable } from '@/lib/telegrams';
import type { Smg2Procedure, Smg2Workflows } from '@/lib/smg2Workflows';
import { useLang } from '@/lib/i18n';

/**
 * The visualization region for the job views: what the selected job will DO.
 *
 * The other tabs put a measurement here — a fault count, a live trace. A job
 * list has no measurement until you run something, and until then the question
 * the operator actually has is "what happens if I press this". So that is what
 * this answers, in the order you need it:
 *
 *   1. Which job, at what risk.
 *   2. The operation SHAPE — one-shot, held, latching, a program the ECU runs.
 *      This is what decides whether there will be a STOP button.
 *   3. The step plan, in wire order, with the SGBD's own reason for each step.
 *   4. The exact bytes, when they are knowable, and the honest grade when not.
 *   5. What the ECU will say back — for SMG II procedures, the real activity and
 *      result vocabularies rather than a spinner and a number.
 *
 * Nothing here is invented. Where the SGBD is silent the panel says so.
 */

const KIND_TONE: Record<OpKind, 'neutral' | 'primary' | 'caution' | 'danger' | 'secondary'> = {
    read: 'primary',
    pulse: 'neutral',
    hold: 'caution',
    paired: 'caution',
    measurement: 'secondary',
    latching: 'danger',
    compound: 'caution',
    procedure: 'secondary',
    write: 'danger',
    unknown: 'neutral',
};

export function JobPlan({
    job,
    moduleId,
    telegrams,
    workflows,
    procedure,
}: {
    job: CatalogJob;
    moduleId: string;
    telegrams: TelegramTable | null;
    workflows: Smg2Workflows | null;
    /** Set when the selected row is an SMG II test program rather than a job. */
    procedure: Smg2Procedure | null;
}) {
    const { lang, t } = useLang();
    const op = jobOperation(job, moduleId);
    const risk = jobRiskOf(job);
    const d = description(job, lang);
    const tel = bestTelegram(telegrams, job.id);

    return (
        <div className="flex h-full flex-col gap-3 overflow-y-auto pr-1">
            <div>
                <div className="flex items-baseline gap-2">
                    <Pill tone={risk === 'high' ? 'danger' : risk === 'medium' ? 'caution' : 'neutral'}>
                        {risk === 'high' ? t.risk_high : risk === 'medium' ? t.risk_medium : t.risk_low}
                    </Pill>
                    <span className="min-w-0 flex-1 truncate font-mono text-xs text-slate-200">{job.id}</span>
                </div>
                <p className="mt-1 text-[11px] text-slate-400">{label(job, lang)}</p>
                {d.original && <p className="mt-0.5 font-mono text-[10px] text-slate-500">{d.original}</p>}
            </div>

            {/* The shape, stated before anything else — it is what tells you
                whether this ends on its own or you will be holding a live
                output until you stop it. */}
            <div>
                <MicroLabel>{t.plan_kind}</MicroLabel>
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <Pill tone={KIND_TONE[op.kind]}>{t.opKind[op.kind]}</Pill>
                    {hasStopControl(op) && (
                        <span className="text-[10px] text-amber-400">
                            {t.plan_needsStop}
                            {op.stopJob && op.stopJob !== job.id ? ` · ${op.stopJob}` : ''}
                        </span>
                    )}
                </div>
                <p className="mt-1.5 text-[11px] leading-relaxed text-slate-400">{t.opKindNote[op.kind]}</p>
            </div>

            {op.irreversible && (
                <div className="flex items-start gap-2 rounded bg-red-500/10 p-2">
                    <AlertTriangle className="mt-0.5 size-3 shrink-0 text-red-400" />
                    <p className="text-[11px] leading-relaxed text-red-400">
                        {t.op_irreversible[op.irreversible]}
                    </p>
                </div>
            )}

            {/* The plan, in wire order. The `why` is the SGBD's, not ours. */}
            <div>
                <MicroLabel>{t.plan_steps}</MicroLabel>
                <ol className="mt-1.5 space-y-1.5">
                    {op.steps.map((s, i) => (
                        <li key={`${s.job}-${i}`} className="flex items-start gap-2">
                            <span className="mt-0.5 w-4 shrink-0 text-right font-mono text-[10px] text-slate-600">
                                {i + 1}
                            </span>
                            <span className="min-w-0">
                                <span className="font-mono text-[11px] text-blue-400">{s.job}</span>
                                {!s.required && (
                                    <span className="ml-1.5 text-[9px] uppercase tracking-widest text-slate-600">
                                        {t.plan_optional}
                                    </span>
                                )}
                                <span className="block text-[10px] leading-relaxed text-slate-500">
                                    {t.op_why[s.why]}
                                </span>
                            </span>
                        </li>
                    ))}
                </ol>
            </div>

            {(op.ecuTimeoutSec || op.maxHoldSec) && (
                <div className="grid grid-cols-2 gap-x-3">
                    {op.ecuTimeoutSec && <Stat label={t.plan_ecuTimeout} value={`${op.ecuTimeoutSec}s`} />}
                    {op.maxHoldSec && <Stat label={t.plan_maxHold} value={`${op.maxHoldSec}s`} />}
                </div>
            )}

            {/* Arguments. A job that needs them cannot be sent without them, and
                saying which ones is the difference between a blocked button and
                a blocked button you can do something about. */}
            {(job.args ?? []).length > 0 && (
                <div>
                    <MicroLabel>{t.plan_args}</MicroLabel>
                    <ul className="mt-1.5 space-y-0.5">
                        {(job.args ?? []).map((a) => (
                            <li key={a.name} className="flex items-baseline gap-2">
                                <span className="font-mono text-[11px] text-amber-400">{a.name}</span>
                                {a.type && <span className="font-mono text-[9px] text-slate-600">{a.type}</span>}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            <div>
                <MicroLabel>{t.gate_preconditions}</MicroLabel>
                <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
                    {jobPreconditions(job.id).map((c) => (
                        <span key={c} className="text-[10px] text-slate-400">
                            {t[`precond_${c}` as keyof typeof t] as string}
                        </span>
                    ))}
                </div>
            </div>

            {/* The bytes — or the honest reason there are none. A telegram
                shared with other jobs is NOT this job's telegram. */}
            <div>
                <MicroLabel>{t.plan_telegram}</MicroLabel>
                {tel ? (
                    <>
                        <code
                            className={`mt-1.5 block break-all rounded bg-slate-950 p-2 font-mono text-[11px] ${
                                telegramIsCertain(tel) ? 'text-blue-400' : 'text-slate-500'
                            }`}
                        >
                            {tel.hex}
                        </code>
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                            <Pill tone={telegramIsCertain(tel) ? 'ok' : 'caution'}>{t.confidence[tel.confidence]}</Pill>
                            <span className="font-mono text-[9px] text-slate-600">{tel.cmdName}</span>
                        </div>
                        <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
                            {t.confidenceNote[tel.confidence]}
                        </p>
                    </>
                ) : (
                    <p className="mt-1.5 text-[11px] text-slate-500">{t.plan_noTelegram}</p>
                )}
            </div>

            {procedure && <ProcedureDetail procedure={procedure} workflows={workflows} />}
        </div>
    );
}

/**
 * The SMG II extras: how long, what state the engine must be in, and — the part
 * that matters — the two code vocabularies the ECU reports through.
 */
function ProcedureDetail({
    procedure,
    workflows,
}: {
    procedure: Smg2Procedure;
    workflows: Smg2Workflows | null;
}) {
    const { lang, t } = useLang();
    const pick = (x: { ja: string; en: string }) => (lang === 'en' ? x.en : x.ja);

    return (
        <>
            <div className="grid grid-cols-3 gap-x-3 border-t border-slate-800/50 pt-3">
                <Stat label={t.proc_duration} value={procedure.durMax} />
                <Stat
                    label={t.proc_engine}
                    value={procedure.engine === 'run' ? t.proc_engineRun : t.proc_engineOff}
                    tone={procedure.engine === 'run' ? 'text-amber-400' : 'text-slate-300'}
                />
                <Stat label={t.proc_results} value={procedure.readResults ?? '—'} />
            </div>

            <div>
                <MicroLabel>{t.gate_preconditions}</MicroLabel>
                <ul className="mt-1.5 list-disc space-y-1 pl-4">
                    {procedure.prereq.map((p) => (
                        <li key={p.en} className="text-[11px] leading-relaxed text-slate-400">
                            {pick(p)}
                        </li>
                    ))}
                </ul>
            </div>

            {/* The coarse state, shared by every procedure. */}
            {workflows && (
                <CodeTable label={t.proc_status} rows={workflows.testStatus} tone="text-slate-400" />
            )}

            {/* What it will say it is doing. 21 of these for a full gearbox
                adaptation — a progress bar cannot carry that, and without it the
                operator is watching a number climb for three minutes. */}
            <CodeTable label={t.proc_activity} rows={procedure.activity} tone="text-blue-400" />

            {/* What it will say happened. This is the feedback that decides
                whether the car is finished or on a flatbed. */}
            <CodeTable label={t.proc_faults} rows={procedure.faults} tone="text-red-400" />
        </>
    );
}

/**
 * A code vocabulary, collapsed.
 *
 * Full gearbox adaptation carries 21 activity codes and 38 result codes. Open,
 * those 59 rows push the plan — the part you read BEFORE pressing anything — a
 * long way up the scroll, and the panel becomes a reference manual with the
 * controls buried in it. They are reference: you look a code up when the ECU
 * reports one. The count stays visible in the summary, so it is still obvious
 * how much vocabulary this program has.
 */
function CodeTable({
    label: heading,
    rows,
    tone,
}: {
    label: string;
    rows: Array<{ code: string; ja: string; en: string; de?: string }>;
    tone: string;
}) {
    const { lang } = useLang();
    return (
        <details>
            <summary className="flex cursor-pointer items-baseline justify-between text-[9px] font-bold uppercase tracking-widest text-slate-600 hover:text-slate-400">
                {heading}
                <span className="font-mono">{rows.length}</span>
            </summary>
            <ul className="mt-1.5 divide-y divide-slate-800/50">
                {rows.map((r) => (
                    <li key={r.code} className="flex items-baseline gap-2 py-1">
                        <span className={`w-9 shrink-0 font-mono text-[10px] ${tone}`}>{r.code}</span>
                        <span className="min-w-0 text-[10px] leading-relaxed text-slate-400">
                            {lang === 'en' ? r.en : r.ja}
                        </span>
                    </li>
                ))}
            </ul>
        </details>
    );
}

function Stat({ label: heading, value, tone = 'text-slate-300' }: { label: string; value: string; tone?: string }) {
    return (
        <div className="flex flex-col leading-none">
            <span className="text-[8px] uppercase tracking-wider text-slate-600">{heading}</span>
            <span className={`mt-1.5 font-mono text-[11px] font-bold ${tone}`}>{value}</span>
        </div>
    );
}

/**
 * The sequence view: several procedures in a stated order.
 *
 * The order is the one thing here the SGBD does NOT define, and the data says so
 * in its own note. That note is reproduced verbatim rather than being smoothed
 * into a recommendation — "based on inter-step dependencies and service
 * practice, confirm against TIS" is a materially different claim from "run these
 * in this order", and on a gearbox adaptation the difference is expensive.
 */
export function SequenceCard({
    sequence,
    procedures,
    onPick,
}: {
    sequence: { id: string; name: { ja: string; en: string }; note: { ja: string; en: string }; steps: string[] };
    procedures: Smg2Procedure[];
    onPick: (testprg: string) => void;
}) {
    const { lang, t } = useLang();
    const pick = (x: { ja: string; en: string }) => (lang === 'en' ? x.en : x.ja);

    return (
        <div className="py-2">
            <div className="flex items-baseline gap-2">
                <span className="text-[11px] font-bold text-slate-200">{pick(sequence.name)}</span>
                <span className="font-mono text-[9px] text-slate-600">{sequence.steps.length} steps</span>
            </div>
            <p className="mt-1 flex items-start gap-1.5 text-[10px] leading-relaxed text-amber-400/90">
                <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                {pick(sequence.note)}
            </p>
            <ol className="mt-2 flex flex-wrap items-center gap-x-1 gap-y-1">
                {sequence.steps.map((step, i) => {
                    const p = procedures.find((x) => x.id === step);
                    return (
                        <li key={`${step}-${i}`} className="flex items-center gap-1">
                            {i > 0 && <ArrowRight className="size-3 shrink-0 text-slate-700" />}
                            <button
                                type="button"
                                onClick={() => onPick(step)}
                                title={p ? pick(p.name) : step}
                                className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-blue-400 transition-colors hover:bg-slate-700"
                            >
                                {step}
                            </button>
                        </li>
                    );
                })}
            </ol>
            <p className="mt-1.5 text-[9px] uppercase tracking-widest text-slate-600">{t.seq_pickHint}</p>
        </div>
    );
}

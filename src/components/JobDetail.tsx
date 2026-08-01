'use client';

/**
 * What this job is, in the order a car's owner asks it.
 *
 * The panel this replaces opened with the operation shape and the wire plan —
 * correct information, in an engineer's order. An owner's first question is not
 * "is this a pulse or a hold", it is "what happens to my car, and how will I know
 * it worked". So:
 *
 *   0. Anything to know BEFORE pressing (caution), and anything irreversible.
 *   1. does / observe / pass / fail / after — each with its confidence, because a
 *      generated sentence and a written one are different claims.
 *   2. The operation shape, as the four independent axes the classifier carries:
 *      who carries it, how it ends, where the answer is, what must be sent first.
 *      This is the answer to "is it automatic or manual", and it is four answers
 *      because it was never one question.
 *   3. Arguments — as real controls where the SGBD supplies real choices.
 *   4. What it returns, value + unit + plain text folded into one row, filtered
 *      by the argument that selects them.
 *   5. Adjustment values: current / min / factory default / max, and a verdict
 *      that is only ever "inside the stated range or not".
 *   6. The telegram, with its grade.
 *
 * Nothing here is invented. Where the SGBD is silent, the panel says so — and
 * `det_noValues` says it as a first-class state rather than as a blank table.
 */

import { useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight } from 'lucide-react';
import { LABEL, DataList, DataRow, Field, MicroLabel, Pill, Provenance, Section } from '@/components/ui';
import {
    description,
    jobRiskOf,
    label,
    resultsFor,
    text as resolveText,
    verdictFor,
    type CatalogJob,
    type CatalogResult,
    type EcuProfile,
} from '@/lib/ecuCatalog';
import { deliversResultElsewhere, hasStopControl, jobOperation, type OpKind } from '@/lib/jobOps';
import { SLOTS, jobTextFor, resolve, type Confidence, type JobTextTable } from '@/lib/jobText';
import { bestTelegram, telegramIsCertain, type TelegramTable } from '@/lib/telegrams';
import type { Smg2Procedure, Smg2Workflows } from '@/lib/smg2Workflows';
import { useLang } from '@/lib/i18n';

const KIND_TONE: Record<OpKind, 'neutral' | 'primary' | 'caution' | 'danger' | 'secondary'> = {
    read: 'primary',
    pulse: 'neutral',
    hold: 'caution',
    paired: 'caution',
    measurement: 'secondary',
    latching: 'danger',
    compound: 'caution',
    procedure: 'secondary',
    deferred: 'secondary',
    write: 'danger',
    unknown: 'neutral',
};

export function JobDetail({
    profile,
    job,
    jobText,
    telegrams,
    workflows,
    procedure,
}: {
    profile: EcuProfile;
    job: CatalogJob;
    jobText: JobTextTable | null;
    telegrams: TelegramTable | null;
    workflows: Smg2Workflows | null;
    /** Set when the selected row is an SMG II test program rather than an SGBD job. */
    procedure: Smg2Procedure | null;
}) {
    const { lang, t } = useLang();
    const op = jobOperation(job);
    const risk = jobRiskOf(job);
    const d = description(profile, job, lang);
    const tel = bestTelegram(telegrams, job.id);
    // An adapted SMG II procedure has no jobtext entry of its own — it is not an
    // SGBD job. It IS `TESTPRG_STARTEN` with a program number, so it inherits
    // that job's written explanation rather than showing five "not written" rows.
    const entry = jobTextFor(jobText, job.id) ?? (procedure ? jobTextFor(jobText, 'TESTPRG_STARTEN') : null);

    // The argument values the operator has chosen. They decide which results come
    // back — ADAPTIONSWERTE_LESEN declares 216 and returns about 30 of them.
    const [argValues, setArgValues] = useState<Record<string, string>>({});
    const results = useMemo(() => resultsFor(job, argValues), [job, argValues]);

    const caution = resolve(entry, 'caution', lang);

    return (
        <div className="flex h-full flex-col gap-5 overflow-y-auto pr-1">
            <header>
                <div className="flex items-baseline gap-2">
                    <Pill tone={risk === 'high' ? 'danger' : risk === 'medium' ? 'caution' : 'neutral'}>
                        {t.risk_label[risk]}
                    </Pill>
                    <span className="min-w-0 flex-1 truncate font-mono text-xs text-slate-200">{job.id}</span>
                </div>
                <p className="mt-1 text-[11px] text-slate-300">{label(job, lang)}</p>
                {procedure && (
                    <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
                        {lang === 'en' ? procedure.desc.en : procedure.desc.ja}
                    </p>
                )}
                {/* The German original, always. The ja/en are machine translations
                    and at least one shipped wrong: DSC's STEUERN_DIGITAL renders as
                    "デジタル" for a job that drives eight solenoids and a pump. */}
                {d.original && <p className="mt-0.5 font-mono text-[10px] text-slate-500">{d.original}</p>}
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <Provenance title={t.jobClassNote[job.class]}>{t.jobClass[job.class]}</Provenance>
                    <Provenance title={t.audienceNote[job.audience]}>{t.audience[job.audience]}</Provenance>
                    <Provenance>{t.system[job.system] ?? job.system}</Provenance>
                </div>
                {job.note && <p className="mt-1.5 font-mono text-[10px] leading-relaxed text-slate-500">{job.note}</p>}
            </header>

            {/* Read before pressing, so it is placed before pressing. */}
            {caution.confidence !== 'missing' && (
                <Callout tone="caution" text={caution.text} />
            )}
            {op.irreversible && <Callout tone="danger" text={t.op_irreversible[op.irreversible]} />}

            {/* 1. The five questions. */}
            <div className="flex flex-col gap-3">
                {SLOTS.map((slot) => (
                    <Explanation
                        key={slot}
                        heading={t.jt[slot]}
                        resolved={resolve(entry, slot, lang, d.original)}
                    />
                ))}
            </div>

            {/* 2. The operation shape — four axes, because it was never one. */}
            <Section title={t.plan_kind}>
                <div className="flex flex-wrap items-center gap-2">
                    <Pill tone={KIND_TONE[op.kind]}>{t.opKind[op.kind]}</Pill>
                    {hasStopControl(op) && (
                        <span className="text-[11px] text-amber-400">
                            {t.plan_needsStop}
                            {op.stopJob && op.stopJob !== job.id ? ` · ${op.stopJob}` : ''}
                        </span>
                    )}
                    <Provenance title={t.provenance[job.op.provenance]}>{t.provenance[job.op.provenance]}</Provenance>
                </div>
                <p className="mt-1.5 text-[11px] leading-relaxed text-slate-400">{t.opKindNote[op.kind]}</p>

                <dl className="mt-3 flex flex-col gap-1.5">
                    <Axis term={t.op_actor} value={t.actor[op.actor]} />
                    <Axis term={t.op_termination} value={t.termination[op.termination]} />
                    <Axis term={t.op_delivery} value={t.delivery[op.resultDelivery]} />
                    {(job.op.prerequisiteJobs ?? []).length > 0 && (
                        <Axis term={t.op_prerequisites} value={(job.op.prerequisiteJobs ?? []).join(' → ')} mono />
                    )}
                </dl>

                {/* Half of a two-job test is a trap, so the companion is named
                    where you cannot miss it, not only inside the step list. */}
                {deliversResultElsewhere(op) && op.resultJob && (
                    <p className="mt-2 flex items-center gap-1.5 text-[11px] text-blue-400">
                        <ArrowRight className="size-3 shrink-0" />
                        {t.op_resultJob(op.resultJob)}
                    </p>
                )}

                <ol className="mt-3 space-y-1.5">
                    {op.steps.map((s, i) => (
                        <li key={`${s.job}-${i}`} className="flex items-start gap-2">
                            <span className="mt-0.5 w-4 shrink-0 text-right font-mono text-[11px] text-slate-600">
                                {i + 1}
                            </span>
                            <span className="min-w-0">
                                <span className="font-mono text-[11px] text-blue-400">{s.job}</span>
                                <span className="block text-[11px] leading-relaxed text-slate-500">
                                    {t.op_why[s.why]}
                                </span>
                            </span>
                        </li>
                    ))}
                </ol>

                {(op.ecuTimeoutSec || op.maxHoldSec || job.preconditions.length > 0) && (
                    <div className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1.5">
                        {op.ecuTimeoutSec && <Field label={t.plan_ecuTimeout} value={op.ecuTimeoutSec} unit="s" />}
                        {op.maxHoldSec && <Field label={t.plan_maxHold} value={op.maxHoldSec} unit="s" />}
                        {job.preconditions.map((c) => (
                            <span key={c} className="text-[11px] text-amber-400">
                                {(t[`precond_${c}` as keyof typeof t] as string) ?? c}
                            </span>
                        ))}
                    </div>
                )}
            </Section>

            {/* 3. Arguments, as controls where the SGBD supplies real choices. */}
            {job.args.length > 0 && (
                <Section title={t.det_args} count={job.args.length}>
                    <div className="flex flex-col gap-2">
                        {job.args.map((a) => {
                            const c = resolveText(profile, a.comment, lang);
                            return (
                                <div key={a.name}>
                                    <div className="flex items-baseline gap-2">
                                        <span className="font-mono text-[11px] text-amber-400">{a.name}</span>
                                        <span className="font-mono text-[10px] text-slate-600">{a.type}</span>
                                    </div>
                                    {c.text && <p className="mt-0.5 text-[11px] text-slate-500">{c.text}</p>}
                                    {a.options ? (
                                        <select
                                            value={argValues[a.name] ?? ''}
                                            onChange={(e) =>
                                                setArgValues((p) => ({ ...p, [a.name]: e.target.value }))
                                            }
                                            className="mt-1 w-full max-w-full cursor-pointer rounded bg-slate-800 px-2 py-1 font-mono text-[11px] text-slate-200 outline-none focus:ring-1 focus:ring-blue-500/60"
                                        >
                                            <option value="" className="bg-slate-900">
                                                —
                                            </option>
                                            {a.options.map((o) => (
                                                <option key={o.value} value={o.value} className="bg-slate-900">
                                                    {o.value}
                                                    {o.note ? ` · ${o.note}` : ''}
                                                </option>
                                            ))}
                                        </select>
                                    ) : (
                                        <input
                                            value={argValues[a.name] ?? ''}
                                            onChange={(e) =>
                                                setArgValues((p) => ({ ...p, [a.name]: e.target.value }))
                                            }
                                            placeholder={a.type}
                                            className="mt-1 w-full rounded bg-slate-800 px-2 py-1 font-mono text-[11px] text-slate-200 outline-none placeholder:text-slate-600 focus:ring-1 focus:ring-blue-500/60"
                                        />
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </Section>
            )}

            {/* 4. The contents. This is the part that used to be entirely absent:
                   schema 1 emitted no results at all, for any job. */}
            {results.length > 0 && (
                <Section
                    title={t.det_results}
                    count={results.length}
                    note={job.results.length !== results.length ? t.det_results_note : undefined}
                >
                    <ResultList profile={profile} job={job} results={results} />
                </Section>
            )}

            {/* 5. Adjustment values. The note about the factory default belongs
                to the TABLE, not to the section — on the ~300 jobs that publish
                no limits it was a paragraph explaining a column that was not
                there. */}
            <Section title={t.det_values}>
                <SpecTable profile={profile} job={job} results={results} />
            </Section>

            {/* 6. The bytes — or the honest reason there are none. */}
            <Section title={t.plan_telegram}>
                {tel ? (
                    <>
                        <code
                            className={`block break-all rounded bg-slate-950 p-2 font-mono text-[11px] ${
                                telegramIsCertain(tel) ? 'text-blue-400' : 'text-slate-500'
                            }`}
                        >
                            {tel.hex}
                        </code>
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                            <Pill tone={telegramIsCertain(tel) ? 'ok' : 'caution'}>{t.confidence[tel.confidence]}</Pill>
                            <span className="font-mono text-[10px] text-slate-600">{tel.cmdName}</span>
                        </div>
                        <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
                            {t.confidenceNote[tel.confidence]}
                        </p>
                    </>
                ) : (
                    <p className="text-[11px] leading-relaxed text-slate-500">{t.plan_noTelegram}</p>
                )}
            </Section>

            {procedure && <ProcedureDetail procedure={procedure} workflows={workflows} />}
        </div>
    );
}

/** One of the five questions, with the confidence of the answer beside it. */
function Explanation({
    heading,
    resolved,
}: {
    heading: string;
    resolved: { text: string; confidence: Confidence; original?: string };
}) {
    const { t } = useLang();
    const missing = resolved.confidence === 'missing';
    return (
        <div>
            <div className="flex items-baseline justify-between gap-3">
                <MicroLabel>{heading}</MicroLabel>
                <Provenance title={t.jt_confidenceNote[resolved.confidence]}>
                    {t.jt_confidence[resolved.confidence]}
                </Provenance>
            </div>
            {missing ? (
                // Never a blank. A blank reads as "nothing to say here", which is
                // a different claim from "nobody has written this yet".
                <div className="mt-1">
                    <p className="text-[11px] italic text-slate-500">{t.jt_missing}</p>
                    {resolved.original && (
                        <p className="mt-0.5 font-mono text-[10px] leading-relaxed text-slate-500">
                            {resolved.original}
                        </p>
                    )}
                </div>
            ) : (
                <p className="mt-1 text-[11px] leading-relaxed text-slate-300">{stripEmphasis(resolved.text)}</p>
            )}
        </div>
    );
}

/**
 * The authored text uses `**` for the sentences that must not be skimmed past.
 * Rendered as a strong span rather than passed through a markdown parser — one
 * marker, one meaning, no chance of a stray asterisk becoming an italic run in
 * safety copy.
 */
function stripEmphasis(s: string): React.ReactNode {
    const parts = s.split(/\*\*(.+?)\*\*/g);
    return parts.map((p, i) =>
        i % 2 === 1 ? (
            <strong key={i} className="font-bold text-amber-300">
                {p}
            </strong>
        ) : (
            p
        ),
    );
}

function Axis({ term, value, mono = false }: { term: string; value: string; mono?: boolean }) {
    return (
        <div className="flex items-baseline gap-2">
            <dt className={`w-[9rem] shrink-0 ${LABEL} text-slate-600`}>
                {term}
            </dt>
            <dd className={`min-w-0 flex-1 text-[11px] text-slate-300 ${mono ? 'font-mono' : ''}`}>{value}</dd>
        </div>
    );
}

function Callout({ tone, text }: { tone: 'caution' | 'danger'; text: string }) {
    const cls = tone === 'danger' ? 'bg-red-500/10 text-red-400' : 'bg-amber-500/10 text-amber-400';
    return (
        <div className={`flex items-start gap-2 rounded p-2 ${cls}`}>
            <AlertTriangle className="mt-0.5 size-3 shrink-0" />
            <p className="text-[11px] leading-relaxed">{stripEmphasis(text)}</p>
        </div>
    );
}

/**
 * The results, with the value/unit/text triple folded back into one row.
 *
 * The SGBD returns `X_WERT`, `X_EINH` and `X_TEXT` as three flat siblings. Schema
 * 1 dropped the last two, which threw away both the dimension of every number and
 * `LESEN_SYSTEMCHECK_DMTL_TEXT` — the ECU's own plain-language verdict on the
 * tank-leak test, and the most owner-facing string in the whole dataset.
 */
function ResultList({
    profile,
    job,
    results,
}: {
    profile: EcuProfile;
    job: CatalogJob;
    results: CatalogResult[];
}) {
    const { lang, t } = useLang();
    const shown = new Set(results.map((r) => r.name));

    return (
        <DataList>
            {results
                // A unit or text row whose value row is present is already folded
                // into it; showing it again is the flat list we came from.
                .filter((r) => !(r.valueOf && shown.has(r.valueOf)))
                .map((r) => {
                    const c = resolveText(profile, r.comment, lang);
                    const unit = job.results.find((x) => x.name === r.unitRes);
                    const verdict = r.textRes ? job.results.find((x) => x.name === r.textRes) : undefined;
                    return (
                        <DataRow
                            key={r.name}
                            title={r.name}
                            subtitle={c.text || undefined}
                            trailing={
                                <span className="shrink-0 font-mono text-[10px] text-slate-600">
                                    {t.resultRole[r.role]}
                                </span>
                            }
                            detail={
                                <>
                                    {c.original && c.original !== c.text && (
                                        <p className="font-mono text-[10px] leading-relaxed text-slate-500">
                                            {c.original}
                                        </p>
                                    )}
                                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                                        {unit && (
                                            <span className="font-mono text-[10px] text-slate-500">
                                                {t.resultRole.unit}: {unit.name}
                                            </span>
                                        )}
                                        {verdict && (
                                            <span className="font-mono text-[10px] text-blue-400">
                                                {t.resultRole.text}: {verdict.name}
                                            </span>
                                        )}
                                        {r.whenArg && (
                                            <span className="text-[10px] text-slate-500">
                                                {t.det_whenArg(r.whenArg.arg, r.whenArg.values.join(', '))}
                                                <span className="ml-1 text-slate-600">({t.det_inferred})</span>
                                            </span>
                                        )}
                                    </div>
                                </>
                            }
                        />
                    );
                })}
        </DataList>
    );
}

/**
 * Current / min / factory default / max, and a verdict that is only ever
 * "inside the stated range or not".
 *
 * `spec_current` is empty and says why: reading it needs a run, and running is
 * not unlocked. Showing an em-dash with no explanation would read as "the value
 * is unknown to the ECU", which is a different and wrong claim.
 */
function SpecTable({
    profile,
    job,
    results,
}: {
    profile: EcuProfile;
    job: CatalogJob;
    results: CatalogResult[];
}) {
    const { lang, t } = useLang();
    const specced = results.filter((r) => r.spec);
    const cross = job.crossFieldConstraints ?? [];

    if (specced.length === 0 && cross.length === 0) {
        return <p className="text-[11px] leading-relaxed text-slate-500">{t.det_noValues}</p>;
    }

    return (
        <>
            <p className="mb-1 text-[11px] leading-relaxed text-slate-500">{t.spec_defaultNote}</p>
            <p className="mb-2 text-[11px] leading-relaxed text-slate-500">{t.spec_needsRun}</p>
            <DataList>
                {specced.map((r) => {
                    const s = r.spec!;
                    const src = resolveText(profile, s.source, lang);
                    return (
                        <DataRow
                            key={r.name}
                            title={r.name}
                            trailing={
                                <Pill tone="neutral">{t.spec_verdict[verdictFor(s, undefined)]}</Pill>
                            }
                            detail={
                                <>
                                    <div className="grid grid-cols-4 gap-x-2">
                                        <Field label={t.spec_current} value="—" stacked tone="text-slate-600" />
                                        <Field
                                            label={t.spec_min}
                                            value={s.min ?? '—'}
                                            stacked
                                            tone="text-slate-300"
                                        />
                                        <Field
                                            label={s.always !== undefined ? t.spec_always : t.spec_default}
                                            value={s.always ?? s.default ?? '—'}
                                            stacked
                                            tone="text-slate-300"
                                        />
                                        <Field
                                            label={t.spec_max}
                                            value={s.max ?? '—'}
                                            unit={s.unit}
                                            stacked
                                            tone="text-slate-300"
                                        />
                                    </div>
                                    {src.original && (
                                        <p className="font-mono text-[10px] leading-relaxed text-slate-500">
                                            {src.original}
                                        </p>
                                    )}
                                </>
                            }
                        />
                    );
                })}
                {cross.map((c, i) => {
                    const src = resolveText(profile, c.source, lang);
                    return (
                        <DataRow
                            key={`cross-${i}`}
                            title={c.between.join(' − ')}
                            detail={
                                <>
                                    <p className="text-[11px] text-slate-400">
                                        {t.spec_crossField(c.between[0], c.between[1])}
                                    </p>
                                    <div className="grid grid-cols-4 gap-x-2">
                                        <Field label={t.spec_current} value="—" stacked tone="text-slate-600" />
                                        <Field label={t.spec_min} value={c.min ?? '—'} stacked tone="text-slate-300" />
                                        <Field label={t.spec_default} value="—" stacked tone="text-slate-600" />
                                        <Field
                                            label={t.spec_max}
                                            value={c.max ?? '—'}
                                            unit={c.unit}
                                            stacked
                                            tone="text-slate-300"
                                        />
                                    </div>
                                    {src.original && (
                                        <p className="font-mono text-[10px] leading-relaxed text-slate-500">
                                            {src.original}
                                        </p>
                                    )}
                                </>
                            }
                        />
                    );
                })}
            </DataList>
        </>
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
                <Field label={t.proc_duration} value={procedure.durMax} stacked />
                <Field
                    label={t.proc_engine}
                    value={procedure.engine === 'run' ? t.proc_engineRun : t.proc_engineOff}
                    stacked
                    tone={procedure.engine === 'run' ? 'text-amber-400' : 'text-slate-300'}
                />
                <Field label={t.proc_results} value={procedure.readResults ?? '—'} stacked />
            </div>

            <Section title={t.gate_preconditions} count={procedure.prereq.length}>
                <ul className="list-disc space-y-1 pl-4">
                    {procedure.prereq.map((p) => (
                        <li key={p.en} className="text-[11px] leading-relaxed text-slate-400">
                            {pick(p)}
                        </li>
                    ))}
                </ul>
            </Section>

            {workflows && <CodeTable label={t.proc_status} rows={workflows.testStatus} tone="text-slate-400" />}
            {/* 21 activity codes for a full gearbox adaptation. A progress bar
                cannot carry that, and without it the operator watches a number
                climb for three minutes. */}
            <CodeTable label={t.proc_activity} rows={procedure.activity} tone="text-blue-400" />
            {/* 38 result codes. This is the feedback that decides whether the car
                is finished or on a flatbed. */}
            <CodeTable label={t.proc_faults} rows={procedure.faults} tone="text-red-400" />
        </>
    );
}

/** A code vocabulary, collapsed. Reference: you look a code up when the ECU reports one. */
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
            <summary className={`flex cursor-pointer items-baseline justify-between ${LABEL} text-slate-500 hover:text-slate-300`}>
                {heading}
                <span className="font-mono tabular-nums text-slate-600">{rows.length}</span>
            </summary>
            <DataList className="mt-1.5">
                {rows.map((r) => (
                    <DataRow
                        key={r.code}
                        title={<span className={tone}>{r.code}</span>}
                        subtitle={lang === 'en' ? r.en : r.ja}
                    />
                ))}
            </DataList>
        </details>
    );
}

/**
 * The sequence view: several procedures in a stated order.
 *
 * The order is the one thing here the SGBD does NOT define, and the data says so
 * in its own note. That note is reproduced verbatim rather than smoothed into a
 * recommendation — "based on inter-step dependencies and service practice,
 * confirm against TIS" is a materially different claim from "run these in this
 * order", and on a gearbox adaptation the difference is expensive.
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
        <li className="px-2 py-2">
            <div className="flex items-baseline gap-2">
                <span className="text-[11px] font-bold text-slate-200">{pick(sequence.name)}</span>
                <span className="font-mono text-[10px] tabular-nums text-slate-600">{sequence.steps.length}</span>
            </div>
            <p className="mt-1 flex items-start gap-1.5 text-[11px] leading-relaxed text-amber-400/90">
                <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                {pick(sequence.note)}
            </p>
            <ol className="mt-2 flex flex-wrap items-center gap-1">
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
            <p className={`mt-1.5 ${LABEL} text-slate-600`}>{t.seq_pickHint}</p>
        </li>
    );
}

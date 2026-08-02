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

import { useCallback, useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight } from 'lucide-react';
import { LABEL, DataList, DataRow, Field, MicroLabel, Pill, Provenance, Section, emphasise, humanName } from '@/components/ui';
import {
    description,
    jobIndex,
    jobRiskOf,
    label,
    resultsFor,
    text as resolveText,
    verdictFor,
    type CatalogJob,
    type CatalogResult,
    type EcuProfile,
} from '@/lib/ecuCatalog';
import { deliversResultElsewhere, hasStopControl, operationFor, type OpKind } from '@/lib/jobOps';
import { cautionFor, type JobTextTable } from '@/lib/jobText';
import { bestTelegram, telegramIsCertain, type TelegramTable } from '@/lib/telegrams';
import { readResultsFor, type ResultBlockRef, type Smg2Procedure, type Smg2Sequence, type Smg2Workflows } from '@/lib/smg2Workflows';
import { GATE_CODE, GATE_OF, GEARS, MEASURES, PASSES, gearWindows } from '@/lib/gearWindows';
import { stepsFromActivity, stepsFromSequence } from '@/lib/procedureSteps';
import { StepList } from '@/components/StepList';
import { useLang } from '@/lib/i18n';
import type { RunVerdict } from '@/lib/runGate';
import type { JobRunResult } from '@/hooks/useDs2Link';

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
    runVerdict,
    lastRun,
}: {
    profile: EcuProfile;
    job: CatalogJob;
    jobText: JobTextTable | null;
    telegrams: TelegramTable | null;
    workflows: Smg2Workflows | null;
    /** Set when the selected row is an SMG II test program rather than an SGBD job. */
    procedure: Smg2Procedure | null;
    /** Why this can or cannot be sent to a car. The same verdict the hub renders. */
    runVerdict?: RunVerdict | null;
    /** What the last run of THIS job returned, if there was one. */
    lastRun?: JobRunResult | null;
}) {
    const { lang, t } = useLang();
    const op = operationFor(job);
    const risk = jobRiskOf(job);
    const d = description(profile, job, lang);
    const tel = bestTelegram(telegrams, job.id);
    // An adapted SMG II procedure has no jobtext entry of its own — it is not an
    // SGBD job. It IS `TESTPRG_STARTEN` with a program number, so it inherits
    // that job's caution.
    const caution =
        cautionFor(jobText, job.id, lang) ??
        (procedure ? cautionFor(jobText, 'TESTPRG_STARTEN', lang) : null);

    // The argument values the operator has chosen. They decide which results come
    // back — ADAPTIONSWERTE_LESEN declares 216 and returns about 30 of them.
    const [argValues, setArgValues] = useState<Record<string, string>>({});
    const results = useMemo(() => resultsFor(job, argValues), [job, argValues]);

    // An argument value the SGBD offers that no named result is bound to.
    //
    // `ADAPTIONSWERTE_LESEN = 2` is the one that exists: the SGBD names it
    // ("Getriebedaten lesen, Argument: 2") and INPA calls it, yet not one of the
    // 216 declared results carries a `whenArg` of 2 — the block comes back as raw
    // `DATEN` and nothing else. Silently showing four generic rows would read as
    // "this value returns almost nothing", which is a different claim from "the
    // SGBD declares no fields for it". Written as a rule over the data, not as a
    // case for this job, so any other such value says the same thing.
    const unboundArgValues = useMemo(() => {
        const out: Array<{ arg: string; value: string }> = [];
        for (const [arg, value] of Object.entries(argValues)) {
            if (!value) continue;
            const partitioned = job.results.filter((r) => r.whenArg?.arg === arg);
            if (partitioned.length === 0) continue; // this argument does not split the results
            if (partitioned.some((r) => r.whenArg!.values.includes(value))) continue;
            out.push({ arg, value });
        }
        return out;
    }, [job, argValues]);

    return (
        <div className="flex h-full flex-col gap-5 overflow-y-auto pr-1">
            <header>
                {/* Name first, identifier second — the same rule the rows follow.
                    This is the panel's headline, and it was the loudest instance
                    of the inversion: `job.id` in bright monospace with the name
                    demoted to a smaller line underneath it. */}
                <div className="flex items-baseline gap-2">
                    <Pill tone={risk === 'high' ? 'danger' : risk === 'medium' ? 'caution' : 'neutral'}>
                        {t.risk_label[risk]}
                    </Pill>
                    <span className="min-w-0 flex-1 text-xs text-slate-200">{label(job, lang)}</span>
                </div>
                <p className="mt-1 font-mono text-[11px] text-slate-500">{job.id}</p>
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
            {caution && <Callout tone="caution" text={caution} />}
            {op.irreversible && <Callout tone="danger" text={t.op_irreversible[op.irreversible]} />}

            {/* 2. The operation shape — four axes, because it was never one. */}
            <Section title={t.plan_kind}>
                <div className="flex flex-wrap items-center gap-2">
                    <Pill tone={KIND_TONE[op.kind]}>{t.opKind[op.kind]}</Pill>
                    {hasStopControl(op) && (
                        <span className="text-[11px] text-amber-400">
                            {t.plan_needsStop}
                            {/* When stopping is the same job with a different
                                argument, say the ARGUMENT — naming `INAKTIV` as
                                if it were a job is what this replaced. */}
                            {op.stopArgs
                                ? ` · ${Object.entries(op.stopArgs).map(([k, v]) => `${k}=${v}`).join(', ')}`
                                : op.stopJob && op.stopJob !== job.id
                                  ? ` · ${op.stopJob}`
                                  : ''}
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
                                    {emphasise(t.op_why[s.why])}
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
                                    {/* What it asks for, then what it is called. */}
                                    <div className="text-xs text-slate-200">{c.text || a.name}</div>
                                    <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2">
                                        <span className="font-mono text-[11px] text-amber-400">{a.name}</span>
                                        <span className="font-mono text-[10px] text-slate-600">{a.type}</span>
                                        {/* Where the choices came from — and, when the SGBD
                                            itself bounds them, which rows we dropped and why.
                                            A truncated option list that does not say it is
                                            truncated is the 192-jobs mistake in miniature. */}
                                        {a.optionsFrom && (
                                            <Provenance title={a.optionsFrom.why}>
                                                {a.optionsFrom.table ?? t.det_optionsFromComment}
                                            </Provenance>
                                        )}
                                    </div>
                                    {a.optionsFrom?.dropped && (
                                        <p className="mt-0.5 text-[10px] leading-relaxed text-slate-500">
                                            {t.det_optionsDropped(a.optionsFrom.dropped.join(' / '))}
                                        </p>
                                    )}
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
                    {unboundArgValues.map((u) => (
                        <p
                            key={`${u.arg}=${u.value}`}
                            className="mb-2 text-[11px] leading-relaxed text-slate-500"
                        >
                            {t.det_argBindsNoResults(u.arg, u.value)}
                        </p>
                    ))}
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
                {/* Why this will or will not go out. The same verdict the hub
                    renders, from the same call — so the button and the panel
                    cannot tell the operator different things. */}
                {runVerdict && !runVerdict.allowed && (
                    <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
                        {t.runBlock[runVerdict.reason]}
                    </p>
                )}
            </Section>

            {/* 7. What came back, if it has been run. */}
            {lastRun && (
                <Section title={t.run_result}>
                    <div className="flex flex-col gap-2">
                        <Field label={t.run_request} labelKind="data" stacked value={lastRun.request} />
                        <Field
                            label={t.run_response}
                            labelKind="data"
                            stacked
                            value={lastRun.response || '—'}
                            unit={`${lastRun.payloadLength} B`}
                        />
                    </div>
                    {/* The payload is shown raw and stays raw. See the note. */}
                    <p className="mt-2 text-[11px] leading-relaxed text-slate-500">{t.run_undecoded}</p>
                </Section>
            )}

            {procedure && <ProcedureDetail profile={profile} procedure={procedure} workflows={workflows} />}
        </div>
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
            <p className="text-[11px] leading-relaxed">{emphasise(text)}</p>
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
                            name={c.text}
                            ident={r.name}
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
                            // ResultList two hundred lines up already resolves this
                            // comment; SpecTable simply never did, so the one table
                            // whose whole subject is a value shipped with nothing
                            // but `STAT_WDK1_NORM_WERT` to name it.
                            name={resolveText(profile, r.comment, lang).text}
                            ident={r.name}
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
                            name={humanName(t.spec_crossField(c.between[0], c.between[1]))}
                            ident={c.between.join(' − ')}
                            detail={
                                <>
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
 * An SMG II procedure: what it will actually do, step by step.
 *
 * The 21 activity codes of a complete gearbox adaptation ARE the procedure —
 * `Waehlwinkeloffsetstromadaption`, then `Gang 1 ausmessen` through
 * `Gang R ausmessen`, then `In NV-RAM schreiben`. They were a collapsed
 * reference table; they are the answer to "what happens when I press this".
 */
function ProcedureDetail({
    profile,
    procedure,
    workflows,
}: {
    profile: EcuProfile;
    procedure: Smg2Procedure;
    workflows: Smg2Workflows | null;
}) {
    const { lang, t } = useLang();
    const pick = (x: { ja: string; en: string }) => (lang === 'en' ? x.en : x.ja);
    const plan = useMemo(() => stepsFromActivity(procedure, lang), [procedure, lang]);
    const block = readResultsFor(procedure);

    return (
        <>
            <div className="grid grid-cols-2 gap-x-3 border-t border-slate-800/50 pt-3">
                <Field label={t.proc_duration} value={procedure.durMax || '—'} stacked />
                <Field
                    label={t.proc_engine}
                    value={procedure.engine === 'run' ? t.proc_engineRun : t.proc_engineOff}
                    stacked
                    tone={procedure.engine === 'run' ? 'text-amber-400' : 'text-slate-300'}
                />
            </div>

            {/* A fact the SGBD tables do not carry — that 0x07/0x0B sweep every
                gear automatically, that 0x0A engages one and learns nothing. */}
            {procedure.note && (
                <p className="text-[11px] leading-relaxed text-slate-300">{emphasise(pick(procedure.note))}</p>
            )}

            <Section title={t.proc_steps}>
                <StepList plan={plan} />
            </Section>

            {/* What it wrote, and where to read it back. Six of the fourteen
                procedures write nothing readable, and each says why in its own
                words — the reasons genuinely differ, so a shared sentence would
                be the templated text this rework exists to remove. */}
            {block ? (
                <RecordedValues profile={profile} block={block} />
            ) : (
                <Section title={t.proc_results}>
                    <p className="text-[11px] leading-relaxed text-slate-500">
                        {procedure.readResultsNote
                            ? emphasise(pick(procedure.readResultsNote))
                            : t.det_noValues}
                    </p>
                    {/* The number this procedure hands back, and what it should
                        be. Shown before it has been run, because "what am I
                        looking for" is the question you have BEFORE pressing —
                        and because this app cannot run the procedure yet, so the
                        band is the whole of what it can honestly offer here. */}
                    {procedure.reading && (
                        <div className="mt-3">
                            <MicroLabel>{t.proc_expectedReading}</MicroLabel>
                            <div className="mt-1.5 flex flex-wrap items-baseline gap-x-6 gap-y-2">
                                <Field
                                    label={t.proc_band}
                                    value={`${procedure.reading.band.min} – ${procedure.reading.band.max}`}
                                    unit={procedure.reading.unit}
                                />
                                <Field
                                    label={t.proc_readingFrom}
                                    labelKind="data"
                                    value={procedure.reading.result}
                                />
                            </div>
                            <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">
                                {pick(procedure.reading.note)}
                            </p>
                            <Provenance title={procedure.reading.source}>{t.det_sgbdComment}</Provenance>
                        </div>
                    )}
                </Section>
            )}

            <Section title={t.gate_preconditions} count={procedure.prereq.length}>
                <ul className="list-disc space-y-1 pl-4">
                    {procedure.prereq.map((p) => (
                        <li key={p.en} className="text-[11px] leading-relaxed text-slate-400">
                            {pick(p)}
                        </li>
                    ))}
                </ul>
            </Section>

            {/* Reference, not an operating surface: you look a code up when the
                ECU reports one. Collapsed, and the German leads on the faults —
                their `ja` is machine-mangled and the `de` is clean. */}
            {workflows && <CodeTable label={t.proc_status} rows={workflows.testStatus} tone="neutral" />}
            <CodeTable label={t.proc_faults} rows={procedure.faults} tone="danger" />
        </>
    );
}

/**
 * The values a procedure recorded, read back from the adaptation block it wrote.
 *
 * Two tables, because the block holds two genuinely different kinds of thing:
 *
 *   - the gate positions and offsets, which the SGBD gives factory defaults and
 *     sometimes min/max for — ordinary `SpecTable`;
 *   - the 42 per-gear measurement windows, which have NO stated limits at all
 *     and are only comparable against each other and against a previous read.
 *     Those become a 7-row gear grid, not 42 flat rows.
 */
function RecordedValues({ profile, block }: { profile: EcuProfile; block: ResultBlockRef }) {
    const { t } = useLang();
    const job = jobIndex(profile).get(block.job);
    const rows = useMemo(
        () => (job ? resultsFor(job, { [block.arg]: block.value }) : []),
        [job, block.arg, block.value],
    );
    const grid = useMemo(() => gearWindows(rows), [rows]);

    if (!job) {
        return (
            <Section title={t.proc_results}>
                <p className="text-[11px] text-slate-500">{t.det_noValues}</p>
            </Section>
        );
    }

    return (
        <Section
            title={t.proc_results}
            count={rows.length}
            actions={
                <Provenance title={t.det_blockInferred(block.job, block.arg, block.value)}>
                    {t.det_inferred}
                </Provenance>
            }
        >
            <p className="mb-2 font-mono text-[10px] text-slate-500">
                {block.job}（{block.arg} = {block.value}）
            </p>

            {grid.matched > 0 && (
                <div className="mb-4">
                    <MicroLabel>{t.gear_windows}</MicroLabel>
                    {/* These 42 have no stated range. Saying so is the whole
                        point — a verdict here would be invented. */}
                    <p className="mb-1.5 mt-1 text-[11px] leading-relaxed text-slate-500">{t.gear_noSpec}</p>
                    {/* Which gate a gear sits in is INPA's pairing, not the SGBD's,
                        so it is said out loud rather than just drawn. */}
                    <p className="mb-1.5 text-[11px] leading-relaxed text-slate-500">{t.gear_gateNote}</p>
                    <DataList>
                        {GEARS.map((g) => (
                            <DataRow
                                key={g}
                                code={GATE_CODE[g]}
                                name={humanName(t.gear_name[g])}
                                ident={`GANG${g}`}
                                detail={
                                    <div className="grid grid-cols-4 gap-x-3 gap-y-2">
                                        <Field
                                            label={t.gear_gate}
                                            labelKind="data"
                                            stacked
                                            tone="text-slate-600"
                                            value={grid.gate(g) ? GATE_OF[g] : '·'}
                                        />
                                        {MEASURES.map((m) => (
                                            <Field
                                                key={m}
                                                label={t.gear_measure[m]}
                                                labelKind="data"
                                                stacked
                                                tone="text-slate-600"
                                                value={PASSES.map((p) => (grid.cell(g, m, p) ? '—' : '·')).join(' / ')}
                                            />
                                        ))}
                                    </div>
                                }
                            />
                        ))}
                    </DataList>
                </div>
            )}

            <SpecTable profile={profile} job={job} results={grid.rest} />
        </Section>
    );
}

/**
 * A code vocabulary, collapsed. Reference: you look a code up when the ECU
 * reports one.
 *
 * This used to lead with the German for faults, because their Japanese was
 * machine output and unreadable — `Schaltwegendstellungen・geraden・Gaenge・
 * sind・過・unterschiedlich` — and a garbled sentence under a Japanese heading
 * is worse than a German one on the vocabulary that decides "finished or on a
 * flatbed". All 156 phrases are hand-written now and the generator refuses to
 * emit a machine-translated one, so the reader's language leads.
 *
 * The German stays underneath: it is what the ECU actually said, and it is what
 * a workshop manual or a forum thread will be written in.
 */
function CodeTable({
    label: heading,
    rows,
    tone,
}: {
    label: string;
    rows: Array<{ code: string; ja: string; en: string; de?: string }>;
    tone: 'neutral' | 'primary' | 'danger';
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
                        code={r.code}
                        codeTone={tone}
                        name={humanName(lang === 'en' ? r.en : r.ja)}
                        detail={
                            r.de && r.de !== (lang === 'en' ? r.en : r.ja) ? (
                                <span className="text-[10px] text-slate-600">{r.de}</span>
                            ) : undefined
                        }
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
export function SequenceView({
    sequence,
    procedures,
    onPick,
}: {
    sequence: Smg2Sequence;
    procedures: Smg2Procedure[];
    onPick: (testprg: string) => void;
}) {
    const { lang, t } = useLang();
    const engineText = useCallback(
        (e: string) => (e === 'run' ? t.proc_engineRun : t.proc_engineOff),
        [t],
    );
    const plan = useMemo(
        () => stepsFromSequence(sequence, procedures, lang, onPick, engineText),
        [sequence, procedures, lang, onPick, engineText],
    );
    return (
        <Section title={lang === 'en' ? sequence.name.en : sequence.name.ja} count={sequence.steps.length}>
            <StepList plan={plan} />
        </Section>
    );
}

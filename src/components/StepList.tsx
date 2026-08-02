'use client';

/**
 * A numbered list of steps, with a state column that never moves.
 *
 * Built on `DataList`/`DataRow` so row height, the hairline separators and the
 * hover model are inherited rather than re-invented — and so the token checker
 * stays green.
 *
 * Two properties are deliberate and easy to lose:
 *
 *   - **The state cell is fixed-width and rendered on every row**, containing a
 *     non-breaking space when there is nothing to say. A step going
 *     `pending → running` must recolour and relabel without shifting anything.
 *     Rendering the pill conditionally would make the whole list twitch every
 *     time the ECU reports a new phase, which is the opposite of what an
 *     instrument watching a three-minute adaptation should do.
 *   - **The order line is always shown.** Whether a list is the ECU's own
 *     sequence, our recommendation, or an unordered set of alternatives is not a
 *     detail — on a gearbox adaptation it is the difference between following
 *     the machine and following us.
 */

import { AlertTriangle } from 'lucide-react';
import { DataList, DataRow, LABEL, Provenance, emphasise } from '@/components/ui';
import type { Step, StepPlan, StepState } from '@/lib/procedureSteps';
import { useLang } from '@/lib/i18n';

const STATE_TONE: Record<StepState, string> = {
    pending: 'text-slate-600',
    running: 'text-blue-400',
    passed: 'text-slate-500',
    done: 'text-emerald-400',
    failed: 'text-red-400',
    unknown: 'text-amber-400',
};

const ORDINAL_TONE: Record<StepState, string> = {
    pending: 'text-slate-600',
    running: 'text-blue-400',
    passed: 'text-slate-600',
    done: 'text-emerald-400',
    failed: 'text-red-400',
    unknown: 'text-amber-400',
};

export function StepList({ plan }: { plan: StepPlan }) {
    const { t } = useLang();
    return (
        <>
            <div className="mb-1.5">
                <Provenance title={t.step_orderNote[plan.order]}>{t.step_order[plan.order]}</Provenance>
            </div>
            {/* The source's own caveat, verbatim. On the recommended sequences
                this is the sentence saying the SGBD defines no order at all. */}
            {plan.note && (
                <p className="mb-2 flex items-start gap-1.5 text-[11px] leading-relaxed text-amber-400/90">
                    <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                    {plan.note}
                </p>
            )}
            <DataList>
                {plan.steps.map((s) => (
                    <StepRow key={s.key} step={s} />
                ))}
            </DataList>
        </>
    );
}

function StepRow({ step: s }: { step: Step }) {
    const { t } = useLang();
    const missing = !!s.absence;
    return (
        <DataRow
            // A site the SGBD has no job for is not selectable. A row you can
            // press that cannot do anything is worse than a row you cannot press.
            onSelect={missing ? undefined : s.onPick}
            leading={
                <span
                    className={`w-5 shrink-0 text-right font-mono text-[11px] tabular-nums ${ORDINAL_TONE[s.state]}`}
                >
                    {s.ordinal > 0 ? s.ordinal : '·'}
                </span>
            }
            name={s.name}
            ident={s.token}
            trailing={
                // Always rendered, always this wide. See the note at the top.
                <span className={`w-16 shrink-0 text-right ${LABEL} ${STATE_TONE[s.state]}`}>
                    {s.state === 'pending' ? ' ' : t.step_state[s.state]}
                </span>
            }
            detail={
                <>
                    {/* The SGBD's own German. It is the authoritative wording, and
                        on the SMG II fault vocabularies it is the only one that is
                        not machine-mangled. */}
                    {s.de && <p className="font-mono text-[10px] leading-relaxed text-slate-500">{s.de}</p>}
                    {s.absence && (
                        <p className="text-[11px] leading-relaxed text-amber-400/90">{emphasise(s.absence)}</p>
                    )}
                    {s.outcome && (
                        <p
                            className={`text-[11px] leading-relaxed ${
                                s.outcome.tone === 'fail' ? 'text-red-400' : 'text-emerald-400'
                            }`}
                        >
                            <span className="font-mono">{s.outcome.code}</span> {s.outcome.name}
                        </p>
                    )}
                    {s.reading && (
                        <p className="font-mono text-[11px] tabular-nums text-slate-200">
                            {s.reading.value}
                            {s.reading.unit ? ` ${s.reading.unit}` : ''}
                        </p>
                    )}
                    {s.meta && (
                        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                            {s.meta.map((m) => (
                                <span
                                    key={m.label}
                                    className={`text-[11px] ${m.warn ? 'text-amber-400' : 'text-slate-500'}`}
                                >
                                    {t.step_meta[m.label] ?? m.label} {m.value}
                                </span>
                            ))}
                        </div>
                    )}
                </>
            }
        />
    );
}

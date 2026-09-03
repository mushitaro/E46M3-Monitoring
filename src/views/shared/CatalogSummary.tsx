'use client';

import { ListChecks } from 'lucide-react';
import { Field, LABEL, MicroLabel } from '@/components/ui';
import { facetCounts, jobRiskOf, type EcuProfile } from '@/lib/ecuCatalog';
import { useLang } from '@/lib/i18n';
import { Awaiting } from './Awaiting';

/**
 * What this module IS, at a glance — the visualization the job tabs fall back to
 * when nothing is selected.
 *
 * The class breakdown is the fact the old two-tab split was silently asserting
 * without ever showing: CALIBRATION and ACTUATOR TEST were two lists whose
 * boundary nobody could see. Now the mix is on screen and the boundary is a
 * function (`lib/jobSurface`).
 *
 * SERVICE and ACTUATOR share it because the question they fall back to is the
 * same one, and because the numbers are about the module rather than about
 * whichever tab is up. A per-tab variant would be two answers to "how big is
 * this ECU".
 */
export function CatalogSummary({ catalog }: { catalog: EcuProfile | null }) {
    const { t } = useLang();

    if (!catalog || catalog.jobs.length === 0) {
        return <Awaiting icon={ListChecks} label={t.awaiting_catalog} />;
    }

    const mix = { high: 0, medium: 0, low: 0 };
    for (const j of catalog.jobs) mix[jobRiskOf(j)]++;
    const total = catalog.jobs.length;
    const byClass = facetCounts(catalog.jobs, (j) => j.class).slice(0, 4);

    return (
        <div className="flex h-full flex-col justify-center gap-4">
            <div>
                <div className="flex items-baseline justify-between">
                    <MicroLabel>{t.riskMix}</MicroLabel>
                    <span className="font-mono text-[11px] tabular-nums text-slate-500">{total}</span>
                </div>
                <div className="mt-1.5 flex h-3 overflow-hidden rounded-sm bg-slate-800">
                    <div className="bg-red-500/70" style={{ width: `${(mix.high / total) * 100}%` }} />
                    <div className="bg-amber-500/70" style={{ width: `${(mix.medium / total) * 100}%` }} />
                    <div className="bg-slate-600" style={{ width: `${(mix.low / total) * 100}%` }} />
                </div>
                <div className="mt-2 grid grid-cols-3 gap-x-2">
                    <Field label={t.risk_high} value={mix.high} stacked tone="text-red-400" />
                    <Field label={t.risk_medium} value={mix.medium} stacked tone="text-amber-400" />
                    <Field label={t.risk_low} value={mix.low} stacked tone="text-slate-400" />
                </div>
            </div>

            <div>
                <MicroLabel>{t.facet_purpose}</MicroLabel>
                <div className="mt-2 grid grid-cols-2 gap-x-2 gap-y-3">
                    {byClass.map(({ key, count }) => (
                        <Field key={key} label={t.jobClass[key]} value={count} stacked title={t.jobClassNote[key]} />
                    ))}
                </div>
            </div>
        </div>
    );
}

/**
 * A hub-scale numeric readout: one number, one caption.
 *
 * 22px is the ceiling — the size the reference app uses for its own single
 * numeric readout, and the one arbitrary size `check_ui_tokens.mjs` names. At
 * text-6xl this was a 60px glyph, four times the largest type anywhere else and
 * six times the chrome around it: a car with three faults read as an alarm
 * poster rather than as an instrument.
 *
 * Shared so the two views that show a count show it at the same size. They had
 * drifted apart once already.
 */
export function CountReadout({
    value,
    tone,
    suffix,
    caption,
}: {
    value: number;
    tone: string;
    /** The denominator, dimmer than the value. `4` of `/12` read together. */
    suffix?: string;
    caption: string;
}) {
    return (
        <div className="flex h-full flex-col items-center justify-center">
            <div className={`font-mono text-[22px] font-bold leading-none tabular-nums ${tone}`}>
                {value}
                {suffix && <span className="text-slate-600">{suffix}</span>}
            </div>
            <div className={`mt-2 ${LABEL} text-slate-500`}>{caption}</div>
        </div>
    );
}

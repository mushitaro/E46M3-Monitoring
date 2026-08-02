'use client';

/**
 * The DSC brake-hydraulic operations, as controls.
 *
 * ## Why this is a grouped list and not a picture of a car
 *
 * A wheel diagram is the obvious idea and it is wrong twice over.
 *
 * The design system forbids it: four wheel glyphs are four outlines around four
 * objects, and `ui.tsx` is explicit that borders rule BETWEEN regions and never
 * around a thing. That rule is enforced by `check_ui_tokens.mjs`.
 *
 * But the stronger objection is that the data would not survive it. A diagram
 * asserts a one-to-one mapping between a highlighted corner and an operation,
 * and four of the twelve hydraulic jobs break it: `DRUCKABBAU_HA` addresses an
 * axle, `NA_ENTLUEFTUNG_LI` addresses a SIDE, `ENTLUEFTUNG_SERVICE` cycles all
 * four, and `DRUCKHALTEN` carries no corner in its name at all while its
 * bytecode touches only the front-left inlet. A car glyph would have to pick a
 * highlight for each of those, and for `DRUCKHALTEN` it would be actively
 * misleading about which wheel is under pressure.
 *
 * A greyed row in a column of live ones states an absence. A diagram can only
 * fail to highlight something, which states nothing.
 */

import { useMemo } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Pane, Provenance, Section, TextButton, emphasise } from '@/components/ui';
import { StepList } from '@/components/StepList';
import { stepsFromJobFamily } from '@/lib/procedureSteps';
import { humanName } from '@/components/ui';
import type { DscFamily, DscHydraulics } from '@/lib/dscHydraulics';
import type { CatalogJob } from '@/lib/ecuCatalog';
import { useLang } from '@/lib/i18n';

export function DscHydraulicsPane({
    hydraulics,
    jobs,
    selectedId,
    onSelect,
}: {
    hydraulics: DscHydraulics;
    jobs: Map<string, CatalogJob>;
    selectedId: string | null;
    onSelect: (job: CatalogJob) => void;
}) {
    const { t } = useLang();
    return (
        <Pane>
            <StopControl hydraulics={hydraulics} />
            {hydraulics.families.map((f) => (
                <FamilySection
                    key={f.id}
                    family={f}
                    valveNames={hydraulics.valves}
                    jobs={jobs}
                    selectedId={selectedId}
                    onSelect={onSelect}
                />
            ))}
            <p className="text-[11px] leading-relaxed text-slate-500">{emphasise(t.dsc_drivesNote)}</p>
        </Pane>
    );
}

function FamilySection({
    family,
    valveNames,
    jobs,
    selectedId,
    onSelect,
}: {
    family: DscFamily;
    valveNames: DscHydraulics['valves'];
    jobs: Map<string, CatalogJob>;
    selectedId: string | null;
    onSelect: (job: CatalogJob) => void;
}) {
    const { lang, t } = useLang();
    const plan = useMemo(() => {
        const p = stepsFromJobFamily(
            family.id,
            family.sites.map((s) => ({
                site: s.site,
                name: humanName(lang === 'en' ? s.en : s.ja),
                job: s.job,
                absence: s.absence ? humanName(lang === 'en' ? s.absence.en : s.absence.ja) : undefined,
                detail: s.drives?.join(' '),
            })),
        );
        // Selection and the pick handler are the component's business, not the
        // builder's — the builder stays free of React.
        return {
            ...p,
            steps: p.steps.map((step, i) => {
                const site = family.sites[i];
                const job = site.job ? jobs.get(site.job) : undefined;
                return {
                    ...step,
                    state: job && job.id === selectedId ? ('running' as const) : step.state,
                    onPick: job ? () => onSelect(job) : undefined,
                };
            }),
        };
    }, [family, lang, jobs, selectedId, onSelect]);
    void valveNames;

    return (
        <Section title={lang === 'en' ? family.en : family.ja} count={family.sites.length}>
            <StepList plan={plan} />
            {/* State the gap at the family that has one, not only on its row. */}
            {family.sites.some((s) => s.job === null) && (
                <p className="mt-1.5 text-[11px] text-amber-400/90">{t.dsc_absenceHint}</p>
            )}
        </Section>
    );
}

/**
 * The constructed stop.
 *
 * Displayed and disabled: there is no run path yet, and a live STOP for a RUN
 * that cannot happen would be its own lie. What ships now is the shape and,
 * more importantly, the provenance — which is permanent, not a tooltip.
 */
function StopControl({ hydraulics }: { hydraulics: DscHydraulics }) {
    const { lang, t } = useLang();
    const stop = hydraulics.stop;
    return (
        <Section title={t.dsc_stop} actions={<Provenance>{t.dsc_appConstruct}</Provenance>}>
            <div className="flex flex-wrap items-center gap-3">
                <TextButton disabled tone="destructive" Icon={AlertTriangle} title={t.gate_practiceOnly}>
                    {t.dsc_allOutputsOff}
                </TextButton>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-amber-400/90">
                {emphasise(lang === 'en' ? stop.note.en : stop.note.ja)}
            </p>
            {/* The frame IS the evidence, so it is printed, not summarised. */}
            <code className="mt-2 block break-all rounded bg-slate-950 p-2 font-mono text-[11px] text-slate-400">
                {stop.telegram}
            </code>
            {stop.runnersUp.length > 0 && (
                <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
                    {t.dsc_runnerUp(
                        stop.runnersUp.map((r) => `${r.telegram} (${r.jobs}) — ${r.differsBy.join(', ')}`).join(' / '),
                    )}
                </p>
            )}
        </Section>
    );
}

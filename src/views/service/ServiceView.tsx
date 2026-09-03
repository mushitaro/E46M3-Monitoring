'use client';

import { memo } from 'react';
import { DscHydraulicsPane } from '@/components/DscHydraulics';
import { JobDetail, SequenceView } from '@/components/JobDetail';
import { ServicePane } from '@/components/ServicePane';
import { DataList, DataRow, LABEL, Pane, Pill, Section, humanName } from '@/components/ui';
import type { JobRunResult } from '@/hooks/useDs2Link';
import type { DscHydraulics } from '@/lib/dscHydraulics';
import { jobIndex, type CatalogJob, type EcuProfile } from '@/lib/ecuCatalog';
import { useLang } from '@/lib/i18n';
import type { JobTextTable } from '@/lib/jobText';
import { PROCEDURE_OP, PROCEDURE_PREFIX } from '@/lib/jobOps';
import type { Ledger } from '@/lib/ledger';
import type { RunVerdict } from '@/lib/runGate';
import type { Smg2Procedure, Smg2Workflows } from '@/lib/smg2Workflows';
import type { TelegramTable } from '@/lib/telegrams';
import { CatalogSummary } from '@/views/shared/CatalogSummary';

/**
 * SERVICE — the module's catalogue, and the one surface that sends a job to a
 * car.
 *
 * The other three views send frames built from the protocol: IDENT, the fault
 * memory, the adaptation blocks, the live blocks. This is the only place a
 * CATALOGUE job goes out, and 86 of them pass `mayRun` on a vehicle — all reads.
 * That is why the tab was kept when the plan called for deleting it: removing it
 * would have left the app with no surface for the only thing it can do to a car.
 *
 * It is the complement of ACTUATOR, not an overlap with it. `lib/jobSurface`
 * decides which side a job is on, ONCE, because the two run their jobs through
 * different gates — `mayRun` here, `mayActuate` there — and a job reachable from
 * both would be two answers to "may this be sent".
 */
export const ServiceView = memo(function ServiceView({
    profile,
    ecuId,
    telegrams,
    ledger,
    workflows,
    hydraulics,
    selectedId,
    onSelect,
}: {
    profile: EcuProfile;
    ecuId: string;
    telegrams: TelegramTable | null;
    ledger: Ledger;
    workflows: Smg2Workflows | null;
    hydraulics: DscHydraulics | null;
    selectedId: string | null;
    onSelect: (job: CatalogJob) => void;
}) {
    return (
        <ServicePane
            profile={profile}
            telegrams={telegrams}
            ledger={ledger}
            selectedId={selectedId}
            onSelect={onSelect}
        >
            {/* SMG II's guided procedures sit above the job list because that is
                what they are: the gearbox controller's own adaptation programs,
                and not SGBD jobs. The other modules genuinely have none. */}
            <ProcedureSection
                ecuId={ecuId}
                workflows={workflows}
                selectedId={selectedId}
                onSelect={onSelect}
            />
            {/* DSC's per-wheel hydraulics. Above the job list for the same
                reason the SMG II procedures are: these are what someone opens
                this module to do. */}
            {hydraulics && (
                <DscHydraulicsPane
                    hydraulics={hydraulics}
                    jobs={jobIndex(profile)}
                    selectedId={selectedId}
                    onSelect={onSelect}
                />
            )}
        </ServicePane>
    );
});

/**
 * What happens if you press the button.
 *
 * With a job selected the right column's question is no longer "what is in this
 * list" but "what will this send" — so it answers that, telegram and gate
 * verdict and all. With nothing selected it falls back to what the module is.
 */
export function ServiceViz({
    lastRun,
    catalog,
    selectedJob,
    telegrams,
    jobText,
    workflows,
    runVerdict,
}: {
    /** The last job this app sent, whichever job it was. */
    lastRun: JobRunResult | null;
    catalog: EcuProfile | null;
    selectedJob: CatalogJob | null;
    telegrams: TelegramTable | null;
    jobText: JobTextTable | null;
    workflows: Smg2Workflows | null;
    runVerdict: RunVerdict | null;
}) {
    if (selectedJob && catalog) {
        return (
            <JobDetail
                profile={catalog}
                job={selectedJob}
                jobText={jobText}
                telegrams={telegrams}
                workflows={workflows}
                procedure={procedureForJob(selectedJob, workflows)}
                runVerdict={runVerdict}
                lastRun={lastRun?.jobId === selectedJob.id ? lastRun : null}
            />
        );
    }
    return <CatalogSummary catalog={catalog} />;
}

/**
 * SMG II's guided procedures, above the calibration jobs.
 *
 * They are presented as rows in the same list idiom as the jobs — same
 * selection, same right-hand panel — because from the operator's side they are
 * the same kind of thing: a named operation with preconditions and a result. The
 * difference is that these carry the ECU's own progress and result vocabularies,
 * and the panel shows those.
 *
 * A procedure is not a `CatalogJob`, so it is adapted into one. The adaptation
 * is lossless in the direction that matters — the panel looks the real procedure
 * back up by id (see `procedureForJob`) rather than reading the adapted shell.
 */
function ProcedureSection({
    ecuId,
    workflows,
    selectedId,
    onSelect,
}: {
    ecuId: string;
    workflows: Smg2Workflows | null;
    selectedId: string | null;
    onSelect: (job: CatalogJob) => void;
}) {
    const { lang, t } = useLang();
    if (ecuId !== 'smg2') return null;
    if (!workflows) return null;

    return (
        <Pane>
            <Section title={t.proc_title} count={workflows.procedures.length}>
                <DataList>
                    {workflows.procedures.map((p) => {
                        const job = procedureAsJob(p);
                        return (
                            <DataRow
                                key={p.id}
                                selected={job.id === selectedId}
                                onSelect={() => onSelect(job)}
                                leading={
                                    <Pill tone={p.risk === 'high' ? 'danger' : 'caution'}>
                                        {p.risk === 'high' ? t.risk_high : t.risk_medium}
                                    </Pill>
                                }
                                code={p.id}
                                name={humanName(lang === 'en' ? p.name.en : p.name.ja)}
                                trailing={
                                    <>
                                        <span className="shrink-0 font-mono text-[10px] text-slate-500">
                                            {p.durMax}
                                        </span>
                                        <span
                                            className={`shrink-0 ${LABEL} ${
                                                p.engine === 'run' ? 'text-amber-400' : 'text-slate-600'
                                            }`}
                                        >
                                            {p.engine === 'run' ? t.proc_engineRun : t.proc_engineOff}
                                        </span>
                                    </>
                                }
                                detail={
                                    <p className="text-[11px] text-slate-500">
                                        {lang === 'en' ? p.desc.en : p.desc.ja}
                                    </p>
                                }
                            />
                        );
                    })}
                </DataList>
            </Section>

            {/* The sequences ARE the answer to "what do I do after clutch work".
                They used to render as a row of hex chips whose meaning lived in a
                title= attribute; now each is a named, numbered step list. */}
            {workflows.sequences.map((s) => (
                <SequenceView
                    key={s.id}
                    sequence={s}
                    procedures={workflows.procedures}
                    onPick={(id) => {
                        const p = workflows.procedures.find((x) => x.id === id);
                        if (p) onSelect(procedureAsJob(p));
                    }}
                />
            ))}
        </Pane>
    );
}

/**
 * Adapts a test program into the job shape the list and the panel already speak.
 *
 * PROCEDURE_PREFIX lives in jobOps.ts beside the classifier that has to
 * recognise it — the ledger, the risk classifier and the telegram lookup are all
 * keyed on job id, and none of them should match a procedure by accident.
 */
export function procedureAsJob(p: Smg2Procedure): CatalogJob {
    return {
        id: `${PROCEDURE_PREFIX}${p.id}`,
        ja: p.name.ja,
        en: p.name.en,
        class: 'calibration',
        audience: 'owner',
        system: 'gearbox',
        // The SGBD-derived table states this; do not let a name heuristic
        // downgrade a 3-minute full gearbox adaptation to "medium".
        risk: p.risk === 'high' ? 'high' : p.risk === 'low' ? 'low' : 'medium',
        riskProvenance: 'sgbd-comment',
        // One definition, in jobOps. This used to be a second copy of the same
        // object; it drifted, and the panel rendered the stale one.
        op: PROCEDURE_OP,
        // The engine state is the procedure's own, from the SGBD table. Asserting
        // `engine_off` for a program that requires the engine RUNNING would be a
        // precondition that makes the job impossible.
        preconditions: p.engine === 'run' ? ['voltage_ok', 'stationary'] : ['voltage_ok', 'stationary', 'engine_off'],
        // Both arguments TESTPRG_STARTEN takes. AUSWAHLBYTE only where the
        // procedure actually selects something — 0x0A "engage arbitrary gear"
        // is the one that does.
        args: p.auswahl
            ? [
                  { name: 'TESTPRG_NR', type: 'int', kind: 'enum' },
                  { name: 'AUSWAHLBYTE', type: 'int', kind: 'enum' },
              ]
            : [{ name: 'TESTPRG_NR', type: 'int', kind: 'enum' }],
        results: [],
    };
}

export function procedureForJob(job: CatalogJob, workflows: Smg2Workflows | null): Smg2Procedure | null {
    if (!job.id.startsWith(PROCEDURE_PREFIX)) return null;
    const id = job.id.slice(PROCEDURE_PREFIX.length);
    return workflows?.procedures.find((p) => p.id === id) ?? null;
}

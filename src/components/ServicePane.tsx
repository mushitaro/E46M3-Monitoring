'use client';

/**
 * One list of every job the module has, faceted by what the job is FOR.
 *
 * ## The tab is called SERVICE
 *
 * It was called JOBS, which is the SGBD's word for a unit of work and a
 * developer's word for this list. Nobody opens a diagnostic tool to run a job;
 * they open it to service a car. The name was never chosen, it was inherited
 * from the data format.
 *
 * ## Why this replaced two tabs
 *
 * CALIBRATION and ACTUATOR TEST were split by a regex in the generator, and the
 * split did not survive contact with the data: five read-only jobs sat on the
 * write side, eight latching `DSC_SIM_*` sat under "returns by itself",
 * `ID_SCHREIBEN` wrote an inspection stamp from the calibration tab while
 * `PRUEFSTEMPEL_SCHREIBEN` — the same operation — was excluded entirely. Worse,
 * **the UI never stated the difference anywhere**: it existed only in a code
 * comment, so the honest answer to "what is different about these two lists" was
 * "nothing you can see".
 *
 * So there is one list, and the difference is a FACET with its meaning written
 * next to it. `class` is the axis that used to be the tab, and selecting one now
 * prints the sentence that says what that class does to your car.
 *
 * ## Why the default hides things, and says so
 *
 * All 323 jobs are here. About fifteen are steps inside other jobs' procedures
 * (`SEED_KEY`, `LOGIN_*`, `DIAGNOSE_AUFRECHT`), and thirteen are flash and EEPROM
 * writes this app will not run. Opening on all 323 would bury the ones an owner
 * can act on.
 *
 * The default is therefore `audience: owner` and "not programming" — and every
 * facet carries its count over the WHOLE catalogue, plus a line stating how many
 * rows the current filter is hiding. A filtered list that does not say it is
 * filtered is how 192 jobs went missing without anyone noticing.
 */

import { useMemo, useState } from 'react';
import { Chip, DataList, DataRow, FacetRow, LABEL, ListControls, Pane, Pill, Section } from '@/components/ui';
import {
    description,
    facetCounts,
    label,
    type Audience,
    type CatalogJob,
    type EcuProfile,
    type JobClass,
    type Risk,
} from '@/lib/ecuCatalog';
import { jobOperation, type OpKind } from '@/lib/jobOps';
import { mayRunOnVehicle, type Ledger } from '@/lib/ledger';
import { useLang } from '@/lib/i18n';

/** The class order is the order of consequence, not alphabetical. */
const CLASS_ORDER: JobClass[] = ['read', 'test', 'calibration', 'coding', 'programming', 'protocol'];
const AUDIENCE_ORDER: Audience[] = ['owner', 'technician', 'protocol'];

export function ServicePane({
    profile,
    ledger,
    selectedId,
    onSelect,
    children,
}: {
    profile: EcuProfile;
    ledger: Ledger;
    selectedId: string | null;
    onSelect: (job: CatalogJob) => void;
    /** SMG II's guided procedures, which are not SGBD jobs. Rendered above the list. */
    children?: React.ReactNode;
}) {
    const { lang, t } = useLang();
    const [query, setQuery] = useState('');
    const [cls, setCls] = useState<JobClass | 'all'>('all');
    const [audience, setAudience] = useState<Audience | 'all'>('owner');
    const [system, setSystem] = useState<string | 'all'>('all');

    const jobs = profile.jobs;

    // Counts over the WHOLE catalogue. Counting the filtered set would make
    // hidden things invisible twice.
    const classCounts = useMemo(() => facetCounts(jobs, (j) => j.class), [jobs]);
    const audienceCounts = useMemo(() => facetCounts(jobs, (j) => j.audience), [jobs]);
    const systemCounts = useMemo(() => facetCounts(jobs, (j) => j.system), [jobs]);

    const rows = useMemo(() => {
        const q = query.trim().toLowerCase();
        return jobs
            .map((job) => ({ job, d: description(profile, job, lang) }))
            .filter(({ job, d }) => {
                if (cls !== 'all' && job.class !== cls) return false;
                // Programming is excluded by default even under "all classes":
                // this app does not run it, and thirteen rows that cannot be
                // acted on at the top of a list is how a list stops being read.
                if (cls === 'all' && job.class === 'programming') return false;
                if (audience !== 'all' && job.audience !== audience) return false;
                if (system !== 'all' && job.system !== system) return false;
                if (!q) return true;
                return (
                    job.id.toLowerCase().includes(q) ||
                    label(job, lang).toLowerCase().includes(q) ||
                    d.original.toLowerCase().includes(q)
                );
            });
    }, [jobs, profile, lang, query, cls, audience, system]);

    const hidden = jobs.length - rows.length;

    return (
        <Pane>
            {children}

            <Section
                title={t.tab_service}
                count={jobs.length}
                // The sentence that used to exist only in a code comment.
                note={cls !== 'all' ? t.jobClassNote[cls] : undefined}
            >
                <ListControls
                    query={query}
                    onQuery={setQuery}
                    placeholder={t.search}
                    shown={rows.length}
                    total={jobs.length}
                    // Say what is hidden. This is the line whose absence let 192
                    // jobs disappear from the old build without a trace.
                    hiddenNote={hidden > 0 ? t.facet_hidden(hidden) : undefined}
                >
                    <FacetRow label={t.facet_purpose}>
                        <Chip active={cls === 'all'} onClick={() => setCls('all')}>
                            {t.facet_all}
                        </Chip>
                        {CLASS_ORDER.filter((c) => classCounts.some((x) => x.key === c)).map((c) => (
                            <Chip
                                key={c}
                                active={cls === c}
                                count={classCounts.find((x) => x.key === c)?.count}
                                title={t.jobClassNote[c]}
                                onClick={() => setCls(cls === c ? 'all' : c)}
                            >
                                {t.jobClass[c]}
                            </Chip>
                        ))}
                    </FacetRow>

                    <FacetRow label={t.facet_audience}>
                        <Chip active={audience === 'all'} onClick={() => setAudience('all')}>
                            {t.facet_all}
                        </Chip>
                        {AUDIENCE_ORDER.filter((a) => audienceCounts.some((x) => x.key === a)).map((a) => (
                            <Chip
                                key={a}
                                active={audience === a}
                                count={audienceCounts.find((x) => x.key === a)?.count}
                                title={t.audienceNote[a]}
                                onClick={() => setAudience(audience === a ? 'all' : a)}
                            >
                                {t.audience[a]}
                            </Chip>
                        ))}
                    </FacetRow>

                    <FacetRow label={t.facet_system}>
                        <Chip active={system === 'all'} onClick={() => setSystem('all')}>
                            {t.facet_all}
                        </Chip>
                        {systemCounts.map(({ key, count }) => (
                            <Chip
                                key={key}
                                active={system === key}
                                count={count}
                                onClick={() => setSystem(system === key ? 'all' : key)}
                            >
                                {t.system[key] ?? key}
                            </Chip>
                        ))}
                    </FacetRow>
                </ListControls>

                <DataList className="mt-3">
                    {rows.map(({ job, d }) => {
                        const gate = mayRunOnVehicle(ledger, `${profile.id}:${job.id}`);
                        return (
                            <DataRow
                                key={job.id}
                                selected={job.id === selectedId}
                                onSelect={() => onSelect(job)}
                                leading={<RiskPill risk={job.risk} />}
                                name={label(job, lang)}
                                ident={job.id}
                                trailing={
                                    <>
                                        <OpBadge kind={jobOperation(job).kind} />
                                        <GateBadge allowed={gate.allowed} reason={gate.reason} />
                                    </>
                                }
                                detail={
                                    <>
                                        {/* Only when it says something the label
                                            did not. `lbl_for` picks whichever of
                                            the comment and the identifier reads
                                            better, so the two are often the same
                                            string — and printing it twice made
                                            every row look like a rendering bug. */}
                                        {d.text && d.text !== label(job, lang) && (
                                            <p className="text-[11px] text-slate-400">{d.text}</p>
                                        )}
                                        {/* slate-500, not slate-700. slate-700 is
                                            #2A2A33 — 1.48:1 on black, a BORDER
                                            colour. The German original is the one
                                            line that is non-negotiable, and it was
                                            rendering as blank space. */}
                                        {d.original && d.original !== d.text && (
                                            <p className="font-mono text-[10px] text-slate-500">{d.original}</p>
                                        )}
                                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                                            <span className={`${LABEL} text-slate-600`}>
                                                {t.system[job.system] ?? job.system}
                                            </span>
                                            {job.preconditions.map((c) => (
                                                <span key={c} className="text-[11px] text-slate-500">
                                                    {(t[`precond_${c}` as keyof typeof t] as string) ?? c}
                                                </span>
                                            ))}
                                            {job.args.length > 0 && (
                                                <span className="font-mono text-[10px] text-amber-400">
                                                    {t.args_required(job.args.map((a) => a.name).join(', '))}
                                                </span>
                                            )}
                                            {job.results.length > 0 && (
                                                <span className={`${LABEL} text-slate-600`}>
                                                    {t.det_resultCount(job.results.length)}
                                                </span>
                                            )}
                                        </div>
                                    </>
                                }
                            />
                        );
                    })}
                </DataList>
            </Section>
        </Pane>
    );
}

/**
 * The operation shape, on every row.
 *
 * Only the ones carrying an obligation are tinted: LATCHING cannot be undone,
 * HOLD leaves an output live until you stop it, PROGRAM runs for minutes, and
 * RESULT-ELSEWHERE tells you nothing unless you also send the companion. If all
 * eleven shapes shouted, the four that matter would not.
 */
const OP_TONE: Partial<Record<OpKind, 'danger' | 'caution' | 'secondary'>> = {
    latching: 'danger',
    write: 'danger',
    hold: 'caution',
    paired: 'caution',
    procedure: 'secondary',
    deferred: 'secondary',
};

function OpBadge({ kind }: { kind: OpKind }) {
    const { t } = useLang();
    const tone = OP_TONE[kind];
    if (!tone) {
        return (
            <span className={`hidden shrink-0 ${LABEL} text-slate-600 min-[1100px]:inline`}>
                {t.opKind[kind]}
            </span>
        );
    }
    return <Pill tone={tone}>{t.opKind[kind]}</Pill>;
}

function RiskPill({ risk }: { risk: Risk }) {
    const { t } = useLang();
    return (
        <Pill tone={risk === 'high' ? 'danger' : risk === 'medium' ? 'caution' : 'neutral'}>{t.risk_label[risk]}</Pill>
    );
}

/**
 * Default-deny, stated on every row.
 *
 * Unverified is deliberately the QUIET one — plain muted text, no chip. It is the
 * state of every row today, and a tint on all 323 would be a wall of colour
 * saying nothing. Verified is what will stand out, once anything is.
 */
function GateBadge({ allowed, reason }: { allowed: boolean; reason: string }) {
    const { t } = useLang();
    if (!allowed) {
        return (
            <span title={reason} className={`shrink-0 ${LABEL} text-slate-600`}>
                {t.gate_unverified}
            </span>
        );
    }
    return (
        <Pill tone="ok" title={reason}>
            {t.gate_verified}
        </Pill>
    );
}

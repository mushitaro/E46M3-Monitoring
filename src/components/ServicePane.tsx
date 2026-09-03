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
 * ## Why this replaced two tabs, and why ACTUATOR came back anyway
 *
 * CALIBRATION and ACTUATOR TEST were once split by a regex in the generator, and
 * the split did not survive contact with the data: five read-only jobs sat on the
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
 * ACTUATOR exists again, and it is not that old split coming back. It is a
 * different SHAPE of control: a row that arms, holds an output energised, and
 * has to keep a STOP pressable while it does. That does not fit a browse-and-
 * select list, and the arming state has to outlive the row. Which is why the
 * boundary here is by consequence and not by name — `class === 'test'` is
 * exactly the set that can leave something on.
 *
 * ## The split is EXCLUSIVE, and that is the point
 *
 * `test` jobs are not in this list. Not for tidiness: SERVICE runs a job through
 * `mayRun` and ACTUATOR through `mayActuate`, which is deliberately wider in
 * PRACTICE. One job reachable from two places through two different gates is two
 * answers to "may this be sent", and the operator would have no way to know
 * which one they got.
 *
 * ## What this list is FOR, now that ACTUATOR has the actuators
 *
 * The reads — and they are the whole of what this app can do to a car. Of the
 * 1,524 jobs, 86 pass `mayRun` on a vehicle and every one of them is a read.
 * This is the only surface in the app that sends them: DIAGNOSIS, ADAPTATION and
 * DATALOG send frames built from the protocol (readIdent, readFaults,
 * readAdaptations, startLog), not catalogue jobs.
 *
 * The rest of the catalogue stays visible on purpose. A coding write or an
 * identity write cannot be run and says so, and "this ECU has that job and here
 * is why we will not send it" is a more useful answer than an absence.
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
import { isOn } from '@/lib/jobSurface';
import { mayRunOnVehicle, type Ledger } from '@/lib/ledger';
import { mayRun } from '@/lib/runGate';
import { bestTelegram, type TelegramTable } from '@/lib/telegrams';
import { useLang } from '@/lib/i18n';

/** The class order is the order of consequence, not alphabetical. */
// No `test`: those rows live in ACTUATOR. Ordered by consequence, not alphabet.
const CLASS_ORDER: JobClass[] = ['read', 'calibration', 'coding', 'identity', 'programming', 'protocol'];
const AUDIENCE_ORDER: Audience[] = ['owner', 'technician', 'protocol'];

export function ServicePane({
    profile,
    ledger,
    telegrams,
    selectedId,
    onSelect,
    children,
}: {
    profile: EcuProfile;
    ledger: Ledger;
    /** So the list can ask the SAME gate the hub asks. See `runnable` below. */
    telegrams: TelegramTable | null;
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
    const [onlyRunnable, setOnlyRunnable] = useState(false);

    // Everything except the actuators, which have their own tab and their own
    // gate. The predicate lives in `lib/jobSurface` so the two views cannot
    // drift into overlapping — see the note above about why that matters.
    const jobs = useMemo(() => profile.jobs.filter(isOn('service')), [profile.jobs]);

    /**
     * Which jobs this app can actually send, right now.
     *
     * Five of 323. That number was invisible: the list showed 116 rows by
     * default, 115 of them with a greyed-out RUN, and nothing said which — or
     * how few — could ever fire. Clicking around to find out is not a feature.
     *
     * The same `mayRun` the hub uses, so the chip and the button cannot
     * disagree. It is computed for the whole catalogue, not the filtered view,
     * because the count has to be true about the module rather than about the
     * current filter.
     */
    const runnable = useMemo(() => {
        const out = new Set<string>();
        for (const job of jobs) {
            if (mayRun(job, bestTelegram(telegrams, job.id), ledger, { moduleId: profile.id }).allowed) {
                out.add(job.id);
            }
        }
        return out;
    }, [jobs, telegrams, ledger, profile.id]);

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
                if (cls === 'all' && (job.class === 'programming' || job.class === 'identity')) return false;
                if (audience !== 'all' && job.audience !== audience) return false;
                if (system !== 'all' && job.system !== system) return false;
                if (onlyRunnable && !runnable.has(job.id)) return false;
                if (!q) return true;
                return (
                    job.id.toLowerCase().includes(q) ||
                    label(job, lang).toLowerCase().includes(q) ||
                    d.original.toLowerCase().includes(q)
                );
            });
    }, [jobs, profile, lang, query, cls, audience, system, onlyRunnable, runnable]);

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
                    {/* The one filter that answers "what can I actually press".
                        It sits first because on a list where 318 of 323 rows
                        cannot fire, that is the first question. */}
                    <FacetRow label={t.facet_runnable}>
                        <Chip
                            active={onlyRunnable}
                            count={runnable.size}
                            title={t.facet_runnableNote}
                            // Turning this on clears the other axes.
                            //
                            // The chip counts over the WHOLE catalogue, so with
                            // the default `audience: owner` still applied it
                            // promised 3 and showed 1 — two of the three are
                            // technician-level. A count that the list then
                            // contradicts is worse than no count. "What can I
                            // press" is a different question from "what is at my
                            // level", and it wins while it is asked.
                            onClick={() => {
                                const next = !onlyRunnable;
                                setOnlyRunnable(next);
                                if (next) {
                                    setCls('all');
                                    setAudience('all');
                                    setSystem('all');
                                }
                            }}
                        >
                            {t.facet_runnableNow}
                        </Chip>
                    </FacetRow>

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
                        // The LEDGER's answer — has a car ever confirmed this
                        // job's data. Deliberately not `mayRun`: that is the
                        // permission question, and it is answered by the
                        // `実行可能` marker beside this one.
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
                                        {/* Marked on the row, not only discoverable
                                            by selecting it and looking at the hub
                                            in the other column. */}
                                        {runnable.has(job.id) && (
                                            <span className={`shrink-0 ${LABEL} text-blue-400`}>
                                                {t.facet_runnableNow}
                                            </span>
                                        )}
                                        <OpBadge kind={jobOperation(job).kind} />
                                        <VerifiedBadge verified={gate.allowed} reason={gate.reason} />
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
/**
 * Whether a vehicle has ever confirmed this job's data. NOT whether it may run.
 *
 * This was called `GateBadge` and it read as a permission verdict, which put
 * `実行可能` and `未検証` on the same row and made them look like a
 * contradiction. They are both true and they are about different things:
 *
 *   runnable  — the app will send this, because the frame is known and reads.
 *   unverified — nobody has confirmed against a car that this frame does what
 *                the catalogue says. The telegram is a static scrape.
 *
 * `mayRun` does not consult the ledger on the read path at all, so this badge
 * never had a say in whether the RUN button lit. Naming it a gate implied it
 * did. It now says what it measures.
 */
function VerifiedBadge({ verified, reason }: { verified: boolean; reason: string }) {
    const { t } = useLang();
    if (!verified) {
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

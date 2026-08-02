'use client';

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Activity,
    AlertTriangle,
    CircleDot,
    Cpu,
    Download,
    ListChecks,
    Loader2,
    Play,
    PlayCircle,
    PlugZap,
    Radio,
    RotateCcw,
    ScanLine,
    Square,
    Zap,
    type LucideIcon,
} from 'lucide-react';
import {
    MSS54_BLOCKS_BY_SYMBOL,
    MSS54_CHANNELS,
    MSS54_LIVE_BLOCKS,
    channelId,
    formatErrorCode,
    planBlockReads,
    type ChannelId,
} from '@tsunagi/ds2-mss54';
import { AppHeader } from '@/components/AppHeader';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { ElectricalFaultDialog } from '@/components/ElectricalFaultDialog';
import { Hub, HubCluster, HubNotice, SubActions, type HubConfig, type NoticeTone } from '@/components/Hub';
import { JobDetail, SequenceView } from '@/components/JobDetail';
import { ServicePane } from '@/components/ServicePane';
import { DscHydraulicsPane } from '@/components/DscHydraulics';
import { LogPopover } from '@/components/LogPopover';
import {
    Chip,
    DataList,
    DataRow,
    FacetRow,
    Field,
    LABEL,
    ListControls,
    MicroLabel,
    Pane,
    Pill,
    Section,
    TextButton,
    Well,
    humanName,
} from '@/components/ui';
import { useDs2Link, type CommsLogLine, type LiveSample } from '@/hooks/useDs2Link';
import { useLang, type Lang } from '@/lib/i18n';
import {
    facetCounts,
    jobIndex,
    jobRiskOf,
    label,
    loadEcuCatalog,
    loadEcuIndex,
    text as resolveText,
    type CatalogJob,
    type EcuIndexEntry,
    type EcuProfile,
} from '@/lib/ecuCatalog';
import { PROCEDURE_OP, PROCEDURE_PREFIX, hasStopControl, operationFor } from '@/lib/jobOps';
import { loadJobText, type JobTextTable } from '@/lib/jobText';
import { loadDscHydraulics, type DscHydraulics } from '@/lib/dscHydraulics';
import { resetJobsFor } from '@/lib/adaptationReset';
import { EMPTY_LEDGER, type Ledger } from '@/lib/ledger';
import { mayRun, type RunVerdict } from '@/lib/runGate';
import { loadSmg2Workflows, type Smg2Procedure, type Smg2Workflows } from '@/lib/smg2Workflows';
import { bestTelegram, loadTelegrams, type TelegramTable } from '@/lib/telegrams';

/**
 * CALIBRATION and ACTUATOR TEST were merged into SERVICE, and not only because
 * the split was wrong. It also removed a leak: the selection was keyed on
 * `ecuId` alone, so a procedure picked under CALIBRATION stayed selected — and
 * stayed in the right column's viz — after switching to ACTUATOR TEST, where its
 * row did not exist.
 *
 * ADAPTATION is a tab rather than a section under DIAGNOSIS because the two
 * halves of it need a surface of their own: the learned values are what an owner
 * reads after a repair, and the ECU's own reset for them is a WRITE this app
 * refuses to send. Both belong on one screen where the refusal is stated next to
 * the thing it refuses, instead of a read hidden in a sub-action row and a reset
 * lost among 223 rows in SERVICE.
 */
type Tab = 'diagnosis' | 'datalog' | 'adaptation' | 'service';
type Link = ReturnType<typeof useDs2Link>;

/**
 * The shell.
 *
 * Layout follows the ///M spatial system rather than being invented: a 48px app
 * header whose bottom rule is the tricolor stripe, then a phi (61.8 / 38.2)
 * split. Each column opens with its OWN 44px bar — tabs on the left, the module
 * identity on the right — so the two rules meet and form one continuous line
 * across the split. The right column then stacks a visualization region and a
 * control panel holding the status row, a RESERVED notice line, the hub cluster
 * and a RESERVED sub-action row.
 *
 * Two things this deliberately does NOT do, both of which it used to:
 *
 *   - It does not put a full-width tab bar above the split. That was a third
 *     bar (48 + 44 + 44), and it pushed a pane title into each column to say
 *     what the tab bar had just said.
 *   - It does not OUTLINE the columns, or pad and gap them apart. The columns
 *     are separated by one shared hairline, `border-r border-slate-900`, and
 *     they run to the edges. Boxing each and floating them on a 16px gutter is
 *     a card layout; this is an instrument, and the difference is entirely in
 *     whether regions are ruled or framed. See `components/ui.tsx` for the rule
 *     and the primitives that keep it.
 *
 * The reserved slots are the part that is easy to skip and shouldn't be:
 * transient text appears and disappears INSIDE them, so a state change
 * recolours and relabels without reflowing anything. A panel that twitches
 * every time the link state moves reads as untrustworthy on a tool that
 * commands a car.
 */
export default function Home() {
    const { t } = useLang();
    const link = useDs2Link();
    const [tab, setTab] = useState<Tab>('diagnosis');

    const [ecuIndex, setEcuIndex] = useState<EcuIndexEntry[]>([]);
    const [ecuId, setEcuId] = useState('mss54');
    const [loaded, setLoaded] = useState<{ id: string; catalog: EcuProfile } | null>(null);
    const [catalogError, setCatalogError] = useState<string | null>(null);
    const catalog = loaded?.id === ecuId ? loaded.catalog : null;
    const ledger: Ledger = EMPTY_LEDGER;

    // Datalog state lives here so the right column can visualise a run while
    // the datalog tab is not the one on the left.
    const datalog = useDatalog(link);

    useEffect(() => {
        loadEcuIndex().then(setEcuIndex).catch((e: Error) => setCatalogError(e.message));
    }, []);

    useEffect(() => {
        let cancelled = false;
        loadEcuCatalog(ecuId)
            .then((c) => {
                if (cancelled) return;
                setLoaded({ id: ecuId, catalog: c });
                // Clear it. Without this a single transient failure — a file
                // being rewritten under a dev server, a dropped request —
                // latched the notice line for the rest of the session, so the
                // one place a REAL error would appear was already occupied by a
                // stale one that had since fixed itself.
                setCatalogError(null);
            })
            .catch((e: Error) => {
                if (!cancelled) setCatalogError(e.message);
            });
        return () => {
            cancelled = true;
        };
    }, [ecuId]);

    // The job views' selection, and the two side tables that describe it. Both
    // load lazily and BOTH may legitimately be absent: only SMG II has guided
    // procedures, and DSC has no unambiguous telegram for any of its 48 jobs.
    // A missing table degrades the panel to "not established", never breaks it.
    // Keyed by module rather than cleared from an effect: switching modules must
    // drop the selection, and deriving that is both simpler and impossible to
    // get out of sync with a cascading render.
    const [clearOpen, setClearOpen] = useState(false);
    const [selection, setSelection] = useState<{ ecuId: string; job: CatalogJob } | null>(null);
    const selectedJob = selection?.ecuId === ecuId ? selection.job : null;
    const selectJob = useCallback((job: CatalogJob) => setSelection({ ecuId, job }), [ecuId]);

    const [telegrams, setTelegrams] = useState<TelegramTable | null>(null);
    const [jobText, setJobText] = useState<JobTextTable | null>(null);
    const [workflows, setWorkflows] = useState<Smg2Workflows | null>(null);
    const [hydraulics, setHydraulics] = useState<DscHydraulics | null>(null);

    useEffect(() => {
        void loadTelegrams(ecuId).then(setTelegrams);
        void loadJobText(ecuId).then(setJobText);
        void loadDscHydraulics(ecuId).then(setHydraulics);
    }, [ecuId]);

    useEffect(() => {
        void loadSmg2Workflows().then(setWorkflows);
    }, []);

    const serviceTab = tab === 'service';
    // PRACTICE is a MODE the hub then connects in, not a second connect button.
    // As a button beside CONNECT it was a fork with no stated default; as a
    // checkbox the hub reads CONNECT either way and the box says which link you
    // will get — which is also why it is disabled once a session is open.
    const [practiceArmed, setPracticeArmed] = useState(false);
    // One verdict, computed once, used by the hub AND by the panel. They used to
    // reason about runnability separately, which is how a control that says it
    // can fire ends up beside a panel that says it cannot.
    const runVerdict: RunVerdict | null =
        serviceTab && selectedJob
            ? mayRun(selectedJob, bestTelegram(telegrams, selectedJob.id), ledger, { moduleId: ecuId })
            : null;

    const hub = useHubConfig(
        tab,
        link,
        datalog,
        serviceTab ? selectedJob : null,
        runVerdict,
        practiceArmed,
        ecuId,
    );
    const [faultOpen, setFaultOpen] = useState(false);

    // One notice line, one precedence: a link error outranks a catalog error
    // outranks whatever the hub wanted to say about cost or progress. The hub's
    // own notice is never urgent, so it always loses.
    const notice: { text?: string; tone: NoticeTone } =
        link.error ? { text: link.error, tone: 'error' }
        : catalogError ? { text: catalogError, tone: 'warn' }
        : { text: hub.notice, tone: 'info' };

    return (
        <div className="flex h-dvh flex-col overflow-hidden bg-slate-950">
            <AppHeader
                ident={link.ident}
                state={link.state}
                mode={link.mode}
                hasError={!!link.error}
            />


            <main className="flex min-h-0 flex-1 flex-col overflow-hidden min-[900px]:flex-row">
                {/* Both columns carry a faint fill. Left at /40, right at /20 over
                    the true-black base: without them the split is a single
                    #0A0A0D hairline on #000000, which measures as a rule and
                    reads as nothing — the whole app looks like one flat void with
                    text floating in it. The surfaces are what make the regions
                    legible now that they are no longer outlined. */}
                {/* No z-index on this column. `relative` plus a numeric z makes
                    it a stacking context, which re-bases the tab bar and the log
                    popover INSIDE it — so the popover's z-40 dismiss backdrop
                    could not cover the right column (z-20) and clicking the hub
                    to dismiss the log fired the hub instead, dropping the link. */}
                <section className="relative flex h-[38.2%] min-h-0 flex-col border-b border-slate-900 bg-slate-950/40 min-[900px]:h-full min-[900px]:w-[61.8%] min-[900px]:border-b-0 min-[900px]:border-r">
                    <nav role="tablist" className={`${BAR} z-30`}>
                        <div className="no-scrollbar mr-auto flex h-full min-w-0 flex-1 gap-6 overflow-x-auto overflow-y-hidden">
                            {(
                                [
                                    ['diagnosis', t.tab_diagnosis],
                                    ['datalog', t.tab_datalog],
                                    ['adaptation', t.tab_adaptation],
                                    ['service', t.tab_service],
                                ] as const
                            ).map(([id, labelText]) => (
                                <button
                                    key={id}
                                    role="tab"
                                    aria-selected={tab === id}
                                    onClick={() => setTab(id)}
                                    className={`flex h-full shrink-0 items-center whitespace-nowrap border-b-2 ${LABEL} transition-colors ${
                                        tab === id
                                            ? 'border-blue-400 text-blue-400'
                                            : 'border-transparent text-slate-500 hover:text-slate-300'
                                    }`}
                                >
                                    {labelText}
                                </button>
                            ))}
                        </div>

                        {/* Tools right, fenced with a vertical rule. The comms log
                            is a popover and not a tab: it has to be reachable WHILE
                            doing the thing that is failing, not somewhere you
                            navigate away to. */}
                        <div className="ml-4 flex h-full items-center border-l border-slate-800 pl-4">
                            <LogPopover log={link.log} onClear={link.clearLog} onExport={() => exportLog(link.log)} />
                        </div>
                    </nav>

                    {/* pt-2 pb-2 px-4 is the scroll-content padding from the
                        spacing scale, not a free-hand value. */}
                    <div className="min-h-0 flex-1 overflow-auto px-4 pb-2 pt-2">
                        {tab === 'diagnosis' && <DiagnosisPane link={link} catalog={catalog} />}
                        {tab === 'datalog' && <DatalogPane datalog={datalog} />}
                        {tab === 'adaptation' && (
                            <AdaptationPane
                                link={link}
                                catalog={catalog}
                                ecuId={ecuId}
                                telegrams={telegrams}
                                ledger={ledger}
                            />
                        )}
                        {tab === 'service' &&
                            (catalog ? (
                                <ServicePane
                                    profile={catalog}
                                    telegrams={telegrams}
                                    ledger={ledger}
                                    selectedId={selectedJob?.id ?? null}
                                    onSelect={selectJob}
                                >
                                    {/* SMG II's guided procedures sit above the
                                        job list because that is what they are:
                                        the gearbox controller's own adaptation
                                        programs, and not SGBD jobs. The other two
                                        modules genuinely have none. */}
                                    <ProcedureSection
                                        ecuId={ecuId}
                                        workflows={workflows}
                                        selectedId={selectedJob?.id ?? null}
                                        onSelect={selectJob}
                                    />
                                    {/* DSC's per-wheel hydraulics. Above the job
                                        list for the same reason the SMG II
                                        procedures are: these are what someone
                                        opens this module to do. */}
                                    {hydraulics && (
                                        <DscHydraulicsPane
                                            hydraulics={hydraulics}
                                            jobs={jobIndex(catalog)}
                                            selectedId={selectedJob?.id ?? null}
                                            onSelect={selectJob}
                                        />
                                    )}
                                </ServicePane>
                            ) : (
                                <p className="py-2 font-mono text-xs uppercase text-slate-600">{t.awaiting_catalog}</p>
                            ))}
                    </div>
                </section>

                <aside className="relative z-20 flex min-h-0 flex-1 flex-col overflow-hidden bg-slate-900/20 backdrop-blur-sm min-[900px]:w-[38.2%] min-[900px]:flex-none">
                    <div className={BAR}>
                        <span className={`truncate ${LABEL} text-slate-500`}>
                            {t.pane_visualization}
                        </span>
                    </div>

                    <div className="relative min-h-[140px] flex-1 overflow-hidden bg-gradient-to-b from-slate-900/10 to-transparent p-4">
                        <Viz
                            tab={tab}
                            link={link}
                            catalog={catalog}
                            datalog={datalog}
                            selectedJob={serviceTab ? selectedJob : null}
                            telegrams={telegrams}
                            jobText={jobText}
                            workflows={workflows}
                            runVerdict={runVerdict}
                        />
                    </div>

                    {/* Controls take their natural height; the picture above
                        absorbs the slack. The reverse pins the picture and
                        crushes the dial. px-5 pt-4 pb-5 is the control-panel
                        padding from the spacing scale. */}
                    <div className="flex flex-initial flex-col overflow-y-auto px-5 pb-5 pt-4">
                        {/* The status row states WHAT is being addressed on the
                            left and offers its controls on the right — the same
                            shape as the reference app's DME row. Centring a lone
                            chip left the panel with no anchor and no label. */}
                        <div className="flex h-[32px] items-center justify-between gap-3 px-2">
                            <span className={`flex shrink-0 items-center gap-1.5 ${LABEL} text-slate-500`}>
                                <Cpu className="size-3" />
                                {t.module}
                            </span>
                            <div className="flex min-w-0 items-center gap-3">
                                {/* DISCONNECT lives HERE, not in the sub-action
                                    row, because that is where the reference tool
                                    puts it: on the row that states what you are
                                    talking to. It ends the session the row is
                                    describing, which is a different kind of act
                                    from the row below — those act on the current
                                    run and on the workspace.

                                    It also takes the slot PRACTICE vacates. The
                                    mode cannot change under an open link, so the
                                    checkbox has nothing left to say; leaving it
                                    there disabled spent the only free space in a
                                    32px row on a dead control. */}
                                {link.state === 'disconnected' ? (
                                    <PracticeToggle
                                        checked={practiceArmed}
                                        disabled={false}
                                        onChange={setPracticeArmed}
                                    />
                                ) : (
                                    <>
                                        <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-slate-600">
                                            {link.mode} · {link.state}
                                        </span>
                                        <TextButton onClick={() => void link.disconnect()} tone="danger">
                                            {t.disconnect}
                                        </TextButton>
                                    </>
                                )}
                                <EcuSelect
                                    index={ecuIndex}
                                    value={ecuId}
                                    // The DS2 address is per module, so switching
                                    // one under an open link would silently
                                    // retarget it.
                                    disabled={link.state !== 'disconnected'}
                                    onChange={setEcuId}
                                />
                            </div>
                        </div>

                        {/* A failure is reported HERE, in the slot that is
                            already reserved for it, next to the control that
                            caused it — not as a strip between the header and the
                            columns. That strip cost 26px of permanent dead space
                            when empty and shoved the whole workspace down when
                            full; this costs nothing and puts the message where
                            the eye already is. */}
                        <HubNotice text={notice.text} tone={notice.tone} />
                        <HubCluster>
                            <Hub config={hub} />
                        </HubCluster>
                        <SubActions>
                            {/* The two failure kinds need OPPOSITE advice, so
                                only one of these can ever appear: retry is the
                                one action that cannot help an electrical fault,
                                and the checklist is noise for a desync. */}
                            {link.errorKind === 'electrical' ? (
                                <TextButton onClick={() => setFaultOpen(true)} tone="destructive" Icon={AlertTriangle}>
                                    {t.details}
                                </TextButton>
                            ) : (
                                link.error && (
                                    <TextButton onClick={link.clearError} tone="primary" Icon={RotateCcw}>
                                        {t.retry}
                                    </TextButton>
                                )
                            )}
                            {/* DISCONNECT was here. It is now on the MODULE row
                                above — see the note there. */}
                            {tab === 'datalog' && datalog.samples.length > 0 && (
                                <TextButton onClick={datalog.exportCsv} Icon={Download}>
                                    {t.exportCsv}
                                </TextButton>
                            )}
                            {/* READ ADAPTATIONS was here. It is the ADAPTATION
                                tab's hub now — a tab's whole purpose does not
                                belong in the row under the primary control. */}
                            {/* The one mutating command this app sends, and the
                                only sub-action that opens a confirmation. It is
                                offered only once faults have actually been read,
                                so the evidence it destroys has at least been on
                                screen once. */}
                            {tab === 'diagnosis' && link.state === 'connected' && link.faults !== null && (
                                <TextButton
                                    onClick={() => setClearOpen(true)}
                                    tone="danger"
                                    Icon={AlertTriangle}
                                >
                                    {t.clearFaults}
                                </TextButton>
                            )}
                            {/* A held or paired job needs a STOP that is NOT the
                                hub: the hub is what started it, and re-deriving
                                one control into "now it stops" is how an operator
                                ends up pressing start twice. `latching` gets none
                                — it has no release job, and a disabled STOP would
                                imply one exists. */}
                            {serviceTab && selectedJob && hasStopControl(opFor(selectedJob)) && (
                                <TextButton disabled tone="destructive" Icon={Square} title={t.gate_practiceOnly}>
                                    {opFor(selectedJob).kind === 'procedure' ? t.op_abort : t.op_stop}
                                </TextButton>
                            )}
                        </SubActions>
                    </div>
                </aside>
            </main>

            <UnverifiedBanner />

            {faultOpen && <ElectricalFaultDialog message={link.error ?? ''} onClose={() => setFaultOpen(false)} />}

            {clearOpen && (
                <ConfirmDialog
                    title={t.clearFaults_title}
                    consequence={t.clearFaults_consequence}
                    confirmLabel={t.clearFaults_confirm}
                    onCancel={() => setClearOpen(false)}
                    onConfirm={() => {
                        setClearOpen(false);
                        void link.clearFaults();
                    }}
                />
            )}
        </div>
    );
}

/**
 * The bar recipe, once. Both columns open with one, at the same height, so
 * their bottom rules form a single line across the split.
 */
const BAR =
    'flex h-[44px] flex-none items-center border-b border-slate-900 bg-slate-900/50 px-4 backdrop-blur-sm';

/**
 * PRACTICE as a checkbox, not a second connect button.
 *
 * It is a MODE — which link the one CONNECT verb will open — and a button beside
 * CONNECT made it a fork with no stated default, so the app had two primary
 * actions and told you nothing about which one you were about to take. As a
 * checkbox the hub reads CONNECT either way and the box states which link you
 * get. It is a checkbox rather than a switch on purpose: a switch is for a mode
 * that changes what the app DOES to the car, and this changes whether there is a
 * car at all.
 *
 * Disabled once a session is open, because the session already IS one or the
 * other and a control that cannot take effect must not read as available.
 */
function PracticeToggle({
    checked,
    disabled,
    onChange,
}: {
    checked: boolean;
    disabled: boolean;
    onChange: (v: boolean) => void;
}) {
    const { t } = useLang();
    return (
        <label
            className={`flex shrink-0 items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider ${
                disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'
            } ${checked && !disabled ? 'text-indigo-400' : 'text-slate-500'}`}
            title={t.mode_practice}
        >
            <input
                type="checkbox"
                checked={checked}
                disabled={disabled}
                onChange={(e) => onChange(e.target.checked)}
                className="size-3 accent-indigo-500"
            />
            {t.practice}
        </label>
    );
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
function procedureAsJob(p: Smg2Procedure): CatalogJob {
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

function procedureForJob(job: CatalogJob, workflows: Smg2Workflows | null): Smg2Procedure | null {
    if (!job.id.startsWith(PROCEDURE_PREFIX)) return null;
    const id = job.id.slice(PROCEDURE_PREFIX.length);
    return workflows?.procedures.find((p) => p.id === id) ?? null;
}

/**
 * The operation for a selected row.
 *
 * An adapted procedure is not an SGBD job and has no classification to read, so
 * it takes the one builder in jobOps. Everything else reads `job.op`.
 */
const opFor = operationFor;


/**
 * The hub's config, derived on every render from the live state. Nothing is
 * stored — storing it and re-syncing by hand is the source of "the button says
 * the wrong thing" bugs.
 *
 * On the job tabs the hub becomes the RUN control for the SELECTED job, and its
 * verb comes from that job's operation shape: a program STARTS, everything else
 * RUNS. It is disabled with a stated reason rather than hidden, because "why
 * can't I run this" is the question the panel exists to answer — and today the
 * answer is almost always the same one: the request telegram for that job was
 * not recoverable from a static scrape of the SGBD, so we do not know what to
 * send. A tool that guesses at that byte string is a tool that sends a
 * neighbouring job's command to a car.
 */
function useHubConfig(
    tab: Tab,
    link: Link,
    datalog: ReturnType<typeof useDatalog>,
    selectedJob: CatalogJob | null,
    runVerdict: RunVerdict | null,
    practiceArmed: boolean,
    moduleId: string,
): HubConfig {
    const { t } = useLang();

    if (link.state === 'disconnected') {
        return {
            label: t.hub_connect,
            Icon: PlugZap,
            tone: practiceArmed ? 'ready' : 'idle',
            // The checkbox decides which link this opens. One verb, one button;
            // the mode is stated beside it rather than forked into a second
            // control with no stated default.
            onClick: () => void link.connect(practiceArmed ? 'practice' : 'vehicle'),
            notice: practiceArmed ? t.mode_practice : undefined,
        };
    }
    // Loader2, not the state's own glyph. animate-spin rotates whatever it is
    // given, and PlugZap and Zap both have an obvious "up" — spun end over end
    // they read as a corrupt icon rather than as progress, at the two moments
    // the user most needs to believe the tool is working.
    if (link.state === 'connecting') {
        return { label: t.hub_connecting, Icon: Loader2, tone: 'connecting', disabled: true, spin: true };
    }
    if (link.state === 'busy') {
        return { label: t.hub_reading, Icon: Loader2, tone: 'busy', disabled: true, spin: true };
    }
    if (link.state === 'logging') {
        return {
            label: t.hub_stop,
            Icon: Square,
            tone: 'armed',
            onClick: datalog.stop,
            notice: `${datalog.samples.length} ${t.samples}`,
        };
    }
    if (tab === 'diagnosis') {
        return {
            label: t.hub_read,
            Icon: Zap,
            tone: 'ready',
            onClick: () => void link.readIdent().then(() => link.readFaults()),
        };
    }
    if (tab === 'datalog') {
        return {
            label: t.hub_record,
            Icon: Radio,
            tone: 'ready',
            onClick: datalog.start,
            notice: datalog.costNotice,
        };
    }
    // The read is the hub here, not a sub-action. It is the one thing this tab
    // does, and the sub-action row is for actions on the current run — a tab
    // whose entire purpose sat in the row BELOW the primary control had the hub
    // saying LINKED and nothing to press.
    if (tab === 'adaptation') {
        if (moduleId !== 'mss54') {
            return {
                label: t.hub_read,
                Icon: Zap,
                tone: 'idle',
                disabled: true,
                notice: t.adaptations_noDecoder,
            };
        }
        return { label: t.hub_read, Icon: Zap, tone: 'ready', onClick: () => void link.readAdaptations() };
    }

    // The job tab. With nothing selected the hub has no job to name, and says so
    // rather than offering a verb with no object.
    if (tab === 'service') {
        if (!selectedJob) {
            return { label: t.hub_connected, Icon: CircleDot, tone: 'idle', disabled: true, notice: t.plan_selectHint };
        }
        const op = opFor(selectedJob);
        const risk = jobRiskOf(selectedJob);
        const allowed = runVerdict?.allowed === true;

        // The gate is `mayRun`, in one module, tested against all 323 jobs and
        // against the actual control byte of the frame that would go out. The
        // hub only renders its answer — it does not re-derive one, because two
        // derivations are two chances to disagree.
        return {
            label: op.kind === 'procedure' ? t.op_start : t.op_run,
            Icon: op.kind === 'procedure' ? PlayCircle : Play,
            // Red only when the control is armed to do something irreversible,
            // and only when it could actually go — an armed-looking ring on a
            // button that cannot fire is theatre.
            tone: !allowed ? 'idle' : risk === 'high' ? 'armed-danger' : 'ready',
            disabled: !allowed,
            notice: runVerdict && !runVerdict.allowed ? t.runBlock[runVerdict.reason] : undefined,
            onClick:
                runVerdict?.allowed === true
                    ? () => void link.runRead(selectedJob.id, runVerdict.telegram.hex)
                    : undefined,
        };
    }

    return { label: t.hub_connected, Icon: CircleDot, tone: 'idle', disabled: true };
}

/**
 * The visualization region — per-view, and not decoration: each one answers the
 * question the left pane is currently about, at a glance and from a distance.
 */
function Viz({
    tab,
    link,
    catalog,
    datalog,
    selectedJob,
    telegrams,
    jobText,
    workflows,
    runVerdict,
}: {
    tab: Tab;
    link: Link;
    catalog: EcuProfile | null;
    datalog: ReturnType<typeof useDatalog>;
    selectedJob: CatalogJob | null;
    telegrams: TelegramTable | null;
    jobText: JobTextTable | null;
    workflows: Smg2Workflows | null;
    runVerdict: RunVerdict | null;
}) {
    const { t } = useLang();

    if (tab === 'diagnosis') {
        const n = link.faults?.length;
        // Nothing read yet is an EMPTY state, not a zero. Rendering "—" at
        // text-6xl in slate-800 put a barely-visible dash in the middle of a
        // 460px void; the canonical placeholder says what the instrument is
        // waiting for.
        if (n === undefined) return <Awaiting icon={ScanLine} label={t.awaiting_read} />;
        // 22px is the ceiling — the size the reference app uses for its one
        // hub-scale numeric readout. At text-6xl this was a 60px glyph, four
        // times the largest type anywhere else and six times the chrome around
        // it: a car with three faults read as an alarm poster rather than an
        // instrument.
        return (
            <div className="flex h-full flex-col items-center justify-center">
                <div
                    className={`font-mono text-[22px] font-bold leading-none tabular-nums ${
                        n === 0 ? 'text-emerald-400' : 'text-red-400'
                    }`}
                >
                    {n}
                </div>
                <div className={`mt-2 ${LABEL} text-slate-500`}>
                    {n === 0 ? t.viz_clean : t.viz_faults}
                </div>
            </div>
        );
    }

    if (tab === 'datalog') return <Sparkline datalog={datalog} />;

    if (tab === 'adaptation') {
        const blocks = link.adaptations;
        if (blocks === null) return <Awaiting icon={ListChecks} label={t.awaiting_read} />;
        // How many of the ECU's answers actually decoded. A block that came back
        // short is counted as read and NOT as a value — the pane says which one
        // and by how many bytes, and the number here must not quietly round that
        // up into "everything is fine".
        const ok = blocks.filter((b) => !b.error && !b.short).length;
        return (
            <div className="flex h-full flex-col items-center justify-center">
                <div
                    className={`font-mono text-[22px] font-bold leading-none tabular-nums ${
                        ok === blocks.length ? 'text-emerald-400' : 'text-amber-400'
                    }`}
                >
                    {ok}
                    <span className="text-slate-600">/{blocks.length}</span>
                </div>
                <div className={`mt-2 ${LABEL} text-slate-500`}>{t.viz_adaptationBlocks}</div>
            </div>
        );
    }

    // A job is selected: the question is no longer "what is in this list" but
    // "what happens if I press the button", so answer that instead.
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
                lastRun={link.lastRun?.jobId === selectedJob.id ? link.lastRun : null}
            />
        );
    }

    if (!catalog || catalog.jobs.length === 0) return <Awaiting icon={ListChecks} label={t.awaiting_catalog} />;

    const mix = { high: 0, medium: 0, low: 0 };
    for (const j of catalog.jobs) mix[jobRiskOf(j)]++;
    const total = catalog.jobs.length;
    // The class breakdown is the answer to "what IS this module", and it is the
    // fact the two-tab split was silently asserting without ever showing.
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
 * The canonical empty state: a dashed ring, a dimmed glyph, and terse mono
 * uppercase copy. Calm and centred — an instrument awaiting input, never an
 * error shout. This is the one placeholder shape; reuse it rather than
 * inventing a per-view em-dash.
 */
function Awaiting({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
    return (
        <div className="flex h-full flex-col items-center justify-center text-slate-700">
            <div className="mb-4 flex size-16 items-center justify-center rounded-full border-2 border-dashed border-slate-800 opacity-50">
                <Icon className="size-6 opacity-50" />
            </div>
            <p className="font-mono text-xs uppercase opacity-50">{label}</p>
        </div>
    );
}

/** A single-channel trace. Enough to see the shape; the pane shows the numbers. */
function Sparkline({ datalog }: { datalog: ReturnType<typeof useDatalog> }) {
    const { t, lang } = useLang();
    const id = datalog.selected[0];
    // The trace's own label followed the rest of the app's inversion: it printed
    // the raw channel id, `3:n`, in the one slot the eye reads as the name.
    const ch = id ? MSS54_CHANNELS.get(id) : undefined;
    const points = useMemo(() => {
        if (!id) return null;
        const window = datalog.samples.slice(-240);
        const values = window
            .map((s) => s.values[id])
            .filter((v): v is number => v !== null && v !== undefined);
        if (values.length < 2) return null;
        const min = Math.min(...values);
        const max = Math.max(...values);
        const span = max - min || 1;
        return {
            min,
            max,
            d: values
                .map((v, i) => `${(i / (values.length - 1)) * 100},${100 - ((v - min) / span) * 100}`)
                .join(' '),
        };
    }, [datalog.samples, id]);

    if (!points) return <Awaiting icon={Activity} label={t.awaiting_samples} />;

    return (
        <div className="flex h-full flex-col">
            <div className="flex items-baseline justify-between font-mono text-[10px] text-slate-600">
                <span className="flex min-w-0 items-baseline gap-1.5">
                    <span className="truncate font-sans text-slate-300">
                        {ch ? (lang === 'en' ? ch.field.name : ch.field.ja) : id}
                    </span>
                    <span className="shrink-0 text-slate-600">{id}</span>
                </span>
                <span>
                    {points.min.toFixed(1)} – {points.max.toFixed(1)}
                </span>
            </div>
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="min-h-0 w-full flex-1">
                <polyline
                    points={points.d}
                    fill="none"
                    stroke="#26AEE4"
                    strokeWidth="1"
                    vectorEffect="non-scaling-stroke"
                />
            </svg>
        </div>
    );
}

/**
 * Normalise a fault / freeze-frame code for lookup.
 *
 * NOT `toUpperCase()`. The table writes `0x2A` and `formatErrorCode` produces
 * `0x2A`, but `"0x2A".toUpperCase()` is `"0X2A"` — the `x` uppercases too — so a
 * map keyed that way misses every single code while looking perfectly correct.
 * That is precisely how the freeze frames kept rendering as raw bytes with a
 * decode table sitting right there.
 */
function normCode(s: string): string {
    return s.trim().toLowerCase();
}

function DiagnosisPane({ link, catalog }: { link: Link; catalog: EcuProfile | null }) {
    const { lang, t } = useLang();
    const [query, setQuery] = useState('');

    // Code-keyed now. The old table was an unindexed bag of strings scraped by
    // XOR-ing the .prg and truncated at exactly 250, so a fault could be looked
    // up only by reading German. FORTTEXTE is the SGBD's real mapping.
    const faultByCode = useMemo(
        () => new Map((catalog?.faultText ?? []).map((f) => [normCode(f.code), f])),
        [catalog],
    );
    const envByCode = useMemo(
        () => new Map((catalog?.envFields ?? []).map((e) => [normCode(e.code), e])),
        [catalog],
    );

    // No slice, and no empty-on-empty-query. Returning [] with no query made the
    // counter read `0 / 226`, which is what "no matches" looks like — on a list
    // that had simply not been asked anything yet. The jobs list renders 115 rows
    // without complaint; 226 is not the problem.
    const hits = useMemo(() => {
        if (!catalog) return [];
        const q = query.trim().toLowerCase();
        if (!q) return catalog.faultText;
        return catalog.faultText.filter((f) => {
            if (f.code.toLowerCase().includes(q)) return true;
            const x = catalog.texts[f.text];
            return !!x && [x.de, x.ja, x.en].some((s) => s.toLowerCase().includes(q));
        });
    }, [catalog, query]);

    return (
        <Pane>
            {link.ident && (
                <Section title="IDENT" note={t.ident_note(link.ident.length)}>
                    <Well className="max-w-[60ch]">
                        <p className="break-all font-mono text-xs text-slate-300">{link.ident.hex}</p>
                    </Well>
                </Section>
            )}

            {/* The ECU's learned values used to be a section here, read from a
                sub-action button. They have their own tab now — see
                `AdaptationPane`. They are not a footnote to the fault memory:
                after a repair they are the thing you came to look at, and the
                ECU's reset for them needed somewhere to be refused out loud. */}

            <Section title={t.faults_read} count={link.faults?.length}>
            {link.faults === null ? (
                <p className="py-2 font-mono text-xs uppercase text-slate-600">{t.awaiting_read}</p>
            ) : link.faults.length === 0 ? (
                <p className="py-2 text-xs text-emerald-400">{t.faults_none}</p>
            ) : (
                <DataList>
                    {link.faults.map((f) => {
                        const code = formatErrorCode(f.errorCode);
                        const known = faultByCode.get(normCode(code));
                        const meaning = known && catalog ? resolveText(catalog, known.text, lang) : null;
                        return (
                            <DataRow
                                key={`${f.number}-${f.errorCode}`}
                                code={code}
                                codeTone="danger"
                                name={meaning?.text ?? humanName('')}
                                trailing={
                                    <span className="shrink-0 font-mono text-[10px] text-slate-600">
                                        {formatErrorCode(f.errorType)}
                                    </span>
                                }
                                detail={
                                    <>
                                        {meaning?.original && meaning.original !== meaning.text && (
                                            <p className="font-mono text-[10px] text-slate-500">{meaning.original}</p>
                                        )}
                                        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                                            <Field label={t.faults_frequency} value={f.frequencyCounter} />
                                            <Field label={t.faults_logistics} value={f.logisticsCounter} />
                                        </div>
                                        <MicroLabel>{t.faults_freezeFrames}</MicroLabel>
                                        {f.environmentSets.map((s, i) => (
                                            <FreezeFrame
                                                key={i}
                                                index={i}
                                                bytes={[s.condition1, s.condition2, s.condition3, s.condition4]}
                                                counter={s.counter}
                                                codes={known?.env}
                                                envByCode={envByCode}
                                                profile={catalog}
                                                lang={lang}
                                            />
                                        ))}
                                    </>
                                }
                            />
                        );
                    })}
                </DataList>
            )}
            </Section>

            {catalog && (
                <Section title={t.faultRef} count={catalog.faultText.length} note={t.faultRef_note}>
                    <ListControls
                        query={query}
                        onQuery={setQuery}
                        placeholder={t.faultRef_search}
                        shown={hits.length}
                        total={catalog.faultText.length}
                    />
                    <DataList className="mt-3">
                        {hits.map((f) => {
                            const x = resolveText(catalog, f.text, lang);
                            return (
                                <DataRow
                                    key={f.code}
                                    code={f.code}
                                    name={x.text}
                                    detail={
                                        x.original !== x.text ? (
                                            <p className="font-mono text-[10px] text-slate-500">{x.original}</p>
                                        ) : undefined
                                    }
                                />
                            );
                        })}
                    </DataList>
                </Section>
            )}
        </Pane>
    );
}

/**
 * The ECU's learned values, and the ECU's own way of throwing them away.
 *
 * Two halves that have to be on one screen. The read is what an owner wants
 * after a repair — lambda adaptation, knock adaptation, throttle adaptation,
 * lifetime misfire counters. The reset is the thing they will reach for next,
 * and it is a WRITE this app does not send. Putting the read behind a
 * sub-action button and leaving the reset to be found among 223 rows in SERVICE
 * meant the refusal was never stated where the question gets asked.
 *
 * Both reset jobs go through `mayRun` — the same gate the SERVICE tab uses, with
 * the same telegram table and the same ledger. Not a second opinion rendered
 * next to the first: a second derivation is a second chance to disagree, and
 * this one would be disagreeing about whether to write to an engine controller.
 */
function AdaptationPane({
    link,
    catalog,
    ecuId,
    telegrams,
    ledger,
}: {
    link: Link;
    catalog: EcuProfile | null;
    ecuId: string;
    telegrams: TelegramTable | null;
    ledger: Ledger;
}) {
    const { t, lang } = useLang();

    // The block table is MSS54's. The other two modules have adaptation data in
    // the ECU and no ported decoder for it here, which is a different statement
    // from "this module has none" — so say that, rather than showing an empty
    // list that reads as a car with nothing learned.
    const decoded = ecuId === 'mss54';

    const known = resetJobsFor(ecuId);
    const resets = useMemo(() => {
        if (!catalog) return [];
        const index = jobIndex(catalog);
        return resetJobsFor(ecuId).ids.flatMap((id) => {
            const job = index.get(id);
            if (!job) return [];
            return [{ job, verdict: mayRun(job, bestTelegram(telegrams, id), ledger, { moduleId: ecuId }) }];
        });
    }, [catalog, telegrams, ledger, ecuId]);

    return (
        <Pane>
            <Section title={t.adaptations} note={t.adaptations_note}>
                {!decoded ? (
                    <p className="py-2 text-[11px] leading-relaxed text-slate-500">{t.adaptations_noDecoder}</p>
                ) : link.adaptations === null ? (
                    <p className="py-2 font-mono text-xs uppercase text-slate-600">{t.awaiting_read}</p>
                ) : (
                    link.adaptations.map((b) => (
                        <div key={b.selection} className="mb-4 last:mb-0">
                            <MicroLabel>{b.name}</MicroLabel>
                            {b.error ? (
                                <p className="mt-1 text-[11px] text-red-400">{b.error}</p>
                            ) : (
                                <>
                                    {b.short && (
                                        <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
                                            {t.adaptations_short(b.payloadLength, b.requiredLength)}
                                        </p>
                                    )}
                                    <DataList className="mt-1.5">
                                        {b.values.map((v) => (
                                            <DataRow
                                                key={v.symbol}
                                                name={humanName(v.de || v.name)}
                                                ident={v.symbol}
                                                trailing={
                                                    <span className="shrink-0 font-mono text-xs tabular-nums text-slate-200">
                                                        {v.value === null ? '—' : v.value.toFixed(3)}
                                                        {v.unit && (
                                                            <span className="ml-1 text-slate-500">{v.unit}</span>
                                                        )}
                                                    </span>
                                                }
                                            />
                                        ))}
                                    </DataList>
                                </>
                            )}
                        </div>
                    ))
                )}
            </Section>

            {/* The reset section renders whether or not there are jobs to show:
                on SMG II and DSC its absence would otherwise read as "reset is
                available here", which is the one misreading that costs someone
                an engine's worth of learned values. */}
            <Section title={t.adaptationsReset} note={t.adaptationsReset_note}>
                {resets.length === 0 ? (
                    // "None" and "not checked" are different sentences. An empty
                    // list under the wrong one is the app asserting a module has
                    // no erase job when nobody has looked — which is precisely
                    // how the first draft of this pane lied about SMG II.
                    <p className="py-2 text-[11px] leading-relaxed text-slate-500">
                        {known.known ? t.adaptationsReset_none : t.adaptationsReset_unknown}
                    </p>
                ) : (
                    <DataList>
                        {resets.map(({ job, verdict }) => (
                            <DataRow
                                key={job.id}
                                name={label(job, lang)}
                                ident={job.id}
                                trailing={
                                    <span className={`shrink-0 ${LABEL} text-slate-600`}>
                                        {verdict.allowed ? t.gate_verified : t.op_blocked}
                                    </span>
                                }
                                detail={
                                    verdict.allowed ? undefined : (
                                        <p className="text-[11px] leading-relaxed text-slate-500">
                                            {t.runBlock[verdict.reason]}
                                        </p>
                                    )
                                }
                            />
                        ))}
                    </DataList>
                )}
            </Section>
        </Pane>
    );
}

/**
 * A freeze frame, decoded.
 *
 * This used to print `20 40 60 80` — four raw bytes with no names and no units,
 * because the decode table was not in the dump. `FUMWELTTEXTE` carries the field
 * name, the unit and the arithmetic, and `FORTTEXTE.UW_1..UW_4` says WHICH four
 * fields this particular fault stored. Both arrived with the Phase 0 re-dump.
 *
 * Where the fault does not name its fields, the raw bytes are still shown. A
 * missing table means "we cannot name these", not "there was nothing here".
 */
function FreezeFrame({
    index,
    bytes,
    counter,
    codes,
    envByCode,
    profile,
    lang,
}: {
    index: number;
    bytes: number[];
    counter: number;
    codes?: string[];
    envByCode: Map<string, NonNullable<EcuProfile['envFields']>[number]>;
    profile: EcuProfile | null;
    lang: Lang;
}) {
    const hex = bytes.map((b) => b.toString(16).padStart(2, '0')).join(' ');
    const decoded =
        codes && profile
            ? bytes.map((b, i) => {
                  const e = codes[i] ? envByCode.get(normCode(codes[i])) : undefined;
                  if (!e) return null;
                  const value = b * (e.scale ?? 1) + (e.add ?? 0);
                  return { name: resolveText(profile, e.text, lang).text, value, unit: e.unit };
              })
            : null;

    return (
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <span className="font-mono text-[10px] text-slate-600">
                #{index + 1} {hex} ×{counter}
            </span>
            {decoded?.map(
                (d, i) =>
                    d && (
                        <Field
                            key={i}
                            label={d.name}
                            labelKind="data"
                            value={Number.isInteger(d.value) ? d.value : d.value.toFixed(1)}
                            unit={d.unit}
                        />
                    ),
            )}
        </div>
    );
}

function DatalogPane({ datalog }: { datalog: ReturnType<typeof useDatalog> }) {
    const { t, lang } = useLang();
    return (
        <Pane>
            {/* Readouts, not a bare strip of mono text. This row was the one
                place in the app that looked like neither a section nor a list. */}
            <Section title={t.datalog_run} note={datalog.costNotice}>
                <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
                    <Field label={t.samples} value={datalog.samples.length} />
                    <Field
                        label={t.rate}
                        value={datalog.rateHz ? datalog.rateHz.toFixed(1) : '—'}
                        unit={datalog.rateHz ? 'Hz' : undefined}
                    />
                </div>
                {/* The export describes the RUN. Once the selection has moved on
                    from it, say so — otherwise the file and the list above
                    disagree and only the file is right. */}
                {datalog.selectionDrifted && (
                    <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
                        {t.datalog_exportsRun(datalog.recorded.length)}
                    </p>
                )}
            </Section>

            <Section title={t.channels} count={datalog.selected.length}>
                <DataList>
                    {datalog.selected.map((id) => {
                        const ch = MSS54_CHANNELS.get(id);
                        const v = datalog.latest[id];
                        return (
                            <DataRow
                                key={id}
                                name={humanName(
                                    ch ? (lang === 'en' ? ch.field.name : ch.field.ja) : '',
                                )}
                                ident={ch?.field.symbol ?? id}
                                // The block is part of the channel's identity, so
                                // it is shown where the identity is shown.
                                code={ch ? String(ch.block.selection) : undefined}
                                trailing={
                                    <span className="shrink-0 font-mono text-xs tabular-nums text-slate-200">
                                        {v == null ? '—' : v.toFixed(2)}
                                    </span>
                                }
                            />
                        );
                    })}
                </DataList>
            </Section>

            <ChannelPicker selected={datalog.selected} disabled={datalog.running} onToggle={datalog.toggle} />
        </Pane>
    );
}

/**
 * The channel picker — the same recipe as the jobs pane, not its own idiom.
 *
 * It used to be `<details>` / `<summary>` / `<label>` with its own uppercase
 * group headers, its own `(32)` count format, its own row height and a nested
 * scroller, sitting next to a jobs list that had a search box, facet chips with
 * counts, and none of those things. Two lists of a few hundred rows, doing the
 * same job, looking nothing alike.
 *
 * Now: search, block chips carrying their counts, one DataList. The block is a
 * FACET rather than a container because a block is a cost — one round trip per
 * block per sample — so what you want is to see the count, not to fold it away.
 *
 * Still memoized. Without it every sample flush re-rendered all 213 rows, and
 * against a synchronous simulator that starved the poll loop badly enough to
 * report 1.0 Hz — the app measuring itself instead of the link, in the one view
 * whose job is to report the link's real rate.
 */
const ChannelPicker = memo(function ChannelPicker({
    selected,
    disabled,
    onToggle,
}: {
    selected: readonly ChannelId[];
    disabled: boolean;
    onToggle: (id: ChannelId, on: boolean) => void;
}) {
    const { t, lang } = useLang();
    const [query, setQuery] = useState('');
    const [block, setBlock] = useState<number | 'all'>('all');

    const all = useMemo(
        () => MSS54_LIVE_BLOCKS.flatMap((b) => b.fields.map((f) => ({ ...f, block: b }))),
        [],
    );
    const rows = useMemo(() => {
        const q = query.trim().toLowerCase();
        return all.filter((f) => {
            if (block !== 'all' && f.block.selection !== block) return false;
            if (!q) return true;
            // Every name a channel has is searchable: the symbol, the Japanese,
            // the reference English and the SGBD German. Someone reading a wiring
            // diagram has the German; someone reading a forum post has the symbol.
            return (
                f.symbol.toLowerCase().includes(q) ||
                f.ja.includes(query.trim()) ||
                f.name.toLowerCase().includes(q) ||
                (f.de ?? '').toLowerCase().includes(q)
            );
        });
    }, [all, query, block]);

    return (
        <Section title={t.channels_pick} count={all.length}>
            <ListControls
                query={query}
                onQuery={setQuery}
                placeholder={t.channels_search}
                shown={rows.length}
                total={all.length}
                hiddenNote={rows.length < all.length ? t.facet_hidden(all.length - rows.length) : undefined}
            >
                <FacetRow label={t.channels_block}>
                    <Chip active={block === 'all'} onClick={() => setBlock('all')}>
                        {t.facet_all}
                    </Chip>
                    {MSS54_LIVE_BLOCKS.map((b) => (
                        <Chip
                            key={b.selection}
                            active={block === b.selection}
                            count={b.fields.length}
                            title={t.channels_blockNote(b.selection)}
                            onClick={() => setBlock(block === b.selection ? 'all' : b.selection)}
                        >
                            {lang === 'en' ? b.name : b.ja}
                        </Chip>
                    ))}
                </FacetRow>
            </ListControls>

            <DataList className="mt-3">
                {rows.map((f) => {
                    const id = channelId(f.block.selection, f.symbol);
                    const on = selected.includes(id);
                    // 10 quantities are readable from two blocks. Naming the
                    // other one is what replaces the solver that used to pick
                    // silently: a channel already covered by a block you are
                    // reading costs no extra round trip, and now you can see it.
                    const also = (MSS54_BLOCKS_BY_SYMBOL.get(f.symbol) ?? [])
                        .filter((b) => b.selection !== f.block.selection)
                        .map((b) => b.selection);
                    return (
                        <DataRow
                            key={id}
                            selected={on}
                            onSelect={disabled ? undefined : () => onToggle(id, !on)}
                            leading={
                                <input
                                    type="checkbox"
                                    checked={on}
                                    disabled={disabled}
                                    readOnly
                                    tabIndex={-1}
                                    className="size-3 shrink-0 accent-blue-500"
                                />
                            }
                            name={humanName(lang === 'en' ? f.name : f.ja)}
                            // The SGBD's own German where the join found it, and the
                            // symbol otherwise. It goes in the identifier slot rather
                            // than a `detail` line: as a detail it made 86 of 213 rows
                            // taller than the other 127, and a list whose row height
                            // alternates down the page is the reflow this system
                            // reserves slots to avoid.
                            ident={f.de ? `${f.symbol} · ${f.de}` : f.symbol}
                            // Same datum, same slot as the selected-channel
                            // list above: the block IS part of the identity.
                            code={String(f.block.selection)}
                            trailing={
                                <>
                                    {f.unit && (
                                        <span className="shrink-0 font-mono text-[11px] text-slate-500">{f.unit}</span>
                                    )}
                                    {also.length > 0 && (
                                        <span
                                            title={t.channels_alsoInNote}
                                            className={`shrink-0 ${LABEL} text-slate-600`}
                                        >
                                            {t.channels_alsoIn(also.join(' / '))}
                                        </span>
                                    )}
                                </>
                            }
                        />
                    );
                })}
            </DataList>
        </Section>
    );
});

/** A bound on the in-memory run, stated rather than silent. */
const MAX_SAMPLES = 200_000;
const FLUSH_INTERVAL_MS = 500;

function useDatalog(link: Link) {
    const { t } = useLang();
    // Engine speed and coolant temperature, both from block 3 — one round trip.
    // Written as channel ids, not symbols: `n` alone does not say which block,
    // and block 35 carries an `n` too.
    const [selected, setSelected] = useState<ChannelId[]>([channelId(3, 'n'), channelId(3, 'tmot')]);
    const [samples, setSamples] = useState<LiveSample[]>([]);
    const [latest, setLatest] = useState<Partial<Record<ChannelId, number | null>>>({});
    const samplesRef = useRef<LiveSample[]>([]);
    const flushAtRef = useRef(0);
    /**
     * The channels the RUN recorded, frozen at start.
     *
     * The CSV used to be written from the live `selected` array, and the picker
     * re-enables the moment a run stops. Deselect a channel afterwards and its
     * column vanished from the file - data that WAS captured, silently dropped;
     * select a new one and an empty column appeared as though it had been
     * recorded. A file has to describe the run that happened, not the state of
     * the UI when someone clicked export.
     */
    const recordedRef = useRef<ChannelId[]>([]);
    const [recorded, setRecorded] = useState<ChannelId[]>([]);

    const plan = useMemo(() => planBlockReads(selected), [selected]);
    const running = link.state === 'logging';

    const rateHz = useMemo(() => {
        const s = samples.slice(-24);
        if (s.length < 2) return null;
        const span = s[s.length - 1].time - s[0].time;
        return span > 0 ? (s.length - 1) / span : null;
    }, [samples]);

    const onSample = useCallback((sample: LiveSample) => {
        // push, not concat: concat copies the whole array every sample, which is
        // quadratic in the run length and hung the renderer once the exchange
        // got fast.
        const buf = samplesRef.current;
        buf.push(sample);
        if (buf.length > MAX_SAMPLES) buf.splice(0, buf.length - MAX_SAMPLES);
        const now = performance.now();
        if (now - flushAtRef.current < FLUSH_INTERVAL_MS) return;
        flushAtRef.current = now;
        setLatest(sample.values);
        setSamples(buf.slice());
    }, []);

    const start = useCallback(() => {
        samplesRef.current.length = 0;
        flushAtRef.current = 0;
        setSamples([]);
        // Stale readings from a previous run must not survive into this one's
        // readout while the first sample is still in flight.
        setLatest({});
        recordedRef.current = [...selected];
        setRecorded([...selected]);
        // Both endings land in the same place: the stop button and a link
        // failure. A run that dies must not leave the view looking live.
        link.startLog(selected, onSample, () => setSamples(samplesRef.current.slice()));
    }, [link, onSample, selected]);

    const toggle = useCallback((id: ChannelId, on: boolean) => {
        setSelected((prev) => (on ? [...prev, id] : prev.filter((s) => s !== id)));
    }, []);

    // Headings are channel ids — `3:n`, `35:n` — so a file that read both blocks
    // has two distinct columns instead of one column called `n` holding the
    // last block read. The colon is CSV-safe and the pair is machine-readable.
    const exportCsv = useCallback(() => {
        const rows = [
            ['time_s', ...recordedRef.current].join(','),
            ...samplesRef.current.map((s) =>
                [s.time.toFixed(3), ...recordedRef.current.map((k) => s.values[k] ?? '')].join(','),
            ),
        ];
        download(rows.join('\r\n'), 'text/csv', `e46m3-datalog-${stamp()}.csv`);
        // No dependency on `selected` — that is the whole point. The file
        // describes the run, and the run is over.
    }, []);

    // The selection has moved away from what the last run recorded, so the file
    // and the on-screen list now describe different things.
    const selectionDrifted =
        recorded.length > 0 &&
        (recorded.length !== selected.length || recorded.some((c, i) => c !== selected[i]));

    return {
        selected,
        /** What the last run actually captured. Empty until one has been started. */
        recorded,
        selectionDrifted,
        samples,
        latest,
        rateHz,
        running,
        start,
        stop: link.stopLog,
        toggle,
        exportCsv,
        // The cost model, stated: one round trip per BLOCK, not per channel.
        costNotice: t.channels_selected(selected.length, plan.blocks.length),
    };
}

function EcuSelect({
    index,
    value,
    disabled,
    onChange,
}: {
    index: EcuIndexEntry[];
    value: string;
    disabled: boolean;
    onChange: (id: string) => void;
}) {
    // No label inside the chip: the status row it sits in already says MODULE,
    // and printing it twice on one 32px line is the sort of thing that makes a
    // panel look unread.
    //
    // English in both languages, so this takes no `lang`. `MSS54`, `SMG II` and
    // `DSC` are the ECUs' own designations and `S54 / E46 M3` is a chassis code —
    // the whole string is machine identity, not prose, and it sits in a row of
    // English chrome tokens (MODULE, PRACTICE) under English tabs. The Japanese
    // variant only ever translated the one common noun in it (エンジン / 変速機),
    // which bought nothing and broke the row's vocabulary.
    return (
        <div className="flex items-center rounded bg-slate-800 px-2 py-0.5">
            <select
                value={value}
                disabled={disabled || index.length === 0}
                onChange={(e) => onChange(e.target.value)}
                className="max-w-52 cursor-pointer bg-transparent text-[10px] font-bold text-blue-400 outline-none disabled:cursor-not-allowed disabled:opacity-60"
            >
                {index.map((e) => (
                    <option key={e.id} value={e.id} className="bg-slate-900 text-slate-300">
                        {e.name_en || e.name}
                    </option>
                ))}
            </select>
        </div>
    );
}

/**
 * Permanent, not dismissible. Every number this app can display comes from a
 * static scrape of SGBD bytecode or a decompiled catalog, and none of it has
 * been confirmed against a car. Behind a one-time dialog, the app's own
 * uncertainty is the first thing a user forgets.
 *
 * Built as the 26px context bar rather than a tinted panel: it is a standing
 * condition of the whole app, so it reads as chrome, and a permanent banner that
 * shouts stops being read within a day.
 */
function UnverifiedBanner() {
    const { t } = useLang();
    return (
        <footer className="flex h-[26px] flex-none items-center border-t border-slate-900 bg-slate-950/60 px-4">
            <p className="truncate text-[10px] tracking-wide text-amber-400/80">{t.unverified}</p>
        </footer>
    );
}

function exportLog(log: CommsLogLine[]) {
    const text = log
        .map((l) => `${new Date(l.t).toISOString()} ${l.kind.toUpperCase().padEnd(5)} ${l.text}`)
        .join('\r\n');
    download(text, 'text/plain', `e46m3-comms-${stamp()}.txt`);
}

function download(content: string, type: string, filename: string) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

function stamp() {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

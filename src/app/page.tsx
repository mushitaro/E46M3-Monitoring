'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { AlertTriangle, Download, RotateCcw, Square } from 'lucide-react';
import { AppHeader } from '@/components/AppHeader';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { CreditsDialog } from '@/components/CreditsDialog';
import { DisclaimerDialog } from '@/components/DisclaimerDialog';
import { ElectricalFaultDialog } from '@/components/ElectricalFaultDialog';
import { LogPopover } from '@/components/LogPopover';
import { BAR, ModuleRow, TabBar } from '@/components/shell/Chrome';
import { ControlPanel } from '@/components/shell/ControlPanel';
import { Overlaid } from '@/components/shell/Overlaid';
import { LABEL, TextButton } from '@/components/ui';
import { useActuatorArming } from '@/hooks/useActuatorArming';
import { useDs2Link } from '@/hooks/useDs2Link';
import { useHub } from '@/hooks/useHub';
import { useUnloadGuard } from '@/hooks/useUnloadGuard';
import { disclaimerStore } from '@/lib/disclaimer';
import { exportCommsLog } from '@/lib/download';
import {
    jobIndex,
    loadEcuCatalog,
    loadEcuIndex,
    type CatalogJob,
    type EcuIndex,
    type EcuProfile,
} from '@/lib/ecuCatalog';
import { useLang } from '@/lib/i18n';
import { hasStopControl, operationFor } from '@/lib/jobOps';
import { loadJobText, type JobTextTable } from '@/lib/jobText';
import { loadDscHydraulics, type DscHydraulics } from '@/lib/dscHydraulics';
import { EMPTY_LEDGER, type Ledger } from '@/lib/ledger';
import { mayRun, type RunVerdict } from '@/lib/runGate';
import { loadSmg2Workflows, type Smg2Workflows } from '@/lib/smg2Workflows';
import type { Tab } from '@/lib/tabs';
import { bestTelegram, loadTelegrams, type TelegramTable } from '@/lib/telegrams';
import { ActuatorView } from '@/views/actuator/ActuatorView';
import { ActuatorViz } from '@/views/actuator/ActuatorViz';
import { AdaptationView, AdaptationViz } from '@/views/adaptation/AdaptationView';
import { DiagnosisView, DiagnosisViz } from '@/views/diagnosis/DiagnosisView';
import { DatalogView, DatalogViz } from '@/views/datalog/DatalogView';
import { useDatalog } from '@/views/datalog/useDatalog';
import { ServiceView, ServiceViz, procedureForJob } from '@/views/service/ServiceView';
import { WizardDialog } from '@/views/service/WizardDialog';

/**
 * The shell.
 *
 * It owns the session — the link, the module, the selection, the recording — and
 * decides two things: which pane is up, and what the hub is. Everything else is
 * somewhere with a name. The views are in `views/`, the furniture in
 * `components/shell/Chrome.tsx`, the hub's decision in `lib/hub` (the link's
 * tiers) and `lib/viewHub` (the view's), and the file-saving in `lib/download`.
 * They left because a 1,880-line component is a place where a decision cannot be
 * found, let alone tested.
 *
 * ## Layout
 *
 * The ///M spatial system rather than something invented: a 48px app header
 * whose bottom rule is the tricolor stripe, then a phi (61.8 / 38.2) split. Each
 * column opens with its OWN 44px bar — tabs on the left, the module identity on
 * the right — so the two rules meet and form one continuous line across the
 * split. The right column then stacks a visualization region and a control panel
 * holding the status row, a RESERVED notice line, the hub cluster and a RESERVED
 * sub-action row.
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
 *
 * ## The panes are overlaid, not swapped
 *
 * All five panes and all five visualizations occupy one grid cell each
 * (`[grid-area:1/1]`) and the inactive ones are `invisible` rather than
 * unmounted. Three things follow, and they are the reason:
 *
 *   - Each pane keeps its own scroller, so its scroll position is its own.
 *     Sharing one scroller meant leaving a fault list halfway down and arriving
 *     mid-page in ADAPTATION.
 *   - A search box, a facet and a checkbox survive a tab change. They used to be
 *     thrown away on the way out and rebuilt empty on the way back.
 *   - `visibility: hidden` takes an element out of the tab order, so a hidden
 *     pane's buttons cannot be reached by keyboard. `opacity-0` would not.
 *
 * What follows in the other direction is that a hidden pane must not WORK. It
 * still re-renders whenever the shell does — including twice a second while a
 * log is running — so:
 *
 *   - the views take the DATA they render rather than the whole link object,
 *     which is what makes them `memo`-able at all (the link is a fresh object
 *     every render, so a view handed it can never skip);
 *   - DIAGNOSIS, ADAPTATION and SERVICE are `memo`ed, which covers the three
 *     long lists. DATALOG is the view that is up during the run this protects,
 *     and ACTUATOR takes the arming map, which changes when it should;
 *   - the datalog trace is told whether it is being looked at, so it does not
 *     recompute 240 points to draw an `invisible` polyline.
 *
 * The rate this protects could not be measured through the in-app browser: a
 * hidden pane has its timers throttled, which slows the poll loop far more than
 * any rendering does. It is a structural guard, not a measured one, and it is
 * written down here so the next person knows which.
 */
export default function Home() {
    const { lang, t } = useLang();
    const link = useDs2Link();
    const [tab, setTab] = useState<Tab>('diagnosis');

    const [ecuIndex, setEcuIndex] = useState<EcuIndex | null>(null);
    const [ecuId, setEcuId] = useState('mss54');
    const [loaded, setLoaded] = useState<{ id: string; catalog: EcuProfile } | null>(null);
    const [catalogError, setCatalogError] = useState<string | null>(null);
    const catalog = loaded?.id === ecuId ? loaded.catalog : null;
    const ledger: Ledger = EMPTY_LEDGER;

    // Datalog state lives here so the right column can visualise a run while
    // the datalog tab is not the one on the left.
    const datalog = useDatalog(link);

    // Which outputs are energised. Held here, not in the ACTUATOR view, because
    // the release has to survive that view unmounting — a tab change must not be
    // the thing that forgets a solenoid is on.
    const arming = useActuatorArming({ send: link.runRead });

    /**
     * Make leaving deliberate while a write is in flight OR an output is on.
     *
     * The second half is the one that matters here. A write is seconds; an armed
     * actuator can sit energised indefinitely, and a Ctrl+R would take away the
     * only page able to send its stop. `useUnloadGuard`'s own header explains why
     * this is a nudge and not a lock, and what covers the rest.
     */
    useUnloadGuard(link.state === 'busy' || arming.anyArmed, 30 * 60_000);

    /**
     * Every exit from "we can send" releases what is engaged, and AWAITS it.
     *
     * Not an effect cleanup: a cleanup cannot await, so React would take the
     * promise, drop it, and by the time it wanted the link the link would be
     * closed — leaving the output on with nothing able to reach the ECU. So the
     * release is spelled out at each door.
     */
    const releaseThen = useCallback(
        async (then: () => void | Promise<void>) => {
            await arming.stopAll();
            await then();
        },
        [arming],
    );

    // <html lang> is DERIVED from the resolved language, here, and nowhere else.
    // The attribute layout.tsx renders is a prerender placeholder: this is a
    // static export, so every visitor is served the same `lang="ja"` regardless
    // of who they are. i18n.ts resolves the real language at module import in
    // the browser (stored choice, else navigator), which fixes the COPY but left
    // the attribute lying to screen readers and to browser translation for every
    // reader who never touched the ja|en toggle. Writing it only inside setLang()
    // meant the correction arrived on the switch — the one moment it was already
    // obvious what language the app was in.
    // It runs in an effect rather than at import time so it lands after
    // hydration and cannot be mistaken for a mismatch on the <html> element
    // React itself rendered; keying it on `lang` covers the boot and the switch
    // with one rule.
    useEffect(() => {
        document.documentElement.lang = lang;
    }, [lang]);

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

    // The three doors out of "this ECU, right now". Each one releases first.
    const disconnect = useCallback(() => void releaseThen(link.disconnect), [releaseThen, link.disconnect]);
    const changeEcu = useCallback((id: string) => void releaseThen(() => setEcuId(id)), [releaseThen]);
    const changeTab = useCallback((next: Tab) => void releaseThen(() => setTab(next)), [releaseThen]);

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

    // PRACTICE is a MODE the hub then connects in, not a second connect button.
    // As a button beside CONNECT it was a fork with no stated default; as a
    // checkbox the hub reads CONNECT either way and the box says which link you
    // will get — which is also why it is disabled once a session is open.
    const [practiceArmed, setPracticeArmed] = useState(false);
    const [faultOpen, setFaultOpen] = useState(false);
    const [creditsOpen, setCreditsOpen] = useState(false);

    // The SMG II guided procedure. It is a DIALOG rather than a send, because
    // the ECU's own comments describe a sequence — stop before start, a status
    // read by re-asking, up to sixteen minutes with the clutch energised — and
    // the hub cannot express any of that. `lib/procedureRun` holds the protocol.
    const [wizardOpen, setWizardOpen] = useState(false);
    const procedure = selectedJob ? procedureForJob(selectedJob, workflows) : null;

    // The one-time acknowledgement, read from storage as an external store so
    // the prerender is dialog-free and nothing flashes at a reader who agreed
    // months ago. `lib/disclaimer` explains why it is not a state-plus-effect.
    const agreed = useSyncExternalStore(
        disclaimerStore.subscribe,
        disclaimerStore.snapshot,
        disclaimerStore.serverSnapshot,
    );

    // One verdict, computed once, used by the hub AND by the panel. They used to
    // reason about runnability separately, which is how a control that says it
    // can fire ends up beside a panel that says it cannot.
    const runVerdict: RunVerdict | null =
        tab === 'service' && selectedJob
            ? mayRun(selectedJob, bestTelegram(telegrams, selectedJob.id), ledger, { moduleId: ecuId })
            : null;

    // Two pure deciders, wired to this app's glyphs and strings in one hook —
    // `lib/hub` for the link's tiers, `lib/viewHub` for the view's.
    const { hub, notice } = useHub({
        tab,
        link,
        datalog,
        practiceArmed,
        ecuId,
        selectedJob,
        runVerdict,
        catalogError,
        openProcedure: procedure ? () => setWizardOpen(true) : undefined,
    });

    const panes: Record<Tab, React.ReactNode> = {
        diagnosis: <DiagnosisView ident={link.ident} faults={link.faults} catalog={catalog} />,
        datalog: <DatalogView datalog={datalog} />,
        adaptation: (
            <AdaptationView
                blocks={link.adaptations}
                catalog={catalog}
                ecuId={ecuId}
                telegrams={telegrams}
                ledger={ledger}
            />
        ),
        service: catalog ? (
            <ServiceView
                profile={catalog}
                ecuId={ecuId}
                telegrams={telegrams}
                ledger={ledger}
                workflows={workflows}
                hydraulics={hydraulics}
                selectedId={selectedJob?.id ?? null}
                onSelect={selectJob}
            />
        ) : (
            <AwaitingCatalog />
        ),
        actuator: catalog ? (
            <ActuatorView
                profile={catalog}
                telegrams={telegrams}
                ledger={ledger}
                jobText={jobText}
                mode={link.mode}
                arming={arming}
                onRun={link.runRead}
            />
        ) : (
            <AwaitingCatalog />
        ),
    };

    const vizzes: Record<Tab, React.ReactNode> = {
        diagnosis: <DiagnosisViz faults={link.faults} />,
        datalog: <DatalogViz datalog={datalog} active={tab === 'datalog'} />,
        adaptation: <AdaptationViz blocks={link.adaptations} />,
        service: (
            <ServiceViz
                lastRun={link.lastRun}
                catalog={catalog}
                selectedJob={selectedJob}
                telegrams={telegrams}
                jobText={jobText}
                workflows={workflows}
                runVerdict={runVerdict}
            />
        ),
        // ACTUATOR's rows carry their own controls, their own gate verdict and
        // their own refusal text, so the right column has no per-row question
        // left to answer. It answers the only one remaining: what IS this
        // module. Same component SERVICE falls back to, because it is the same
        // question and the numbers are about the module, not the tab.
        actuator: <ActuatorViz profile={catalog} arming={arming} />,
    };

    return (
        <div className="flex h-dvh flex-col overflow-hidden bg-slate-950">
            <AppHeader
                ident={link.ident}
                state={link.state}
                mode={link.mode}
                hasError={!!link.error}
                onCredits={() => setCreditsOpen(true)}
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
                    <TabBar tab={tab} onChange={changeTab}>
                        <LogPopover
                            log={link.log}
                            onClear={link.clearLog}
                            onExport={() => exportCommsLog(link.log)}
                        />
                    </TabBar>
                    <Overlaid active={tab} panes={panes} kind="pane" />
                </section>

                <aside className="relative z-20 flex min-h-0 flex-1 flex-col overflow-hidden bg-slate-900/20 backdrop-blur-sm min-[900px]:w-[38.2%] min-[900px]:flex-none">
                    <div className={BAR}>
                        <span className={`truncate ${LABEL} text-slate-500`}>
                            {t.pane_visualization}
                        </span>
                    </div>

                    {/* The φ split, on the vertical axis too.
                        ────────────────────────────────────────────────────────
                        This used to be "picture takes the slack, controls take
                        their natural height", which made the ratio a side effect
                        of how tall the control content happened to be: 66.9 /
                        33.1 measured at 1280x800, against the reference tool's
                        62.1 / 37.9. The system's proportion rule is φ and
                        layout-and-structure.md says it holds on BOTH axes — the
                        reference measures 1.6178 against φ's 1.6180 — so the
                        split is declared here rather than emerging from content.

                        The wrapper exists because the percentages have to resolve
                        against the space BELOW the 44px bar, not against the
                        whole column. `min-h-fit` on the controls is the floor:
                        the panel's height is constant by construction (every slot
                        in it is reserved), so on a viewport too short for 38.2%
                        to hold it, it stops shrinking rather than scrolling the
                        hub off the bottom. */}
                    <div className="flex min-h-0 flex-1 flex-col">
                        <div className="relative min-h-[140px] flex-1 overflow-hidden bg-gradient-to-b from-slate-900/10 to-transparent p-4">
                            <Overlaid active={tab} panes={vizzes} kind="viz" />
                        </div>

                        <ControlPanel
                            module={
                                <ModuleRow
                                    index={ecuIndex}
                                    ecuId={ecuId}
                                    connected={link.state !== 'disconnected'}
                                    mode={link.mode}
                                    state={link.state}
                                    practiceArmed={practiceArmed}
                                    onPractice={setPracticeArmed}
                                    onDisconnect={disconnect}
                                    onChangeEcu={changeEcu}
                                />
                            }
                            notice={notice}
                            hub={hub}
                        >
                            {/* The two failure kinds need OPPOSITE advice, so only
                                one of these can ever appear: retry is the one
                                action that cannot help an electrical fault, and the
                                checklist is noise for a desync. */}
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
                            {/* DISCONNECT was here. It is now on the MODULE row —
                                see the note in Chrome.tsx. */}
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
                                offered only once faults have actually been read, so
                                the evidence it destroys has at least been on screen
                                once. */}
                            {tab === 'diagnosis' && link.state === 'connected' && link.faults !== null && (
                                <TextButton onClick={() => setClearOpen(true)} tone="danger" Icon={AlertTriangle}>
                                    {t.clearFaults}
                                </TextButton>
                            )}
                            {/* A held or paired job needs a STOP that is NOT the
                                hub: the hub is what started it, and re-deriving one
                                control into "now it stops" is how an operator ends
                                up pressing start twice. `latching` gets none — it
                                has no release job, and a disabled STOP would imply
                                one exists. */}
                            {tab === 'service' && selectedJob && hasStopControl(operationFor(selectedJob)) && (
                                <TextButton disabled tone="destructive" Icon={Square} title={t.gate_practiceOnly}>
                                    {operationFor(selectedJob).kind === 'procedure' ? t.op_abort : t.op_stop}
                                </TextButton>
                            )}
                        </ControlPanel>
                    </div>
                </aside>
            </main>

            {!agreed && <DisclaimerDialog onAgree={() => disclaimerStore.agree()} />}

            {wizardOpen && procedure && catalog && workflows && (
                <WizardDialog
                    procedure={procedure}
                    workflows={workflows}
                    jobs={jobIndex(catalog)}
                    telegrams={telegrams}
                    mode={link.mode}
                    send={link.runRead}
                    onClose={() => setWizardOpen(false)}
                />
            )}

            {creditsOpen && <CreditsDialog onClose={() => setCreditsOpen(false)} />}

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
 * A pane with no catalogue to show.
 *
 * The module's tables load per module and can be slow or absent; SERVICE and
 * ACTUATOR are lists OF that catalogue, so they say what they are waiting for
 * rather than rendering an empty list that reads as "this module has no jobs".
 */
function AwaitingCatalog() {
    const { t } = useLang();
    return <p className="py-2 font-mono text-xs uppercase text-slate-600">{t.awaiting_catalog}</p>;
}

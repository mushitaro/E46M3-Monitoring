'use client';

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { AlertTriangle, PlayCircle, Square } from 'lucide-react';
import { DialogFrame } from '@/components/DialogFrame';
import { ConfirmDetails, ConfirmSteps, Told } from '@/components/gate/ConfirmBody';
import { instructionsIn } from '@/lib/instructions';
import { formatDuration, procedureMaxSec } from '@/lib/duration';
import { DialogButton, Field, LABEL, MicroLabel, Provenance, Well, emphasise } from '@/components/ui';
import { useProcedureRun, type ProcedureOutcome } from '@/hooks/useProcedureRun';
import type { JobRunResult } from '@/hooks/useDs2Link';
import type { CatalogJob } from '@tsunagi/monitoring-engine';
import { useLang } from '@/lib/i18n';
import { planProcedure, type ProcedureBlockKey } from '@/lib/procedureRun';
import type { ActuationPermit, Ledger, Motion, NotSent, SendRequirement } from '@tsunagi/monitoring-engine';
import { notSentLine } from '@/lib/notSentText';
import type { Smg2Procedure, Smg2Workflows } from '@/lib/smg2Workflows';
import type { TelegramTable } from '@tsunagi/monitoring-engine';
import {
    WIZARD_STEPS,
    canAdvance,
    canDismiss,
    canGoBack,
    initialWizard,
    isRunning,
    wizardReducer,
    type WizardShape,
} from '@/lib/wizardSteps';

/**
 * An SMG II test program, from "may I" to "what happened".
 *
 * ## Why this is a wizard and not a button
 *
 * The gearbox controller's own job comments describe a sequence, not a call.
 * `TESTPRG_STOP` must precede `TESTPRG_STARTEN`; the ECU's diagnosis times out
 * in ten seconds; the start job has to be re-sent continuously to get the status
 * back, until that status stops saying "running"; and a full adaptation takes
 * up to sixteen minutes with the clutch actuator energised throughout. A single
 * control cannot express any of that, and a spinner cannot report it.
 * `lib/procedureRun` holds the protocol with the SGBD's sentences quoted beside
 * each rule; this file is one way of showing it.
 *
 * ## The one-way-out rule is a function, not a handler
 *
 * While the gearbox is working the only exit is ABORT. The predecessor enforced
 * that inside the modal's key handler, which is correct and unprovable. Here it
 * is `canDismiss(state)` from `lib/wizardSteps`, so the property has a test —
 * and `DialogFrame` is handed `onClose` only when that function says so, which
 * makes Escape inert for exactly as long as it should be.
 *
 * Dismissing is aborting. There is no quiet close: leaving records ABORTED
 * rather than showing nothing, because "did that finish?" is the question the
 * operator will have and a dialog that vanishes answers it wrongly.
 *
 * ## What the numbers are, and are not
 *
 * The status text, the activity text, the preconditions, the duration and the
 * gear list are all the SGBD's, shown as it wrote them. The BYTE POSITIONS the
 * status is read from are inferred from the specification's wording, so the raw
 * answer is printed beside the decode and a `Provenance` chip says which is
 * which. A decoded value with nothing marking it would be a guess wearing the
 * clothes of a reading.
 */
export function WizardDialog({
    procedure,
    workflows,
    jobs,
    telegrams,
    mode,
    gate,
    send,
    assistant,
    why,
    onEnded,
    onLive,
    onClose,
}: {
    procedure: Smg2Procedure;
    workflows: Smg2Workflows;
    jobs: ReadonlyMap<string, CatalogJob>;
    telegrams: TelegramTable | null;
    mode: 'vehicle' | 'practice';
    /** On a car: the ledger and the car as last measured, for the owner's decision (runGate.mayRunProcedure). */
    gate: { ledger: Ledger; motion: Motion };
    send: (jobId: string, hex: string, requires?: SendRequirement, permit?: ActuationPermit) => Promise<JobRunResult | null>;
    /**
     * Started by the assistant on the owner's spoken OK (monitoring_procedure, after it read back every
     * precondition): the word ticks the boxes and START is pressed once — through the same plan and gate
     * as a press here. Everything else is as on the screen, ABORT included.
     */
    assistant?: { ownerSaid: string; gear?: number };
    /** Why the last send came back empty (the link's own sentence and shape, read straight after the await). */
    why?: () => { error: string | null; notSent: NotSent | null };
    /** Told how the run ended, so the page and the assistant can say it (monitoring_status `lastProcedure`). */
    onEnded?: (outcome: ProcedureOutcome) => void;
    /** Told when the gearbox starts and stops working, with ABORT while it does: the hub's ring is that STOP. */
    onLive?: (abort: (() => void) | null) => void;
    onClose: () => void;
}) {
    const { lang, t } = useLang();
    const pick = (b: { ja: string; en: string }) => (lang === 'en' ? b.en : b.ja);

    const [gear, setGear] = useState<number>(assistant?.gear ?? 0);
    const run = useProcedureRun(send, why);
    // How the run ended, for the result step: a module's refusal is said as one (IJ06).
    const [outcome, setOutcome] = useState<ProcedureOutcome | null>(null);

    // Every precondition the SGBD lists, plus one acknowledgement of the safety
    // statement. The keys are indices into the procedure's own array rather than
    // invented names, so a procedure with different preconditions gets different
    // boxes without this file knowing anything about them.
    const shape: WizardShape = useMemo(
        () => ({
            prereqChecks: procedure.prereq.map((_, i) => `pre:${i}`),
            safetyChecks: ['safety'],
        }),
        [procedure],
    );
    const [state, dispatch] = useReducer(
        (s: Parameters<typeof wizardReducer>[0], a: Parameters<typeof wizardReducer>[1]) =>
            wizardReducer(s, a, shape),
        undefined,
        initialWizard,
    );

    const plan = useMemo(
        () =>
            planProcedure({
                procedure,
                jobs,
                telegrams,
                mode,
                gate,
                selection: procedure.auswahl ? gear : undefined,
            }),
        [procedure, jobs, telegrams, mode, gate, gear],
    );

    const startRun = useCallback(() => {
        if (!plan.ok) return;
        dispatch({ type: 'started' });
        setOutcome(null);
        void run.start(plan.plan).then((o) => {
            setOutcome(o);
            onEnded?.(o);
            dispatch({ type: 'finished', ok: o.ended === 'ok' });
        });
    }, [plan, run, onEnded]);

    // The assistant's start: once, when the plan allows it (a refusal stays on the dialog, with its reason).
    const assistantStarted = useRef(false);
    useEffect(() => {
        if (!assistant || assistantStarted.current || !plan.ok) return;
        assistantStarted.current = true;
        for (const key of [...shape.prereqChecks, ...shape.safetyChecks]) dispatch({ type: 'toggle', key });
        dispatch({ type: 'next' });
        dispatch({ type: 'next' });
        startRun();
    }, [assistant, plan, shape, startRun]);

    const abort = useCallback(() => {
        void run.abort();
        dispatch({ type: 'abort' });
    }, [run]);

    const leave = useCallback(() => {
        dispatch({ type: 'dismiss' });
        run.reset();
        onClose();
    }, [onClose, run]);

    // What the module-wide safety text and the procedure's note tell the person to do: said on the
    // 何が起きるか step itself, not under 詳細 (docs/UX-DESIGN.md §5). The texts whole stay there.
    const told = [
        ...instructionsIn(workflows.safety ? pick(workflows.safety) : null, lang),
        ...instructionsIn(procedure.note ? pick(procedure.note) : null, lang),
    ];
    const live = isRunning(state) || run.live;
    // The SGBD's longest run, in seconds and minutes rather than its `sek` and `3,0 min` (UX-12).
    const maxSec = procedureMaxSec(procedure);
    const maxText = maxSec === null ? null : formatDuration(maxSec, t);
    // The result step: ended as the module ran it (well or not), as opposed to stopped or refused.
    const ranThrough = !state.result?.aborted && outcome?.ended !== 'refused' && outcome?.ended !== 'failed';
    // The hub's ring is ABORT while the gearbox works (docs/UX-DESIGN.md §1): told on each change, and
    // that it stopped when the dialog goes. Through refs, so a new handler from the page is not a change.
    const onLiveRef = useRef(onLive);
    const abortRef = useRef(abort);
    useEffect(() => {
        onLiveRef.current = onLive;
        abortRef.current = abort;
    });
    useEffect(() => {
        onLiveRef.current?.(live ? () => abortRef.current() : null);
    }, [live]);
    useEffect(() => () => onLiveRef.current?.(null), []);
    const statusText = workflows.testStatus.find(
        (s) => Number.parseInt(s.code, 16) === run.state.statusByte,
    );
    const activityText = procedure.activity.find(
        (a) => Number.parseInt(a.code, 16) === run.state.infoByte,
    );

    return (
        <DialogFrame
            title={t.wiz_title(pick(procedure.name))}
            Icon={procedure.risk === 'high' ? AlertTriangle : PlayCircle}
            tone={procedure.risk === 'high' ? 'danger' : 'neutral'}
            // Handed only when the state says leaving is allowed. That is the
            // one-way-out rule expressed as a missing prop rather than as an
            // early return inside a key handler. On the result step the way out
            // is its CLOSE alone — no X beside it (UX-12) — and Escape is CLOSE.
            onClose={canDismiss(state) && state.step !== 'result' ? leave : undefined}
            onEscape={canDismiss(state) ? leave : undefined}
            footer={
                <Footer
                    step={state.step}
                    live={live}
                    canNext={canAdvance(state, shape)}
                    canBack={canGoBack(state)}
                    blocked={plan.ok ? null : plan.reason}
                    onBack={() => dispatch({ type: 'back' })}
                    onNext={() => dispatch({ type: 'next' })}
                    onStart={startRun}
                    onAbort={abort}
                    onClose={leave}
                />
            }
        >
            <Steps current={state.step} />

            {state.step === 'prereq' && (
                <>
                    {/* Where the list comes from, as a provenance tag; its sentence is the tag's title. */}
                    <Provenance title={t.wiz_prereq_note}>{t.provenance['sgbd-comment']}</Provenance>
                    <ul className="mt-3 space-y-2">
                        {procedure.prereq.map((p, i) => (
                            <Check
                                key={i}
                                checked={state.ticked.has(`pre:${i}`)}
                                onToggle={() => dispatch({ type: 'toggle', key: `pre:${i}` })}
                                label={pick(p)}
                            />
                        ))}
                    </ul>
                    <div className="mt-4 flex flex-wrap items-baseline gap-x-6 gap-y-2">
                        <Field label={t.proc_duration} value={maxText ?? '—'} />
                        <Field
                            label={t.mode}
                            value={procedure.engine === 'run' ? t.proc_engineRun : t.proc_engineOff}
                            tone={procedure.engine === 'run' ? 'text-amber-400' : 'text-slate-300'}
                        />
                    </div>
                </>
            )}

            {state.step === 'safety' && (
                <>
                    {/* What happens → until when → what pressing does (docs/UX-DESIGN.md §5); then what the
                        texts tell the person to do. The module-wide safety text and the procedure's note,
                        whole, are under 詳細. */}
                    <ConfirmSteps what={pick(procedure.desc)} until={t.wiz_until(maxText)} press={t.wiz_press} />
                    {told.length > 0 && (
                        <>
                            <MicroLabel className="mt-4">{t.conf_instructions}</MicroLabel>
                            <div className="mt-1 flex flex-col gap-1.5">
                                <Told lines={told} />
                            </div>
                        </>
                    )}
                    {procedure.auswahl && (
                        <div className="mt-4">
                            <MicroLabel>{t.wiz_gear}</MicroLabel>
                            <div className="mt-1.5 flex flex-wrap gap-1.5">
                                {GEARS.map((g) => (
                                    <button
                                        key={g}
                                        onClick={() => setGear(g)}
                                        className={`rounded px-2 py-1 font-mono text-[11px] ${
                                            gear === g
                                                ? 'bg-blue-500/20 text-blue-300'
                                                : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                                        }`}
                                    >
                                        {g === 0 ? t.wiz_gear_neutral : g === 7 ? t.wiz_gear_reverse : g}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                    <ul className="mt-4">
                        <Check
                            checked={state.ticked.has('safety')}
                            onToggle={() => dispatch({ type: 'toggle', key: 'safety' })}
                            label={t.wiz_safety_ack}
                        />
                    </ul>
                    {!plan.ok && <Blocked reason={plan.reason} detail={plan.detail} />}
                    {(workflows.safety || procedure.note) && (
                        <ConfirmDetails>
                            {workflows.safety && <p>{pick(workflows.safety)}</p>}
                            {procedure.note && <p className="mt-2">{emphasise(pick(procedure.note))}</p>}
                        </ConfirmDetails>
                    )}
                </>
            )}

            {state.step === 'run' && (
                <>
                    {/* What the owner does while it runs, first: keep the preconditions, stay, ABORT if
                        needed. How the app keeps asking the module is the code's business (UX-12). */}
                    <p className="text-xs leading-relaxed text-slate-200">{t.wiz_owner}</p>
                    <div className="mt-4 flex flex-wrap items-baseline gap-x-6 gap-y-2">
                        <Field
                            label={t.wiz_elapsed}
                            value={formatDuration(run.state.elapsedSec, t)}
                            unit={maxText ? t.wiz_of(maxText) : undefined}
                        />
                        <span className="text-[11px] text-slate-500">{t.wiz_asked(run.state.polls)}</span>
                    </div>

                    <div className="mt-4 flex items-baseline gap-2">
                        <MicroLabel>{t.wiz_status}</MicroLabel>
                        {/* The byte positions are read from the SGBD's wording: a decode, marked as one —
                            only once there is a decoded status for the mark to be about. */}
                        {run.state.statusByte !== null && (
                            <Provenance title={t.wiz_offsetsInferred}>{t.provenance.inferred}</Provenance>
                        )}
                    </div>
                    <p className="text-xs text-slate-200">{statusText ? pick(statusText) : '—'}</p>

                    <MicroLabel className="mt-3">{t.wiz_activity}</MicroLabel>
                    <p className="text-xs text-slate-200">{activityText ? pick(activityText) : '—'}</p>

                    <p className="mt-4 text-[11px] leading-relaxed text-amber-400">{t.wiz_abortOnly}</p>
                    {run.state.error && (
                        <p className="mt-2 text-[11px] leading-relaxed text-red-400">{run.state.error}</p>
                    )}

                    <ConfirmDetails>
                        <RawAnswer status={run.state.statusByte} raw={run.state.rawResponse} />
                    </ConfirmDetails>
                </>
            )}

            {state.step === 'result' && (
                <>
                    {/* The state's word in the state's colour (docs/UX-DESIGN.md §4): finished and stopped
                        are grey, a failure or a refusal is red. The answer below is CLOSE whatever it says. */}
                    <p
                        className={`text-xs ${
                            state.result?.aborted ? 'text-slate-300'
                            : ranThrough && run.finishedWell ? 'text-slate-200'
                            : 'text-red-400'
                        }`}
                    >
                        {state.result?.aborted ? t.wiz_result_aborted
                            : outcome?.ended === 'refused' ? t.wiz_result_refused(`0x${(outcome.refusedStatus ?? 0).toString(16).toUpperCase().padStart(2, '0')}`)
                            : outcome?.ended === 'failed' ? t.wiz_result_failed
                            : run.finishedWell ? t.wiz_result_ok
                            : t.wiz_result_bad}
                    </p>
                    {/* Why, and what to do: the car measured before sending (the engine not as the procedure
                        asks, moving, battery) in the owner's words; otherwise the link's sentence. */}
                    {outcome?.ended === 'failed' && outcome.notSent && <p className="mt-1 text-xs text-amber-400">{notSentLine(outcome.notSent, t)}</p>}
                    {outcome?.ended === 'failed' && !outcome.notSent && outcome.error && (
                        <p className="mt-1 break-words font-mono text-[10px] text-slate-500">{outcome.error}</p>
                    )}

                    {/* The module's last word, where it ran through. After a stop or a refusal the last
                        status read is from before the end (IJ06: 「実行中」 under 「止めました」), so it
                        is under 詳細 with the raw answer, not said as the state now. */}
                    {ranThrough && statusText && (
                        <>
                            <MicroLabel className="mt-4">{t.wiz_status}</MicroLabel>
                            <p className="text-xs text-slate-200">{pick(statusText)}</p>
                        </>
                    )}

                    <ConfirmDetails>
                        <p>{t.wiz_stopSent}</p>
                        {!ranThrough && statusText && (
                            <p className="mt-1">
                                {t.wiz_status}: {pick(statusText)}
                            </p>
                        )}
                        <RawAnswer status={run.state.statusByte} raw={run.state.rawResponse} />
                        {procedure.readResultsNote && <p className="mt-2">{emphasise(pick(procedure.readResultsNote))}</p>}
                    </ConfirmDetails>
                </>
            )}
        </DialogFrame>
    );
}

/** The module's answer as it came, with the status byte the decode read: under 詳細. */
function RawAnswer({ status, raw }: { status: number | null; raw: string | null }) {
    const { t } = useLang();
    if (!raw) return null;
    return (
        <>
            <MicroLabel className="mt-2">{t.wiz_raw}</MicroLabel>
            <Well className="mt-1">
                <p className="break-all font-mono text-[11px] text-slate-400">
                    {raw}
                    {status !== null && <span className="ml-2 text-slate-500">(0x{status.toString(16).padStart(2, '0')})</span>}
                </p>
            </Well>
        </>
    );
}

/** 0 = neutral, 1..6 = the gears, 7 = reverse. The SGBD's list, in its order. */
const GEARS = [0, 1, 2, 3, 4, 5, 6, 7] as const;

function Steps({ current }: { current: string }) {
    const { t } = useLang();
    return (
        <div className="mb-4 flex gap-4 border-b border-slate-800 pb-2">
            {WIZARD_STEPS.map((s) => (
                <span
                    key={s}
                    className={`${LABEL} ${s === current ? 'text-blue-400' : 'text-slate-600'}`}
                >
                    {t.wiz_step[s]}
                </span>
            ))}
        </div>
    );
}

function Check({
    checked,
    onToggle,
    label,
}: {
    checked: boolean;
    onToggle: () => void;
    label: string;
}) {
    return (
        <li>
            <label className="flex cursor-pointer gap-2.5 text-[11px] leading-relaxed text-slate-300">
                <input
                    type="checkbox"
                    checked={checked}
                    onChange={onToggle}
                    className="mt-0.5 size-3 shrink-0 accent-blue-500"
                />
                <span>{label}</span>
            </label>
        </li>
    );
}

function Blocked({ reason, detail }: { reason: ProcedureBlockKey; detail?: string }) {
    const { t } = useLang();
    // The gate's own refusals (runGate.mayRunProcedure) are the gate's sentences, the same ones a job's row says.
    const text =
        reason.startsWith('run_block_') ? t.runBlock[reason as keyof typeof t.runBlock]
        : reason === 'proc_block_vehicle' ? t.procBlock.proc_block_vehicle
        : reason === 'proc_block_noJob' ? t.procBlock.proc_block_noJob
        : reason === 'proc_block_selection' ? t.procBlock.proc_block_selection
        : t.procBlock.proc_block_frame;
    return (
        <div className="mt-4">
            <p className="text-[11px] leading-relaxed text-amber-400">{text}</p>
            {detail && <p className="mt-1 font-mono text-[10px] text-slate-500">{detail}</p>}
        </div>
    );
}

/**
 * The buttons, and the one that is never disabled.
 *
 * ABORT is pressable for exactly as long as the gearbox is working, with no
 * confirmation and no busy lock — the same rule the ACTUATOR's STOP follows, for
 * the same reason. A procedure that is running is a physical thing happening,
 * and every route to ending it has to stay open.
 */
function Footer({
    step,
    live,
    canNext,
    canBack,
    blocked,
    onBack,
    onNext,
    onStart,
    onAbort,
    onClose,
}: {
    step: string;
    live: boolean;
    canNext: boolean;
    canBack: boolean;
    blocked: ProcedureBlockKey | null;
    onBack: () => void;
    onNext: () => void;
    onStart: () => void;
    onAbort: () => void;
    onClose: () => void;
}) {
    const { t } = useLang();
    // Keyed, so the result's CLOSE is a new button and not the ABORT repainted: a reused element
    // eased from ABORT's red into CLOSE's colour, and a capture caught a red CLOSE (UX-12).
    if (step === 'run') {
        return (
            <DialogButton key="abort" onClick={onAbort} tone="danger" Icon={Square} disabled={!live}>
                {t.op_abort}
            </DialogButton>
        );
    }
    if (step === 'result') {
        // The way out, plain, whatever the result said (docs/UX-DESIGN.md §5).
        return (
            <DialogButton key="close" onClick={onClose} tone="neutral">
                {t.wiz_close}
            </DialogButton>
        );
    }
    return (
        <>
            {canBack && (
                <DialogButton onClick={onBack} tone="neutral">
                    {t.wiz_back}
                </DialogButton>
            )}
            {step === 'safety' ? (
                <DialogButton onClick={onStart} disabled={!canNext || blocked !== null} tone="danger" Icon={PlayCircle}>
                    {t.op_start}
                </DialogButton>
            ) : (
                <DialogButton onClick={onNext} disabled={!canNext}>
                    {t.wiz_next}
                </DialogButton>
            )}
        </>
    );
}

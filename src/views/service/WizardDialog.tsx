'use client';

import { useCallback, useMemo, useReducer, useState } from 'react';
import { AlertTriangle, PlayCircle, Square } from 'lucide-react';
import { DialogFrame } from '@/components/DialogFrame';
import { Field, LABEL, MicroLabel, Provenance, TextButton, Well, emphasise } from '@/components/ui';
import { useProcedureRun } from '@/hooks/useProcedureRun';
import type { JobRunResult } from '@/hooks/useDs2Link';
import type { CatalogJob } from '@/lib/ecuCatalog';
import { useLang } from '@/lib/i18n';
import { planProcedure, type ProcedureBlockKey } from '@/lib/procedureRun';
import type { Smg2Procedure, Smg2Workflows } from '@/lib/smg2Workflows';
import type { TelegramTable } from '@/lib/telegrams';
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
    send,
    onClose,
}: {
    procedure: Smg2Procedure;
    workflows: Smg2Workflows;
    jobs: ReadonlyMap<string, CatalogJob>;
    telegrams: TelegramTable | null;
    mode: 'vehicle' | 'practice';
    send: (jobId: string, hex: string) => Promise<JobRunResult | null>;
    onClose: () => void;
}) {
    const { lang, t } = useLang();
    const pick = (b: { ja: string; en: string }) => (lang === 'en' ? b.en : b.ja);

    const [gear, setGear] = useState<number>(0);
    const run = useProcedureRun(send);

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
                selection: procedure.auswahl ? gear : undefined,
            }),
        [procedure, jobs, telegrams, mode, gear],
    );

    const startRun = useCallback(() => {
        if (!plan.ok) return;
        dispatch({ type: 'started' });
        void run.start(plan.plan).then(() => dispatch({ type: 'finished', ok: run.finishedWell }));
    }, [plan, run]);

    const abort = useCallback(() => {
        void run.abort();
        dispatch({ type: 'abort' });
    }, [run]);

    const leave = useCallback(() => {
        dispatch({ type: 'dismiss' });
        run.reset();
        onClose();
    }, [onClose, run]);

    const live = isRunning(state) || run.live;
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
            width="max-w-lg"
            // Handed only when the state says leaving is allowed. That is the
            // one-way-out rule expressed as a missing prop rather than as an
            // early return inside a key handler.
            onClose={canDismiss(state) ? leave : undefined}
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
                    <p className="text-[11px] leading-relaxed text-slate-500">{t.wiz_prereq_note}</p>
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
                        <Field label={t.proc_duration} value={procedure.durMax || '—'} />
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
                    {workflows.safety && (
                        <p className="text-xs leading-relaxed text-slate-300">{pick(workflows.safety)}</p>
                    )}
                    {procedure.note && (
                        <p className="mt-3 text-[11px] leading-relaxed text-slate-400">
                            {emphasise(pick(procedure.note))}
                        </p>
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
                </>
            )}

            {state.step === 'run' && (
                <>
                    <p className="text-[11px] leading-relaxed text-slate-500">{emphasise(t.wiz_run_note)}</p>
                    <div className="mt-4 flex flex-wrap items-baseline gap-x-6 gap-y-2">
                        <Field
                            label={t.wiz_elapsed}
                            value={`${run.state.elapsedSec}s`}
                            unit={procedure.durMax ? t.wiz_of(procedure.durMax) : undefined}
                        />
                        <Field label={t.wiz_polls(run.state.polls)} value={run.state.polls} />
                    </div>

                    <MicroLabel className="mt-4">{t.wiz_status}</MicroLabel>
                    <p className="text-xs text-slate-200">
                        {statusText ? pick(statusText) : '—'}
                        {run.state.statusByte !== null && (
                            <span className="ml-2 font-mono text-[10px] text-slate-500">
                                0x{run.state.statusByte.toString(16).padStart(2, '0')}
                            </span>
                        )}
                    </p>

                    <MicroLabel className="mt-3">{t.wiz_activity}</MicroLabel>
                    <p className="text-xs text-slate-200">{activityText ? pick(activityText) : '—'}</p>

                    <MicroLabel className="mt-3">{t.wiz_raw}</MicroLabel>
                    <Well>
                        <p className="break-all font-mono text-[11px] text-slate-400">
                            {run.state.rawResponse ?? '—'}
                        </p>
                    </Well>
                    <div className="mt-2">
                        <Provenance title={t.wiz_offsetsInferred}>{t.provenance.inferred}</Provenance>
                    </div>

                    <p className="mt-4 text-[11px] leading-relaxed text-amber-400">{t.wiz_abortOnly}</p>
                    {run.state.error && (
                        <p className="mt-2 text-[11px] leading-relaxed text-red-400">{run.state.error}</p>
                    )}
                </>
            )}

            {state.step === 'result' && (
                <>
                    <p
                        className={`text-xs ${
                            state.result?.aborted ? 'text-amber-400'
                            : run.finishedWell ? 'text-emerald-400'
                            : 'text-red-400'
                        }`}
                    >
                        {state.result?.aborted ? t.wiz_result_aborted
                            : run.finishedWell ? t.wiz_result_ok
                            : t.wiz_result_bad}
                    </p>
                    <p className="mt-1 text-[11px] text-slate-500">{t.wiz_stopSent}</p>

                    {statusText && (
                        <>
                            <MicroLabel className="mt-4">{t.wiz_status}</MicroLabel>
                            <p className="text-xs text-slate-200">{pick(statusText)}</p>
                        </>
                    )}
                    {run.state.rawResponse && (
                        <>
                            <MicroLabel className="mt-3">{t.wiz_raw}</MicroLabel>
                            <Well>
                                <p className="break-all font-mono text-[11px] text-slate-400">
                                    {run.state.rawResponse}
                                </p>
                            </Well>
                        </>
                    )}
                    {procedure.readResultsNote && (
                        <p className="mt-3 text-[11px] leading-relaxed text-slate-400">
                            {emphasise(pick(procedure.readResultsNote))}
                        </p>
                    )}
                </>
            )}
        </DialogFrame>
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
    const text =
        reason === 'proc_block_vehicle' ? t.procBlock.proc_block_vehicle
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
    if (step === 'run') {
        return (
            <TextButton onClick={onAbort} tone="destructive" Icon={Square} disabled={!live}>
                {t.op_abort}
            </TextButton>
        );
    }
    if (step === 'result') {
        return <TextButton onClick={onClose}>{t.wiz_close}</TextButton>;
    }
    return (
        <>
            {canBack && <TextButton onClick={onBack}>{t.wiz_back}</TextButton>}
            {step === 'safety' ? (
                <TextButton onClick={onStart} disabled={!canNext || blocked !== null} tone="danger" Icon={PlayCircle}>
                    {t.op_start}
                </TextButton>
            ) : (
                <TextButton onClick={onNext} disabled={!canNext} tone="primary">
                    {t.wiz_next}
                </TextButton>
            )}
        </>
    );
}

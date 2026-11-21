'use client';

import { AlertTriangle, Play } from 'lucide-react';
import { useMemo, useState } from 'react';
import { DialogFrame } from '@/components/DialogFrame';
import { DialogButton, LABEL, MicroLabel, Pill, Well, emphasise } from '@/components/ui';
import { ConfirmDetails, ConfirmSteps, Told } from '@/components/gate/ConfirmBody';
import { planLines, type Phase } from '@/lib/actuatorArgs';
import type { CatalogJob } from '@tsunagi/monitoring-engine';
import { execStyleOf } from '@/lib/execStyle';
import { allChecked, requiredChecks } from '@/lib/gateChecks';
import { TEST_ID, tid } from '@/lib/testIds';
import { useLang } from '@/lib/i18n';
import { operationFor } from '@tsunagi/monitoring-engine';
import type { RunVerdict } from '@tsunagi/monitoring-engine';
import type { ActuationMode } from '@tsunagi/monitoring-engine';
import { appNow, type VehicleState } from '@tsunagi/monitoring-engine';
import { instructionsIn } from '@/lib/instructions';

/**
 * The confirmation between pressing RUN and bytes leaving.
 *
 * ## The hard gates are not in here
 *
 * `verdict` is typed `Extract<RunVerdict, { allowed: true }>` — the refused
 * shape cannot be passed. So a caller that has not consulted the gate cannot
 * open this dialog, and one whose verdict is a refusal cannot either: the
 * compiler stops it, and the refusal has to be handled where the press happened
 * (log it, say why, return). The predecessor checked inside the opener and
 * returned early, which works right up until a second opener is added.
 *
 * That is also why the frame is a prop and not something this component derives.
 * It shows the exact bytes the verdict authorised. If it re-derived them there
 * would be two frames — the one disclosed and the one sent — and the disclosure
 * would be describing its own guess.
 *
 * ## RUN is locked until every box is ticked
 *
 * Preconditions, plus an acknowledgement for irreversibility and another for a
 * job with no release. Each is a separate box because they are separate
 * statements; one combined "I understand" is a single click that means nothing.
 * The button's disabled state is derived from the boxes on every render, never
 * stored — there is no way for it to be enabled while a box is clear.
 *
 * ## The shape is the one every confirmation has (docs/UX-DESIGN.md §5, UX-11)
 *
 * The title is the part (油圧ポンプ). The body is three lines — what happens, until when, what
 * pressing does — then the boxes, each with the car's last measured value beside it. The SGBD's
 * quotation, the call lines, the frame and how sure it is are all still here, under 詳細: true,
 * and not what a person needs to read to decide. The one safety fact the quotation carried for a
 * held output (the pump does not stop by itself) is the second line, said as what this app does.
 *
 * What the job's caution tells the person to do or not do (「実行中はブレーキペダルに触れないでください」,
 * 「エンジンを止めてから」) is not a detail: it is a precondition, said in the visible body with the others,
 * in the reader's language (`lib/instructions`). No box of its own — the boxes are the operator's list,
 * and this dialog asks for exactly those. The caution whole stays under 詳細 with the SGBD's words.
 */
export function GateDialog({
    job,
    sgbd,
    address,
    mode,
    verdict,
    phase,
    argValues,
    part,
    caution,
    measured,
    onRun,
    onCancel,
}: {
    job: CatalogJob;
    sgbd: string;
    address: number;
    mode: ActuationMode;
    /** Only the permitted shape exists. A refusal cannot reach this component. */
    verdict: Extract<RunVerdict, { allowed: true }>;
    phase: Phase;
    argValues: Readonly<Record<string, string>>;
    /** The part it drives, in the owner's words (油圧ポンプ), for a job that takes values. */
    part?: string;
    /** The one written sentence this job carries, if it has one. */
    caution?: string;
    /**
     * The car as last measured (lib/vehicleState), shown beside each precondition. Shown, never
     * relied on: the link measures again immediately before the bytes go (`preflightRun`), and a
     * box is still ticked by the person — the operator's rule.
     */
    measured?: VehicleState | null;
    onRun: () => void;
    onCancel: () => void;
}) {
    const { lang, t } = useLang();
    const op = useMemo(() => operationFor(job), [job]);
    const style = execStyleOf(op);
    const irreversible = op.irreversible;
    // When the dialog opened, by the app's clock: how old the last measurement is, once.
    const [openedAt] = useState(() => appNow());

    // One box per statement, from `lib/gateChecks` — the same function the test
    // asserts against, so the boxes rendered and the readiness test cannot be
    // two different ideas of one list.
    const boxes = useMemo(() => requiredChecks(job, op), [job, op]);

    const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
    const ready = allChecked(boxes, ticked);

    const toggle = (key: string) =>
        setTicked((prev) => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });

    const lines = planLines(job, op, argValues, phase, { start: t.op_start, stop: t.op_stop });
    const where = [sgbd, `0x${address.toString(16).toUpperCase().padStart(2, '0')}`]
        .filter(Boolean)
        .join(' · ');

    // The title is the thing that moves (油圧ポンプ), not the kind of job (アクチュエータ駆動).
    const jobName = lang === 'en' ? job.en || job.ja : job.ja;
    const name = part ?? jobName;
    const what = job.class === 'test' ? t.conf_drives(name) : job.class === 'read' ? t.conf_reads(name) : t.conf_runs(name);
    const until =
        job.class === 'read' ? t.conf_readOnce
        : phase === 'start' && style === 'hold' && verdict.actuation ? t.gate_stopsAfter(verdict.actuation.timeoutS)
        : style === 'pulse-unreleasable' ? t.conf_staysOn
        : t.gate_once;
    const verb = phase === 'start' ? t.op_start : t.op_run;
    const told = instructionsIn(caution, lang);

    return (
        <DialogFrame
            title={name}
            tone={job.risk === 'high' ? 'danger' : 'neutral'}
            Icon={job.risk === 'high' ? AlertTriangle : Play}
            // A decision: CANCEL and RUN are its answers, Escape is CANCEL, and there is no X — a
            // third way out of the step before bytes leave (components/ConfirmDialog, the same rule).
            onEscape={onCancel}
            testId={TEST_ID.gateDialog}
            footer={
                <>
                    <DialogButton onClick={onCancel} tone="neutral" {...tid(TEST_ID.gateCancel)}>
                        {t.cancel}
                    </DialogButton>
                    <DialogButton
                        onClick={onRun}
                        disabled={!ready}
                        tone={job.risk === 'high' ? 'danger' : 'primary'}
                        Icon={Play}
                        {...tid(TEST_ID.gateRun)}
                    >
                        {verb}
                    </DialogButton>
                </>
            }
        >
            {/* Which car this goes to: the practice car or the real one. A mode, so it is a tag. */}
            <div className="mb-3">
                <Pill tone={mode === 'practice' ? 'secondary' : 'danger'}>
                    {mode === 'practice' ? t.mode_practice : t.mode_vehicle}
                </Pill>
            </div>

            {/* What happens → until when → what pressing does (docs/UX-DESIGN.md §5). */}
            <ConfirmSteps what={what} until={until} press={t.gate_onPress(phase === 'start')} />

            {/* --- preconditions: the operator's rule, a box each, the measurement beside it; then what
                the caution tells the person to do, in their words, without a box ----------------- */}
            {(job.preconditions.length > 0 || told.length > 0) && (
                <>
                    <MicroLabel className="mt-4">{job.preconditions.length > 0 ? t.gate_needs : t.conf_instructions}</MicroLabel>
                    <div className="mt-1 flex flex-col gap-1.5">
                        {job.preconditions.map((p) => (
                            <Check
                                key={p}
                                label={t[`precond_${p}` as 'precond_voltage_ok']}
                                measure={measureOf(p, measured ?? null, openedAt, t)}
                                checked={ticked.has(`pre:${p}`)}
                                onToggle={() => toggle(`pre:${p}`)}
                            />
                        ))}
                        <Told lines={told} indent={job.preconditions.length > 0} />
                    </div>
                </>
            )}

            {/* --- what cannot be taken back ----------------------------- */}
            {irreversible && (
                <Callout
                    title={t.op_irreversible[irreversible]}
                    ackLabel={t.gate_ack_irreversible}
                    checked={ticked.has('ack:irreversible')}
                    onToggle={() => toggle('ack:irreversible')}
                />
            )}
            {/* Its sentence is the second line above ("it stays on"); here only the box. */}
            {style === 'pulse-unreleasable' && (
                <Callout
                    title={t.gate_unreleasable_title}
                    ackLabel={t.gate_ack_unreleasable}
                    checked={ticked.has('ack:unreleasable')}
                    onToggle={() => toggle('ack:unreleasable')}
                />
            )}

            {/* --- the SGBD's own words, the frames, the names: on request -------------------- */}
            <ConfirmDetails>
                <p className="text-slate-300">
                    {jobName} <span className="font-mono text-slate-500">{job.id}</span>
                </p>
                {job.preconditions.length === 0 && <p className="mt-1">{t.gate_preconditions_none}</p>}
                {caution && (
                    <>
                        <MicroLabel className="mt-3">{t.conf_sgbdNote}</MicroLabel>
                        <p className="mt-1">{emphasise(caution)}</p>
                    </>
                )}
                <MicroLabel className="mt-3">{t.gate_plan}</MicroLabel>
                <Well className="mt-1">
                    {lines.map((l) => (
                        <div key={l} className="font-mono text-[11px] break-words text-blue-400">
                            {l}
                        </div>
                    ))}
                    <div className="mt-1 font-mono text-[11px] text-slate-500">{where}</div>
                    <div className="mt-1 font-mono text-[11px] break-words text-slate-500">
                        {verdict.telegram.hex}
                    </div>
                </Well>
                {/* How much the frame is to be trusted, in words, every time. A grade
                    shown only when it is bad teaches nobody what the good one means. */}
                <p className="mt-1">{emphasise(t.gate_telegram[verdict.telegram.confidence])}</p>
                <p className="mt-2">{t.gate_postNote}</p>
            </ConfirmDetails>
        </DialogFrame>
    );
}

/** How old a measurement may be and still be shown beside a precondition. */
const MEASURE_SHOWN_MS = 60_000;

/**
 * The car's state beside one precondition: the last measured value, in red when it would fail the
 * measurement the link takes on the press; or, with nothing measured lately, that pressing measures.
 * Never "OK" by itself: the value is a reading, and the box beside it is the person's.
 */
function measureOf(
    p: string,
    m: VehicleState | null,
    now: number,
    t: ReturnType<typeof useLang>['t'],
): { text: string; bad: boolean } {
    const fresh = m && now - m.at <= MEASURE_SHOWN_MS ? m : null;
    const value =
        p === 'voltage_ok' && fresh?.voltageV != null ? { v: `${fresh.voltageV.toFixed(1)} V`, bad: fresh.voltageV < 12 }
        : p === 'stationary' && fresh?.speedKmh != null ? { v: `${fresh.speedKmh} km/h`, bad: fresh.speedKmh > 0 }
        : p === 'engine_off' && fresh?.rpm != null ? { v: `${Math.round(fresh.rpm)} rpm`, bad: fresh.rpm > 0 }
        : null;
    return value ? { text: t.conf_measured(value.v), bad: value.bad } : { text: t.conf_measureOnPress, bad: false };
}

function Check({
    label,
    measure,
    checked,
    onToggle,
}: {
    label: string;
    /** The last measured value beside it, where there is one. */
    measure?: { text: string; bad: boolean };
    checked: boolean;
    onToggle: () => void;
}) {
    return (
        <label className="flex cursor-pointer items-baseline gap-2 text-xs text-slate-300">
            <input
                type="checkbox"
                checked={checked}
                onChange={onToggle}
                {...tid(TEST_ID.gateCond)}
                className="size-3.5 shrink-0 self-center accent-blue-500"
            />
            <span>{label}</span>
            {measure && (
                <span className={`font-mono text-[11px] tabular-nums ${measure.bad ? 'text-red-400' : 'text-slate-500'}`}>
                    {measure.text}
                </span>
            )}
        </label>
    );
}

function Callout({
    title,
    ackLabel,
    checked,
    onToggle,
}: {
    title: string;
    ackLabel: string;
    checked: boolean;
    onToggle: () => void;
}) {
    return (
        <div className="mt-4 border-l-2 border-red-500/60 pl-3">
            <div className={`${LABEL} text-red-400`}>{title}</div>
            <div className="mt-2">
                <Check label={ackLabel} checked={checked} onToggle={onToggle} />
            </div>
        </div>
    );
}

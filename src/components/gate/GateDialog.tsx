'use client';

import { AlertTriangle, Play } from 'lucide-react';
import { useMemo, useState } from 'react';
import { DialogFrame } from '@/components/DialogFrame';
import { LABEL, MicroLabel, Pill, TextButton, Well, emphasise } from '@/components/ui';
import { planLines, type Phase } from '@/lib/actuatorArgs';
import type { CatalogJob } from '@/lib/ecuCatalog';
import { execStyleOf } from '@/lib/execStyle';
import { allChecked, requiredChecks } from '@/lib/gateChecks';
import { useLang } from '@/lib/i18n';
import { operationFor } from '@/lib/jobOps';
import type { RunVerdict } from '@/lib/runGate';
import type { ActuationMode } from '@/lib/actuationGate';

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
 */
export function GateDialog({
    job,
    sgbd,
    address,
    mode,
    verdict,
    phase,
    argValues,
    caution,
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
    /** The one written sentence this job carries, if it has one. */
    caution?: string;
    onRun: () => void;
    onCancel: () => void;
}) {
    const { t } = useLang();
    const op = useMemo(() => operationFor(job), [job]);
    const style = execStyleOf(op);
    const irreversible = op.irreversible;

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

    return (
        <DialogFrame
            title={job.ja}
            tone={job.risk === 'high' ? 'danger' : 'neutral'}
            Icon={job.risk === 'high' ? AlertTriangle : Play}
            onClose={onCancel}
            width="max-w-lg"
            testId="gate-dialog"
            footer={
                <>
                    <TextButton onClick={onCancel}>{t.cancel}</TextButton>
                    <TextButton
                        onClick={onRun}
                        disabled={!ready}
                        tone={job.risk === 'high' ? 'danger' : 'primary'}
                        Icon={Play}
                        data-test="gate-run"
                    >
                        {phase === 'start' ? t.op_start : t.op_run}
                    </TextButton>
                </>
            }
        >
            <div className="flex items-center gap-2">
                <Pill tone={mode === 'practice' ? 'secondary' : 'danger'}>
                    {mode === 'practice' ? t.mode_practice : t.mode_vehicle}
                </Pill>
                <span className="font-mono text-[11px] text-slate-500">{job.id}</span>
            </div>

            {/* --- what is about to go out ------------------------------- */}
            <MicroLabel className="mt-4">{t.gate_plan}</MicroLabel>
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
            <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
                {emphasise(t.gate_telegram[verdict.telegram.confidence])}
            </p>

            {/* --- the sentence this job carries ------------------------- */}
            {caution && (
                <>
                    <MicroLabel className="mt-4">{t.gate_caution}</MicroLabel>
                    <p className="mt-1 text-xs leading-relaxed text-slate-300">{emphasise(caution)}</p>
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
            {style === 'pulse-unreleasable' && (
                <Callout
                    title={t.gate_unreleasable_title}
                    body={t.gate_unreleasable_body}
                    ackLabel={t.gate_ack_unreleasable}
                    checked={ticked.has('ack:unreleasable')}
                    onToggle={() => toggle('ack:unreleasable')}
                />
            )}

            {/* --- preconditions ---------------------------------------- */}
            <MicroLabel className="mt-4">{t.gate_preconditions}</MicroLabel>
            {job.preconditions.length === 0 ? (
                <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
                    {t.gate_preconditions_none}
                </p>
            ) : (
                <div className="mt-1 flex flex-col gap-1.5">
                    {job.preconditions.map((p) => (
                        <Check
                            key={p}
                            label={t[`precond_${p}` as 'precond_voltage_ok']}
                            checked={ticked.has(`pre:${p}`)}
                            onToggle={() => toggle(`pre:${p}`)}
                        />
                    ))}
                </div>
            )}

            <p className="mt-4 text-[11px] leading-relaxed text-slate-500">{t.gate_postNote}</p>
        </DialogFrame>
    );
}

function Check({
    label,
    checked,
    onToggle,
}: {
    label: string;
    checked: boolean;
    onToggle: () => void;
}) {
    return (
        <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-300">
            <input
                type="checkbox"
                checked={checked}
                onChange={onToggle}
                data-test="gate-cond"
                className="size-3.5 accent-blue-500"
            />
            {label}
        </label>
    );
}

function Callout({
    title,
    body,
    ackLabel,
    checked,
    onToggle,
}: {
    title: string;
    body?: string;
    ackLabel: string;
    checked: boolean;
    onToggle: () => void;
}) {
    return (
        <div className="mt-4 border-l-2 border-red-500/60 pl-3">
            <div className={`${LABEL} text-red-400`}>{title}</div>
            {body && <p className="mt-1 text-xs leading-relaxed text-slate-300">{body}</p>}
            <div className="mt-2">
                <Check label={ackLabel} checked={checked} onToggle={onToggle} />
            </div>
        </div>
    );
}

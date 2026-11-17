'use client';

import { Play, Square } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { GateDialog } from '@/components/gate/GateDialog';
import { DataList, DataRow, LABEL, ListControls, Pill, Section, TextButton, humanName } from '@/components/ui';
import type { Arming } from '@/hooks/useActuatorArming';
import { agreedCases, mayActuate, telegramOfAgreed, type ActuationMode, type ActuationPermit } from '@tsunagi/monitoring-engine';
import { startActuation } from '@/lib/actuation';
import { agreedChoices, type AgreedChoice } from '@/lib/agreedChoices';
import { operationFor } from '@tsunagi/monitoring-engine';
import type { Phase } from '@/lib/actuatorArgs';
import type { CatalogJob, EcuProfile } from '@tsunagi/monitoring-engine';
import { execStyleOf } from '@/lib/execStyle';
import { useLang } from '@/lib/i18n';
import { cautionFor, type JobTextTable } from '@/lib/jobText';
import { isOn } from '@/lib/jobSurface';
import type { Ledger } from '@tsunagi/monitoring-engine';
import type { RunVerdict, SendRequirement } from '@tsunagi/monitoring-engine';
import { TEST_ID, tid } from '@/lib/testIds';
import { bestTelegram, type TelegramTable } from '@tsunagi/monitoring-engine';
import type { Motion } from '@tsunagi/monitoring-engine';
import { ReasonGlossary, ReasonTag } from '@/views/shared/RunReason';

/**
 * ACTUATOR — the jobs that make the car do something.
 *
 * ## Why the RUN button is absent rather than greyed on most rows
 *
 * On this module most rows cannot fire, and the reasons are structural: the job
 * is not a read and the vehicle gate refuses every non-read, or the extraction
 * never recovered a frame belonging to that job alone. None of those change by
 * pressing anything, so a disabled control is a thing to try. Each row states its
 * reason instead, in a slot that keeps its height so the list does not reflow as
 * the gate's answer changes.
 *
 * ## A job that takes values offers whole sets of them
 *
 * Its frame is built for the chosen values by its own SGBD code, and only the sets
 * where EdiabasLib builds the same frame are offered (lib/agreedChoices) — for a
 * start that leaves something on, only where its stop is agreed too. The row
 * chooses one set; the gate is asked with that set and its frame.
 *
 * ## STOP is not a sub-action
 *
 * It sits in the row, beside START, and it is pressable for exactly as long as
 * the output is energised — never disabled by the busy lock, never behind the
 * gate dialog, no confirmation. An armed actuator is a physical thing that is
 * on, and every route to turning it off has to stay open. `lib/arming` holds
 * that as `stopIsPressable`, whose signature has nothing to condition on.
 */
export function ActuatorView({
    profile,
    telegrams,
    ledger,
    motion,
    jobText,
    mode,
    arming,
    onRun,
}: {
    profile: EcuProfile;
    telegrams: TelegramTable | null;
    ledger: Ledger;
    /** As last measured (lib/vehicleState) — the gate is asked with it. */
    motion: Motion;
    jobText: JobTextTable | null;
    mode: ActuationMode;
    arming: Arming;
    /** Send a job's frame. The caller owns the busy lock and the log. */
    onRun: (jobId: string, hex: string, requires?: SendRequirement, permit?: ActuationPermit) => Promise<unknown>;
}) {
    const { lang, t } = useLang();
    const [query, setQuery] = useState('');
    const [onlyRunnable, setOnlyRunnable] = useState(false);
    const [pending, setPending] = useState<{ job: CatalogJob; phase: Phase; verdict: Extract<RunVerdict, { allowed: true }>; choice?: AgreedChoice } | null>(null);

    // The jobs this tab is about: the ones that can leave an output energised.
    // Same function SERVICE asks, so the two lists partition the catalogue
    // instead of being two filters that happen to agree — `lib/jobSurface`.
    const jobs = useMemo(() => profile.jobs.filter(isOn('actuator')), [profile.jobs]);

    // The sets of values each job that takes them may run with, and the one chosen on its row (by
    // module and job, so another module's choice never stands for this one's).
    const [choices, setChoices] = useState<ReadonlyMap<string, AgreedChoice[]>>(new Map());
    const [chosen, setChosen] = useState<ReadonlyMap<string, number>>(new Map());
    useEffect(() => {
        let live = true;
        const withValues = jobs.filter((j) => j.args.length > 0);
        void Promise.all(
            withValues.map(async (j) => {
                const cases = await agreedCases(profile.id, profile.address, j.id);
                return [j.id, agreedChoices(j, operationFor(j), cases, cases)] as const;
            }),
        ).then((rows) => {
            if (live) setChoices(new Map(rows.filter(([, c]) => c.length > 0)));
        });
        return () => {
            live = false;
        };
    }, [jobs, profile.id, profile.address]);
    const choiceOf = (jobId: string): AgreedChoice | undefined => {
        const i = chosen.get(`${profile.id}:${jobId}`);
        return i === undefined ? undefined : choices.get(jobId)?.[i];
    };

    /**
     * The gate's answer for every row, from the SAME function the press uses.
     *
     * Computed over all actuator jobs rather than the filtered view, so the
     * count in the header is true about the module and not about the search box.
     */
    const verdicts = useMemo(() => {
        const out = new Map<string, RunVerdict>();
        for (const job of jobs) {
            const c = job.args.length > 0 ? choiceOf(job.id) : undefined;
            out.set(
                job.id,
                mayActuate(job, c ? telegramOfAgreed(c.start) : bestTelegram(telegrams, job.id), ledger, {
                    moduleId: profile.id,
                    mode,
                    motion,
                    group: profile.group,
                    ...(c ? { args: c.start.args, agreed: c.start } : {}),
                }),
            );
        }
        return out;
        // eslint-disable-next-line react-hooks/exhaustive-deps -- choiceOf reads `chosen` and `choices`
    }, [jobs, telegrams, ledger, profile.id, profile.group, mode, motion, chosen, choices]);

    const runnableCount = useMemo(
        () => [...verdicts.values()].filter((v) => v.allowed).length,
        [verdicts],
    );

    const shown = useMemo(() => {
        const q = query.trim().toLowerCase();
        return jobs.filter((j) => {
            if (onlyRunnable && !verdicts.get(j.id)?.allowed) return false;
            if (!q) return true;
            return (
                j.id.toLowerCase().includes(q) ||
                j.ja.toLowerCase().includes(q) ||
                j.en.toLowerCase().includes(q)
            );
        });
    }, [jobs, query, onlyRunnable, verdicts]);

    const open = (job: CatalogJob, phase: Phase) => {
        const v = verdicts.get(job.id);
        // The hard gate fires HERE, before the dialog exists — and the dialog's
        // prop type is the allowed shape, so this is not a courtesy check that
        // could be skipped. A refused verdict cannot be handed on.
        if (!v?.allowed) return;
        // One thing driven at a time (the owner's rule, 2026-11-15): stop the one that is on first.
        if (arming.anyArmed && !arming.armed.has(job.id)) return;
        setPending({ job, phase, verdict: v, choice: job.args.length > 0 ? choiceOf(job.id) : undefined });
    };

    const confirm = async () => {
        const p = pending;
        if (!p) return;
        setPending(null);
        if (p.phase === 'stop') return;
        // The same path the assistant's monitoring_actuate takes (lib/actuation): the permit for
        // exactly these bytes, the link's measurement, and the stop resolved before anything is armed.
        await startActuation({
            moduleId: profile.id,
            job: p.job,
            phase: p.phase,
            verdict: p.verdict,
            telegrams,
            args: p.choice?.start.args,
            stop: p.choice?.stop,
            send: onRun,
            arm: arming.arm,
            now: Date.now(),
        });
    };

    return (
        <>
            <Section
                title={t.tab_actuator}
                note={t.actuator_runnable(runnableCount, jobs.length)}
                info={<ReasonGlossary lead={t.actuator_info} reasons={jobs.map((j) => verdicts.get(j.id))} />}
            >
                <ListControls
                    query={query}
                    onQuery={setQuery}
                    placeholder={t.search}
                    shown={shown.length}
                    total={jobs.length}
                >
                    <label className={`flex cursor-pointer items-center gap-1.5 ${LABEL} text-slate-500`}>
                        <input
                            type="checkbox"
                            checked={onlyRunnable}
                            onChange={() => setOnlyRunnable((v) => !v)}
                            className="size-3 accent-blue-500"
                        />
                        {t.actuator_onlyRunnable}
                    </label>
                </ListControls>

                <DataList>
                    {shown.map((job) => (
                        <Row
                            key={job.id}
                            job={job}
                            verdict={verdicts.get(job.id) ?? null}
                            armed={arming.armed.has(job.id)}
                            otherOn={arming.anyArmed && !arming.armed.has(job.id)}
                            choices={choices.get(job.id)}
                            chosen={chosen.get(`${profile.id}:${job.id}`)}
                            onChoose={(i) =>
                                setChosen((m) => {
                                    const n = new Map(m);
                                    if (i === undefined) n.delete(`${profile.id}:${job.id}`);
                                    else n.set(`${profile.id}:${job.id}`, i);
                                    return n;
                                })
                            }
                            lang={lang}
                            onStart={() => open(job, 'start')}
                            onRunOnce={() => open(job, 'pulse')}
                            onStop={() => void arming.stop(job.id)}
                        />
                    ))}
                </DataList>
            </Section>

            {pending && (
                <GateDialog
                    job={pending.job}
                    sgbd={profile.sgbd}
                    address={profile.address}
                    mode={mode}
                    verdict={pending.verdict}
                    phase={pending.phase}
                    argValues={pending.choice?.values ?? {}}
                    caution={cautionFor(jobText, pending.job.id, lang) ?? undefined}
                    onRun={() => void confirm()}
                    onCancel={() => setPending(null)}
                />
            )}
        </>
    );
}

function Row({
    job,
    verdict,
    armed,
    otherOn,
    choices,
    chosen,
    onChoose,
    lang,
    onStart,
    onRunOnce,
    onStop,
}: {
    job: CatalogJob;
    verdict: RunVerdict | null;
    armed: boolean;
    /** Another output is on: one at a time. */
    otherOn: boolean;
    /** For a job that takes values: the agreed sets, and the one chosen. */
    choices?: AgreedChoice[];
    chosen?: number;
    onChoose: (i: number | undefined) => void;
    lang: 'ja' | 'en';
    onStart: () => void;
    onRunOnce: () => void;
    onStop: () => void;
}) {
    const { t } = useLang();
    const style = execStyleOf(operationFor(job));
    const allowed = verdict?.allowed === true && !otherOn;

    return (
        <DataRow
            leading={
                <>
                    <Pill tone={job.risk === 'high' ? 'danger' : job.risk === 'medium' ? 'caution' : 'neutral'}>
                        {job.risk === 'high' ? t.risk_high : job.risk === 'medium' ? t.risk_medium : t.risk_low}
                    </Pill>
                    {/* Reserved, but only on rows that can arm. The badge
                        appears in place rather than pushing the name sideways —
                        and a pulse row, which can never wear it, does not pay
                        for the space. The predecessor put it at the head of the
                        name for the same reason it is here: in the action cell
                        it widened that column for every row and truncated the
                        names to a few characters. */}
                    {style === 'hold' && (
                        <span className={armed ? '' : 'invisible'}>
                            <Pill tone="caution">{t.actuator_armed}</Pill>
                        </span>
                    )}
                </>
            }
            name={humanName(lang === 'ja' ? job.ja : job.en)}
            ident={job.id}
            trailing={
                <span className="flex shrink-0 items-center gap-3">
                    {/* Why it cannot run, in a word, beside the control it disables — the sentence
                        is in the list's ⓘ and in `title` (views/shared/RunReason). It used to be a
                        reserved second line under every row, the same sentence eighty-five times. */}
                    {verdict && !verdict.allowed && <ReasonTag reason={verdict.reason} />}
                    {choices && (
                        <ChoiceSelect choices={choices} chosen={chosen} onChoose={onChoose} disabled={armed} label={t.actuator_values} />
                    )}
                    {style === 'hold' ? (
                        <>
                            <TextButton
                                onClick={onStart}
                                disabled={!allowed || armed}
                                Icon={Play}
                                {...tid(TEST_ID.actuatorStart)}
                            >
                                {t.op_start}
                            </TextButton>
                            {/* Never disabled while armed, and it takes no busy
                                lock — see the note at the top of this file. */}
                            <TextButton
                                onClick={onStop}
                                disabled={!armed}
                                tone="destructive"
                                Icon={Square}
                                {...tid(TEST_ID.actuatorStop)}
                            >
                                {t.op_stop}
                            </TextButton>
                        </>
                    ) : (
                        <TextButton
                            onClick={onRunOnce}
                            disabled={!allowed}
                            Icon={Play}
                            {...tid(TEST_ID.actuatorRun)}
                        >
                            {t.op_run}
                        </TextButton>
                    )}
                </span>
            }
        />
    );
}

/**
 * The agreed sets of values for one job, grouped by the part they drive (the first value). Whole
 * sets only: a set chosen value by value could be one nobody compared. Locked while the part is on,
 * so the stop that is armed is the stop of what is running.
 */
function ChoiceSelect({
    choices,
    chosen,
    onChoose,
    disabled,
    label,
}: {
    choices: AgreedChoice[];
    chosen?: number;
    onChoose: (i: number | undefined) => void;
    disabled: boolean;
    label: string;
}) {
    const groups = new Map<string, { i: number; c: AgreedChoice }[]>();
    choices.forEach((c, i) => {
        const k = c.start.args[0] ?? '';
        groups.set(k, [...(groups.get(k) ?? []), { i, c }]);
    });
    return (
        <span className="max-w-[15rem] rounded bg-slate-800 px-1.5 py-0.5">
            <select
                aria-label={label}
                title={label}
                value={chosen ?? ''}
                disabled={disabled}
                onChange={(e) => onChoose(e.target.value === '' ? undefined : Number(e.target.value))}
                className="w-full cursor-pointer bg-transparent font-mono text-[11px] text-slate-200 outline-none disabled:cursor-not-allowed disabled:opacity-50"
            >
                <option value="" className="bg-slate-900">
                    {label}
                </option>
                {[...groups].map(([part, rows]) => (
                    <optgroup key={part} label={part} className="bg-slate-900">
                        {rows.map(({ i, c }) => (
                            <option key={i} value={i} className="bg-slate-900">
                                {c.label}
                            </option>
                        ))}
                    </optgroup>
                ))}
            </select>
        </span>
    );
}

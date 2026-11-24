'use client';

import { Play, Square } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { GateDialog } from '../../components/gate/GateDialog';
import { DataList, DataRow, LABEL, ListControls, Pill, Section, TextButton, humanName } from '../../components/ui';
import type { Arming } from '../../hooks/useActuatorArming';
import { decisionFor, mayActuate, telegramOfAgreed, type ActuationMode, type ActuationPermit } from '@tsunagi/monitoring-engine';
import { startActuation } from '../../lib/actuation';
import { loadChoices, type AgreedChoice } from '../../lib/agreedChoices';
import { operationFor } from '@tsunagi/monitoring-engine';
import type { Phase } from '../../lib/actuatorArgs';
import type { CatalogJob, EcuProfile } from '@tsunagi/monitoring-engine';
import { execStyleOf } from '../../lib/execStyle';
import { useLang } from '../../lib/i18n';
import { cautionFor, type JobTextTable } from '../../lib/jobText';
import { isOn } from '../../lib/jobSurface';
import type { Ledger } from '@tsunagi/monitoring-engine';
import type { RunVerdict, SendRequirement } from '@tsunagi/monitoring-engine';
import { TEST_ID, tid } from '../../lib/testIds';
import { bestTelegram, type TelegramTable } from '@tsunagi/monitoring-engine';
import type { Motion } from '@tsunagi/monitoring-engine';
import { ReasonGlossary, ReasonTag } from '../shared/RunReason';
import { useNow } from '../../hooks/useNow';
import { decidedByYear, type VariantState } from '../../lib/variantChoice';

/** The parts a module's own data names (lib/partName `partTable`), by the value that selects them. */
type PartTable = ReadonlyMap<string, { ja: string; en: string }>;

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
 * the gate's answer changes. A job the owner keeps off altogether (a safety
 * device's deployment, a write) is not listed at all: a row with a button that
 * can never be pressed is a promise the screen does not keep (MM02 F26).
 *
 * ## A job that takes values offers whole sets of them
 *
 * Its frame is built for the chosen values by its own SGBD code, and only the sets
 * where EdiabasLib builds the same frame are offered (lib/agreedChoices) — for a
 * start that leaves something on, only where its stop is agreed too. The row
 * chooses one set, listed under the part's own name (油圧ポンプ, not HYDROPUMPE
 * alone); the gate is asked with that set and its frame.
 *
 * ## STOP is not a sub-action
 *
 * It sits in the row, beside START, and it is pressable for exactly as long as
 * the output is energised — never disabled by the busy lock, never behind the
 * gate dialog, no confirmation. An armed actuator is a physical thing that is
 * on, and every route to turning it off has to stay open. `lib/arming` holds
 * that as `stopIsPressable`, whose signature has nothing to condition on. While it
 * is on, the row says what it drives and the seconds left until it stops by itself.
 */
export interface ActuatorRequest {
    job: CatalogJob;
    phase: Exclude<Phase, 'stop'>;
    verdict: Extract<RunVerdict, { allowed: true }>;
    choice?: AgreedChoice;
}

export function ActuatorView(props: Omit<ActuatorPanelProps, 'execute' | 'arming'> & {
    arming: Arming;
    onSentOnce(module: string, job: string, args: readonly string[] | null): void;
    onRun(job: string, hex: string, requires?: SendRequirement, permit?: ActuationPermit): Promise<unknown>;
}) {
    return <ActuatorPanel {...props} execute={async p => {
        const r = await startActuation({
            moduleId: props.profile.id, job: p.job, phase: p.phase, verdict: p.verdict,
            telegrams: props.telegrams, args: p.choice?.start.args, stop: p.choice?.stop,
            send: props.onRun, arm: props.arming.arm, now: Date.now(),
        });
        if (r.sent && !r.armed) props.onSentOnce(props.profile.id, p.job.id, p.choice?.start.args ?? null);
    }} />;
}

interface ActuatorPanelProps {
    profile: EcuProfile;
    telegrams: TelegramTable | null;
    ledger: Ledger;
    /** As last measured (lib/vehicleState) — the gate is asked with it. */
    motion: Motion;
    jobText: JobTextTable | null;
    mode: ActuationMode;
    arming: { anyArmed: boolean; armed: ReadonlyMap<string, { at: number; timeoutS?: number; args?: readonly string[] }>; stop(jobId: string): void };
    /** The parts this module's own data names. */
    parts: PartTable;
    /** A set the assistant chose for a row (its monitoring_actuate), shown on that row. */
    pick: { moduleId: string; jobId: string; args: readonly string[] | null; at: number } | null;
    /** Whether the module at this address is known to be this one (lib/variantChoice). */
    variant: VariantState;
    /** The owner says which module answers at this address (once per car). */
    onConfirmVariant: (address: number, moduleId: string) => void;
    execute(request: ActuatorRequest): Promise<void>;
}

export function ActuatorPanel({
    profile, telegrams, ledger, motion, jobText, mode, arming, parts, pick, variant, onConfirmVariant, execute,
}: ActuatorPanelProps) {
    const { lang, t } = useLang();
    const [query, setQuery] = useState('');
    const [onlyRunnable, setOnlyRunnable] = useState(false);
    const [pending, setPending] = useState<{ job: CatalogJob; phase: Phase; verdict: Extract<RunVerdict, { allowed: true }>; choice?: AgreedChoice } | null>(null);
    // The seconds left on what is on, counted down while something is.
    const now = useNow(arming.anyArmed ? 500 : null);

    // The jobs this tab is about: the ones that can leave an output energised.
    // Same function SERVICE asks, so the two lists partition the catalogue
    // instead of being two filters that happen to agree — `lib/jobSurface`.
    // Not those the owner keeps off altogether: they are never offered, so they are not listed.
    const drivers = useMemo(() => profile.jobs.filter(isOn('actuator')), [profile.jobs]);
    const jobs = useMemo(
        () => drivers.filter((j) => decisionFor(profile.id, j, profile.group).how !== 'off'),
        [drivers, profile.id, profile.group],
    );

    // The sets of values each job that takes them may run with, and the one chosen on its row (by
    // module and job, so another module's choice never stands for this one's).
    const [choices, setChoices] = useState<ReadonlyMap<string, AgreedChoice[]>>(new Map());
    const [chosen, setChosen] = useState<ReadonlyMap<string, number>>(new Map());
    useEffect(() => {
        let live = true;
        const withValues = jobs.filter((j) => j.args.length > 0);
        void Promise.all(
            withValues.map(async (j) => {
                return [j.id, await loadChoices(profile.id, profile.address, j, profile.jobs)] as const;
            }),
        ).then((rows) => {
            if (live) setChoices(new Map(rows.filter(([, c]) => c.length > 0)));
        });
        return () => {
            live = false;
        };
    }, [jobs, profile.id, profile.address, profile.jobs]);

    // The assistant's set, shown on its row: the screen says what it was asked to run (and, if the car
    // refused it at the wire, why — on that row). Keyed by when it was asked, so each ask shows once.
    const [pickedAt, setPickedAt] = useState(0);
    if (pick && pick.at !== pickedAt && pick.moduleId === profile.id && choices.size > 0) {
        setPickedAt(pick.at);
        const list = choices.get(pick.jobId);
        const i = pick.args && list ? list.findIndex((c) => c.start.args.length === pick.args!.length && c.start.args.every((x, k) => x === pick.args![k])) : -1;
        if (i >= 0) setChosen((m) => new Map(m).set(`${profile.id}:${pick.jobId}`, i));
    }

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
        // Which module answers at this address is not settled: nothing that drives goes until it is.
        if (variant.state !== 'ok') return;
        // One thing driven at a time (the owner's rule, 2026-11-15): stop the one that is on first.
        if (arming.anyArmed && !arming.armed.has(job.id)) return;
        setPending({ job, phase, verdict: v, choice: job.args.length > 0 ? choiceOf(job.id) : undefined });
    };

    const confirm = async () => {
        const p = pending;
        if (!p) return;
        setPending(null);
        if (p.phase === 'stop') return;
        await execute({ ...p, phase: p.phase });
    };

    const partOf = (args: readonly string[] | undefined) => {
        const part = args?.[0];
        if (!part) return null;
        const n = parts.get(part);
        return n ? (lang === 'ja' ? n.ja : n.en) : part;
    };

    return (
        <>
            <Section
                title={t.tab_actuator}
                note={t.actuator_runnable(runnableCount, jobs.length)}
                info={<ReasonGlossary lead={t.actuator_info} reasons={jobs.map((j) => verdicts.get(j.id))} />}
            >
                {variant.state !== 'ok' && <VariantRow variant={variant} onConfirm={onConfirmVariant} />}
                {/* Nothing to list: why, in a sentence, rather than an empty list (MM01, MM04). */}
                {jobs.length === 0 && (
                    <p className="py-2 text-[11px] leading-relaxed text-slate-400">
                        {drivers.length === 0 ? t.actuator_noneInSgbd : t.actuator_noneOwnerOff(drivers.length)}
                    </p>
                )}
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
                    {shown.map((job) => {
                        const entry = arming.armed.get(job.id);
                        const c = choiceOf(job.id);
                        const left = entry?.timeoutS ? Math.min(entry.timeoutS, Math.max(0, Math.ceil((entry.at + entry.timeoutS * 1000 - now) / 1000))) : null;
                        return (
                            <Row
                                key={job.id}
                                job={job}
                                verdict={verdicts.get(job.id) ?? null}
                                motion={motion}
                                variantOk={variant.state === 'ok'}
                                armed={!!entry}
                                secondsLeft={left}
                                part={partOf(entry?.args ?? c?.start.args)}
                                otherOn={arming.anyArmed && !arming.armed.has(job.id)}
                                choices={choices.get(job.id)}
                                parts={parts}
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
                        );
                    })}
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
                    part={partOf(pending.choice?.start.args) ?? undefined}
                    caution={cautionFor(jobText, pending.job.id, lang) ?? undefined}
                    onRun={() => void confirm()}
                    onCancel={() => setPending(null)}
                />
            )}
        </>
    );
}

/**
 * Which module answers at this address, asked of the owner once per car: an address two of this app's
 * modules share with no group rule to tell them apart (0x56: ASC MK20 on an early car, DSC on a late
 * one) gets nothing that drives until the owner has said (IJ F01). Reads go on as before.
 */
function VariantRow({ variant, onConfirm }: { variant: Exclude<VariantState, { state: 'ok' }>; onConfirm: (address: number, moduleId: string) => void }) {
    const { lang, t } = useLang();
    return (
        <div className="mb-2 border-b border-slate-800 pb-2">
            <p className="text-[11px] leading-relaxed text-amber-400">
                {variant.state === 'ruledOut' ? t.variant_ruledOut(variant.hex, variant.other) : t.variant_ask(variant.hex, decidedByYear(variant.candidates))}
            </p>
            {variant.state === 'ask' && (
                <div className="mt-1.5 flex flex-wrap gap-4">
                    {variant.candidates.map((c) => (
                        <TextButton key={c.id} onClick={() => onConfirm(variant.address, c.id)}>
                            {lang === 'ja' ? (c.nameJa ?? c.name) : c.name}
                        </TextButton>
                    ))}
                </div>
            )}
        </div>
    );
}

function Row({
    job,
    verdict,
    motion,
    variantOk,
    armed,
    secondsLeft,
    part,
    otherOn,
    choices,
    parts,
    chosen,
    onChoose,
    lang,
    onStart,
    onRunOnce,
    onStop,
}: {
    job: CatalogJob;
    verdict: RunVerdict | null;
    motion: Motion;
    variantOk: boolean;
    armed: boolean;
    /** Seconds until it stops by itself, while it is on. */
    secondsLeft: number | null;
    /** The part it drives (the chosen set's, in the owner's words), or null. */
    part: string | null;
    /** Another output is on: one at a time. */
    otherOn: boolean;
    /** For a job that takes values: the agreed sets, and the one chosen. */
    choices?: AgreedChoice[];
    parts: PartTable;
    chosen?: number;
    onChoose: (i: number | undefined) => void;
    lang: 'ja' | 'en';
    onStart: () => void;
    onRunOnce: () => void;
    onStop: () => void;
}) {
    const { t } = useLang();
    const style = execStyleOf(operationFor(job));
    const allowed = verdict?.allowed === true && !otherOn && variantOk;
    // A car measured moving is the row's reason before any other that a choice could clear (IJ F09).
    const drives = job.class !== 'read';
    const reason = verdict && !verdict.allowed ? (motion === 'moving' && drives && verdict.reason === 'run_block_needsArgs' ? 'run_block_moving' : verdict.reason) : null;
    const name = lang === 'ja' ? job.ja : job.en;

    return (
        <DataRow
            leading={
                <>
                    <Pill tone={job.risk === 'high' ? 'danger' : job.risk === 'medium' ? 'caution' : 'neutral'}>
                        {job.risk === 'high' ? t.risk_high : job.risk === 'medium' ? t.risk_medium : t.risk_low}
                    </Pill>
                    {/* Reserved, but only on rows that can arm: the badge and the seconds left
                        appear in place rather than pushing the name sideways — and a pulse row,
                        which can never wear them, does not pay for the space. */}
                    {style === 'hold' && (
                        <span className={`flex shrink-0 items-baseline gap-1.5 ${armed ? '' : 'invisible'}`} aria-hidden={!armed}>
                            <Pill tone="caution">{t.actuator_armed}</Pill>
                            <span className="w-[4.5rem] font-mono text-[11px] tabular-nums text-amber-400">{t.actuator_left(secondsLeft ?? 10)}</span>
                        </span>
                    )}
                </>
            }
            name={humanName(part ? `${name} · ${part}` : name)}
            ident={job.id}
            trailing={
                <span className="flex shrink-0 items-center gap-3">
                    {/* Why it cannot run, in a word, beside the control it disables; touching the word
                        says the sentence (views/shared/RunReason). */}
                    {reason && <ReasonTag reason={reason} />}
                    {choices && (
                        <ChoiceSelect choices={choices} parts={parts} lang={lang} chosen={chosen} onChoose={onChoose} disabled={armed} label={t.actuator_values} />
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
 * The agreed sets of values for one job, under the part they drive (the first value), named in the
 * owner's words where the module's data names it — a heading line per part, not to be chosen. Whole
 * sets only: a set chosen value by value could be one nobody compared. Locked while the part is on,
 * so the stop that is armed is the stop of what is running.
 */
function ChoiceSelect({
    choices,
    parts,
    lang,
    chosen,
    onChoose,
    disabled,
    label,
}: {
    choices: AgreedChoice[];
    parts: PartTable;
    lang: 'ja' | 'en';
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
    const heading = (part: string) => {
        const n = parts.get(part);
        return n ? `— ${lang === 'ja' ? n.ja : n.en}（${part}）` : `— ${part}`;
    };
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
                {[...groups].flatMap(([part, rows]) => [
                    // A heading, in a line of its own: an optgroup's label is not read by every head unit's picker.
                    <option key={`h:${part}`} disabled className="bg-slate-900 text-slate-400">
                        {heading(part)}
                    </option>,
                    ...rows.map(({ i, c }) => (
                        <option key={i} value={i} className="bg-slate-900">
                            {c.label}
                        </option>
                    )),
                ])}
            </select>
        </span>
    );
}

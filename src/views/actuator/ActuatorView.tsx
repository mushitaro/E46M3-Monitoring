'use client';

import { Play, Square } from 'lucide-react';
import { useMemo, useState } from 'react';
import { GateDialog } from '@/components/gate/GateDialog';
import { DataList, DataRow, LABEL, ListControls, Pill, Section, TextButton, humanName } from '@/components/ui';
import type { Arming } from '@/hooks/useActuatorArming';
import { mayActuate, type ActuationMode } from '@/lib/actuationGate';
import type { Phase } from '@/lib/actuatorArgs';
import type { CatalogJob, EcuProfile } from '@/lib/ecuCatalog';
import { execStyleOf } from '@/lib/execStyle';
import { useLang } from '@/lib/i18n';
import { cautionFor, type JobTextTable } from '@/lib/jobText';
import { operationFor } from '@/lib/jobOps';
import { isOn } from '@/lib/jobSurface';
import type { Ledger } from '@/lib/ledger';
import type { RunVerdict } from '@/lib/runGate';
import { TEST_ID, tid } from '@/lib/testIds';
import { bestTelegram, type TelegramTable } from '@/lib/telegrams';

/**
 * ACTUATOR — the jobs that make the car do something.
 *
 * ## Why the RUN button is absent rather than greyed on most rows
 *
 * On this module most rows cannot fire, and the reasons are structural: the job
 * is not a read and the vehicle gate refuses every non-read, or the extraction
 * never recovered a frame belonging to that job alone, or it takes arguments and
 * this app has no encoder from an argument list to a DS2 frame. None of those
 * change by pressing anything, so a disabled control is a thing to try. Each row
 * states its reason instead, in a slot that keeps its height so the list does not
 * reflow as the gate's answer changes.
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
    jobText,
    mode,
    arming,
    onRun,
}: {
    profile: EcuProfile;
    telegrams: TelegramTable | null;
    ledger: Ledger;
    jobText: JobTextTable | null;
    mode: ActuationMode;
    arming: Arming;
    /** Send a job's frame. The caller owns the busy lock and the log. */
    onRun: (jobId: string, hex: string) => Promise<unknown>;
}) {
    const { lang, t } = useLang();
    const [query, setQuery] = useState('');
    const [onlyRunnable, setOnlyRunnable] = useState(false);
    const [pending, setPending] = useState<{ job: CatalogJob; phase: Phase; verdict: Extract<RunVerdict, { allowed: true }> } | null>(null);

    // The jobs this tab is about: the ones that can leave an output energised.
    // Same function SERVICE asks, so the two lists partition the catalogue
    // instead of being two filters that happen to agree — `lib/jobSurface`.
    const jobs = useMemo(() => profile.jobs.filter(isOn('actuator')), [profile.jobs]);

    /**
     * The gate's answer for every row, from the SAME function the press uses.
     *
     * Computed over all actuator jobs rather than the filtered view, so the
     * count in the header is true about the module and not about the search box.
     */
    const verdicts = useMemo(() => {
        const out = new Map<string, RunVerdict>();
        for (const job of jobs) {
            out.set(
                job.id,
                mayActuate(job, bestTelegram(telegrams, job.id), ledger, {
                    moduleId: profile.id,
                    mode,
                }),
            );
        }
        return out;
    }, [jobs, telegrams, ledger, profile.id, mode]);

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
        setPending({ job, phase, verdict: v });
    };

    const confirm = async () => {
        const p = pending;
        if (!p) return;
        setPending(null);
        await onRun(p.job.id, p.verdict.telegram.hex);
        if (p.phase !== 'start') return;
        const op = operationFor(p.job);
        const stopId = op.stopJob;
        const stopHex = stopId ? bestTelegram(telegrams, stopId)?.hex : undefined;
        // Cannot resolve the release? Then it was never armed. `lib/arming` will
        // not hold an entry without one, which is the point: there is no state
        // where an output is on and nothing knows how to end it.
        if (stopId && stopHex) {
            arming.arm({ jobId: p.job.id, stopJobId: stopId, stopHex, at: Date.now() });
        }
    };

    return (
        <>
            <Section
                title={t.tab_actuator}
                note={t.actuator_runnable(runnableCount, jobs.length)}
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
                    argValues={{}}
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
    lang,
    onStart,
    onRunOnce,
    onStop,
}: {
    job: CatalogJob;
    verdict: RunVerdict | null;
    armed: boolean;
    lang: 'ja' | 'en';
    onStart: () => void;
    onRunOnce: () => void;
    onStop: () => void;
}) {
    const { t } = useLang();
    const style = execStyleOf(operationFor(job));
    const allowed = verdict?.allowed === true;

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
            detail={
                // Reserved height: the reason line is always present, so a row
                // does not change size when the gate's answer changes.
                <div className="h-4 truncate text-[11px] text-slate-500">
                    {verdict && !verdict.allowed ? t.runBlock[verdict.reason] : ''}
                </div>
            }
        />
    );
}

'use client';

import { Zap } from 'lucide-react';
import { DataList, DataRow, Field, Section, humanName } from '../../components/ui';
import type { ArmedJob } from '../../lib/arming';
import type { JobRunResult } from '@tsunagi/monitoring-engine';
import { label, type EcuProfile } from '@tsunagi/monitoring-engine';
import { useLang } from '../../lib/i18n';
import { partName } from '../../lib/partName';
import type { Smg2Workflows } from '../../lib/smg2Workflows';
import { useNow } from '../../hooks/useNow';
import { Awaiting } from '../../views/shared/Awaiting';

/**
 * What is energised, right now.
 *
 * The right column used to show this tab a risk-mix bar and a class breakdown —
 * statistics about the module that nobody acts on, in the region whose job is to
 * answer the question the left pane is currently about. On ACTUATOR that
 * question has exactly one answer worth having from across a garage: **is
 * anything still on.** So it says what (the part, in the owner's words), how long
 * until it stops by itself, and what went out and what came back (SC06 F28).
 *
 * Empty is the normal state and it says so plainly. A dashboard that is always
 * full teaches the eye to stop reading it, and this is the one readout that
 * must still be believed at the moment it is not empty.
 */
export function ActuatorViz({
    profile,
    arming,
    workflows,
    lastRun,
}: {
    profile: EcuProfile | null;
    arming: { armed: ReadonlyMap<string, Pick<ArmedJob, 'jobId' | 'at' | 'timeoutS' | 'args' | 'moduleId'>> };
    workflows: Smg2Workflows | null;
    /** The link's last run: the start that went out, and its answer. */
    lastRun: JobRunResult | null;
}) {
    const { lang, t } = useLang();
    const armed = [...arming.armed.values()];
    const now = useNow(armed.length ? 500 : null);

    if (armed.length === 0 || !profile) {
        return <Awaiting icon={Zap} label={t.actuator_none} />;
    }

    const byId = new Map(profile.jobs.map((j) => [j.id, j]));
    return (
        <Section title={t.actuator_armed} count={armed.length}>
            <DataList>
                {armed.map((e) => {
                    const job = byId.get(e.jobId);
                    const part = e.args ? partName(e.moduleId ?? profile.id, job ?? { id: e.jobId }, e.args, workflows) : null;
                    const left = e.timeoutS ? Math.min(e.timeoutS, Math.max(0, Math.ceil((e.at + e.timeoutS * 1000 - now) / 1000))) : null;
                    const run = lastRun && lastRun.jobId.startsWith(e.jobId) ? lastRun : null;
                    return (
                        <DataRow
                            key={e.jobId}
                            name={humanName(`${part ? `${lang === 'ja' ? part.ja : part.en} · ` : ''}${job ? label(job, lang) : e.jobId}`)}
                            ident={e.jobId}
                            leading={<span className="size-1.5 shrink-0 animate-pulse rounded-full bg-amber-400" />}
                            detail={
                                <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
                                    {left !== null && <Field label={t.actuator_left(left)} value={left} unit="s" />}
                                    {run && <Field label={lang === 'ja' ? '送信' : 'Sent'} value={run.request} />}
                                    {run && <Field label={lang === 'ja' ? '応答' : 'Answer'} value={run.error ? run.error : 'OK'} />}
                                </div>
                            }
                        />
                    );
                })}
            </DataList>
        </Section>
    );
}

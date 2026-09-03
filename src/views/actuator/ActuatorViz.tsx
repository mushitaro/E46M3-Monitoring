'use client';

import { Zap } from 'lucide-react';
import { DataList, DataRow, Section, humanName } from '@/components/ui';
import type { Arming } from '@/hooks/useActuatorArming';
import { label, type EcuProfile } from '@/lib/ecuCatalog';
import { useLang } from '@/lib/i18n';
import { Awaiting } from '@/views/shared/Awaiting';

/**
 * What is energised, right now.
 *
 * The right column used to show this tab a risk-mix bar and a class breakdown —
 * statistics about the module that nobody acts on, in the region whose job is to
 * answer the question the left pane is currently about. On ACTUATOR that
 * question has exactly one answer worth having from across a garage: **is
 * anything still on.**
 *
 * Empty is the normal state and it says so plainly. A dashboard that is always
 * full teaches the eye to stop reading it, and this is the one readout that
 * must still be believed at the moment it is not empty.
 */
export function ActuatorViz({ profile, arming }: { profile: EcuProfile | null; arming: Arming }) {
    const { lang, t } = useLang();
    const armed = [...arming.armed.keys()];

    if (armed.length === 0 || !profile) {
        return <Awaiting icon={Zap} label={t.actuator_none} />;
    }

    const byId = new Map(profile.jobs.map((j) => [j.id, j]));
    return (
        <Section title={t.actuator_armed} count={armed.length}>
            <DataList>
                {armed.map((id) => {
                    const job = byId.get(id);
                    return (
                        <DataRow
                            key={id}
                            name={job ? label(job, lang) : humanName(id)}
                            ident={id}
                            leading={<span className="size-1.5 shrink-0 animate-pulse rounded-full bg-amber-400" />}
                        />
                    );
                })}
            </DataList>
        </Section>
    );
}

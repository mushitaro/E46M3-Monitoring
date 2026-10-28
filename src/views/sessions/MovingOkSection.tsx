'use client';

import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { DataList, DataRow, Section, TextButton, humanName, type HumanName } from '@/components/ui';
import { label, type EcuProfile } from '@/lib/ecuCatalog';
import { movingOkChoices, type Ledger, type VerificationRecord } from '@/lib/ledger';
import { useLang } from '@/lib/i18n';
import type { Motion } from '@/lib/vehicleState';

/**
 * WHILE MOVING — where the owner clears a read for a moving car (lib/ledger `grantMovingOk`).
 *
 * Offers only what `movingOkChoices` proposes: reads that answered on this car while it was
 * measured stationary, enough times, with nothing standing against them. Nothing here clears a
 * read by itself; the owner presses, reads the consequence, and confirms. Not while the car is
 * measured moving: the screen is not operated on the road.
 *
 * The line under the note is reserved, so the list does not move when the car starts or stops.
 */
export function MovingOkSection({
    ledger,
    motion,
    catalog,
    ecuId,
    onGrant,
}: {
    ledger: Ledger;
    motion: Motion;
    /** The loaded module's catalogue, used to name a read of the same module. */
    catalog: EcuProfile | null;
    ecuId: string;
    onGrant: (id: string) => void;
}) {
    const { lang, t } = useLang();
    const [asking, setAsking] = useState<VerificationRecord | null>(null);
    const { proposals, cleared } = movingOkChoices(ledger);
    const moving = motion === 'moving';

    // A read of the module in session is named from its catalogue; another module's shows its id,
    // which DataRow promotes in the identifier's own style rather than as a name.
    const nameOf = (id: string): HumanName => {
        const [module, job] = id.split(':');
        const known = module === ecuId ? catalog?.jobs.find((j) => j.id === job) : undefined;
        return known ? label(known, lang) : humanName('');
    };

    return (
        <Section title={t.movingOk} note={t.movingOk_note} count={proposals.length + cleared.length}>
            <p className={`min-h-[18px] text-[11px] ${moving ? 'text-amber-400' : 'text-slate-500'}`}>
                {moving ? t.movingOk_blocked : proposals.length + cleared.length === 0 ? t.movingOk_none : null}
            </p>
            {proposals.length + cleared.length > 0 && (
                <DataList>
                    {proposals.map((r) => (
                        <DataRow
                            key={r.id}
                            name={nameOf(r.id)}
                            ident={r.id}
                            trailing={
                                <TextButton onClick={() => setAsking(r)} tone="caution" Icon={ShieldCheck} disabled={moving}>
                                    {t.movingOk_grant}
                                </TextButton>
                            }
                            detail={<p className="text-[11px] text-slate-500">{t.movingOk_answered(r.observations ?? 0)}</p>}
                        />
                    ))}
                    {cleared.map((r) => (
                        <DataRow
                            key={r.id}
                            name={nameOf(r.id)}
                            ident={r.id}
                            detail={
                                <p className="text-[11px] text-emerald-400">
                                    {t.movingOk_cleared(r.movingOkAt ? new Date(r.movingOkAt).toLocaleString() : '—')}
                                </p>
                            }
                        />
                    ))}
                </DataList>
            )}
            {asking && (
                <ConfirmDialog
                    title={t.movingOk_confirmTitle}
                    consequence={t.movingOk_consequence(nameOf(asking.id) || asking.id, asking.observations ?? 0)}
                    confirmLabel={t.movingOk_grant}
                    onConfirm={() => {
                        if (!moving) onGrant(asking.id);
                        setAsking(null);
                    }}
                    onCancel={() => setAsking(null)}
                />
            )}
        </Section>
    );
}

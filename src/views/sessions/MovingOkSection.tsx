'use client';

import { useState, type ReactNode } from 'react';
import { ShieldCheck } from 'lucide-react';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { DataList, DataRow, Section, TextButton, humanName, type HumanName } from '@/components/ui';
import { description, label, text, type EcuProfile } from '@/lib/ecuCatalog';
import { movingOkChoices, type Ledger, type VerificationRecord } from '@/lib/ledger';
import { useLang } from '@/lib/i18n';
import type { Motion } from '@/lib/vehicleState';

/**
 * WHILE MOVING — where the owner allows a read while the car moves (lib/ledger `grantMovingOk`).
 *
 * Offers only what `movingOkChoices` proposes: reads that answered on this car while it was
 * measured stationary, enough times, with nothing standing against them. Nothing here allows a
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
    const jobOf = (id: string) => {
        const [module, job] = id.split(':');
        return module === ecuId ? catalog?.jobs.find((j) => j.id === job) : undefined;
    };
    const nameOf = (id: string): HumanName => {
        const known = jobOf(id);
        return known ? label(known, lang) : humanName('');
    };
    // What the read brings back, because a job's name alone ("Digital") does not say what the owner
    // is allowing: how many values it returns and the first of them, or else its own description.
    // A single value is no help ("Result"), and nothing is said when the description repeats the name.
    const whatOf = (id: string): string => {
        const known = jobOf(id);
        if (!known || !catalog) return '';
        const name = label(known, lang);
        const values = known.results
            .filter((r) => r.role === 'value')
            .map((r) => text(catalog, r.comment, lang).text)
            .filter((v) => v !== '' && v !== name);
        if (values.length > 1) return t.movingOk_reads(values.slice(0, 3), values.length);
        const own = description(catalog, known, lang).text;
        return own && !own.startsWith(name) ? own : '';
    };
    const detailOf = (r: VerificationRecord, state: ReactNode) => (
        <>
            {whatOf(r.id) && <p className="text-[11px] text-slate-400">{whatOf(r.id)}</p>}
            {state}
        </>
    );

    return (
        <Section title={t.movingOk} info={t.movingOk_info} count={proposals.length + cleared.length}>
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
                            detail={detailOf(r, <p className="text-[11px] text-slate-500">{t.movingOk_answered(r.observations ?? 0)}</p>)}
                        />
                    ))}
                    {cleared.map((r) => (
                        <DataRow
                            key={r.id}
                            name={nameOf(r.id)}
                            ident={r.id}
                            detail={detailOf(
                                r,
                                <p className="text-[11px] text-emerald-400">
                                    {t.movingOk_cleared(r.movingOkAt ? new Date(r.movingOkAt).toLocaleString() : '—')}
                                </p>,
                            )}
                        />
                    ))}
                </DataList>
            )}
            {asking && (
                <ConfirmDialog
                    title={t.movingOk_confirmTitle}
                    consequence={t.movingOk_consequence(nameOf(asking.id) || asking.id, whatOf(asking.id), asking.observations ?? 0)}
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

'use client';

import { memo, useMemo } from 'react';
import { ListChecks } from 'lucide-react';
import {
    DataList,
    DataRow,
    LABEL,
    MicroLabel,
    Pane,
    Section,
    humanName,
} from '@/components/ui';
import type { AdaptationRead } from '@/hooks/useDs2Link';
import { resetJobsFor } from '@/lib/adaptationReset';
import { jobIndex, label, type EcuProfile } from '@/lib/ecuCatalog';
import { useLang } from '@/lib/i18n';
import type { Ledger } from '@/lib/ledger';
import { mayRun } from '@/lib/runGate';
import { bestTelegram, type TelegramTable } from '@/lib/telegrams';
import { Awaiting } from '@/views/shared/Awaiting';
import { CountReadout } from '@/views/shared/CatalogSummary';

/**
 * The ECU's learned values, and the ECU's own way of throwing them away.
 *
 * Two halves that have to be on one screen. The read is what an owner wants
 * after a repair — lambda adaptation, knock adaptation, throttle adaptation,
 * lifetime misfire counters. The reset is the thing they will reach for next,
 * and it is a WRITE this app does not send. Putting the read behind a
 * sub-action button and leaving the reset to be found among 223 rows in SERVICE
 * meant the refusal was never stated where the question gets asked.
 *
 * Both reset jobs go through `mayRun` — the same gate the SERVICE tab uses, with
 * the same telegram table and the same ledger. Not a second opinion rendered
 * next to the first: a second derivation is a second chance to disagree, and
 * this one would be disagreeing about whether to write to an engine controller.
 */
export const AdaptationView = memo(function AdaptationView({
    blocks,
    catalog,
    ecuId,
    telegrams,
    ledger,
}: {
    /** What the ECU answered, or null before anyone asked. */
    blocks: AdaptationRead[] | null;
    catalog: EcuProfile | null;
    ecuId: string;
    telegrams: TelegramTable | null;
    ledger: Ledger;
}) {
    const { t, lang } = useLang();

    const known = resetJobsFor(ecuId);
    const resets = useMemo(() => {
        if (!catalog) return [];
        const index = jobIndex(catalog);
        return resetJobsFor(ecuId).ids.flatMap((id) => {
            const job = index.get(id);
            if (!job) return [];
            return [{ job, verdict: mayRun(job, bestTelegram(telegrams, id), ledger, { moduleId: ecuId }) }];
        });
    }, [catalog, telegrams, ledger, ecuId]);

    return (
        <Pane>
            <Section title={t.adaptations} note={t.adaptations_note}>
                {!hasDecoder(ecuId) ? (
                    <p className="py-2 text-[11px] leading-relaxed text-slate-500">{t.adaptations_noDecoder}</p>
                ) : blocks === null ? (
                    <p className="py-2 font-mono text-xs uppercase text-slate-600">{t.awaiting_read}</p>
                ) : (
                    blocks.map((b) => (
                        <div key={b.selection} className="mb-4 last:mb-0">
                            <MicroLabel>{b.name}</MicroLabel>
                            {b.error ? (
                                <p className="mt-1 text-[11px] text-red-400">{b.error}</p>
                            ) : (
                                <>
                                    {b.short && (
                                        <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
                                            {t.adaptations_short(b.payloadLength, b.requiredLength)}
                                        </p>
                                    )}
                                    <DataList className="mt-1.5">
                                        {b.values.map((v) => (
                                            <DataRow
                                                key={v.symbol}
                                                name={humanName(v.de || v.name)}
                                                ident={v.symbol}
                                                trailing={
                                                    <span className="shrink-0 font-mono text-xs tabular-nums text-slate-200">
                                                        {v.value === null ? '—' : v.value.toFixed(3)}
                                                        {v.unit && (
                                                            <span className="ml-1 text-slate-500">{v.unit}</span>
                                                        )}
                                                    </span>
                                                }
                                            />
                                        ))}
                                    </DataList>
                                </>
                            )}
                        </div>
                    ))
                )}
            </Section>

            {/* The reset section renders whether or not there are jobs to show:
                on SMG II and DSC its absence would otherwise read as "reset is
                available here", which is the one misreading that costs someone
                an engine's worth of learned values. */}
            <Section title={t.adaptationsReset} note={t.adaptationsReset_note}>
                {resets.length === 0 ? (
                    // "None" and "not checked" are different sentences. An empty
                    // list under the wrong one is the app asserting a module has
                    // no erase job when nobody has looked — which is precisely
                    // how the first draft of this pane lied about SMG II.
                    <p className="py-2 text-[11px] leading-relaxed text-slate-500">
                        {known.known ? t.adaptationsReset_none : t.adaptationsReset_unknown}
                    </p>
                ) : (
                    <DataList>
                        {resets.map(({ job, verdict }) => (
                            <DataRow
                                key={job.id}
                                name={label(job, lang)}
                                ident={job.id}
                                trailing={
                                    <span className={`shrink-0 ${LABEL} text-slate-600`}>
                                        {verdict.allowed ? t.gate_verified : t.op_blocked}
                                    </span>
                                }
                                detail={
                                    verdict.allowed ? undefined : (
                                        <p className="text-[11px] leading-relaxed text-slate-500">
                                            {t.runBlock[verdict.reason]}
                                        </p>
                                    )
                                }
                            />
                        ))}
                    </DataList>
                )}
            </Section>
        </Pane>
    );
});

/**
 * How many of the ECU's answers actually decoded.
 *
 * A block that came back SHORT counts as read and NOT as a value. The pane says
 * which block and by how many bytes; this number must not quietly round that up
 * into "everything is fine", so the denominator stays visible and the colour
 * changes the moment the two disagree.
 */
export function AdaptationViz({ blocks }: { blocks: AdaptationRead[] | null }) {
    const { t } = useLang();
    if (blocks === null) return <Awaiting icon={ListChecks} label={t.awaiting_read} />;
    const ok = blocks.filter((b) => !b.error && !b.short).length;
    return (
        <CountReadout
            value={ok}
            suffix={`/${blocks.length}`}
            tone={ok === blocks.length ? 'text-emerald-400' : 'text-amber-400'}
            caption={t.viz_adaptationBlocks}
        />
    );
}

/**
 * Whether a ported decoder exists for this module's adaptation blocks.
 *
 * The block table is MSS54's. The other 50 modules have adaptation data in the
 * ECU and no ported decoder for it here, which is a DIFFERENT statement from
 * "this module has none" — so the app says that, rather than showing an empty
 * list that reads as a car with nothing learned.
 *
 * Exported because the hub asks the same question (`lib/viewHub`) and two copies
 * of it would be two answers.
 */
export function hasDecoder(ecuId: string): boolean {
    return ecuId === 'mss54';
}

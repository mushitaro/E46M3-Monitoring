'use client';

import { memo, useMemo, useState } from 'react';
import { ScanLine } from 'lucide-react';
import { formatErrorCode } from '@tsunagi/ds2-mss54';
import {
    DataList,
    DataRow,
    Field,
    Fold,
    ListControls,
    MicroLabel,
    Pane,
    Provenance,
    Section,
    Well,
    humanName,
} from '@/components/ui';
import type { ErrorMemoryEntry } from '@tsunagi/ds2-mss54';
import type { RawFaultRead } from '@/hooks/useDs2Link';
import { useLang } from '@/lib/i18n';
import type { EcuProfile, HumanName } from '@tsunagi/monitoring-engine';
import { Awaiting } from '@/views/shared/Awaiting';
import { CountReadout } from '@/views/shared/CountReadout';
import { FreezeFrame } from '@/views/shared/FreezeFrame';
import { codeText, faultLabel, textLabel, type FaultLabel } from '@/lib/faultText';
import { isUnnamedLocation, kindsBesideState } from '@/lib/faultKinds';
import { mss54Present, presentFromKinds } from '@tsunagi/monitoring-engine';

/**
 * What the link read, and nothing else about the link.
 *
 * The views take the DATA they render rather than the whole `useDs2Link` object.
 * That is not tidiness: the shell keeps every pane mounted and overlaid, so a
 * pane handed the link re-renders on every datalog sample flush — 226 rows of
 * fault table, twice a second, in the view that is not even up. Narrow props
 * make `memo` able to say no.
 */
export interface FaultRead {
    ident: { hex: string; length: number } | null;
    faults: ErrorMemoryEntry[] | null;
    /** A module with no decoder: the frames its own FS_LESEN sends, and the bytes that came back. */
    rawFaults: RawFaultRead[] | null;
}

/**
 * How many faults the last read found, whichever way it was read. Null: nothing read yet. `bytes`: the
 * module answered and nothing here reads its answer — the bytes are the answer, and there is no count.
 * One answer for MAIN and VISU, so the two cannot say different things (UX-17).
 */
export function faultCount({ faults, rawFaults }: Pick<FaultRead, 'faults' | 'rawFaults'>): number | 'bytes' | null {
    if (faults !== null) return faults.length;
    if (rawFaults === null) return null;
    const read = rawFaults.filter((r) => r.jobFaults || r.decoded || r.kwpDtcs);
    if (read.length === 0) return 'bytes';
    return read.reduce((n, r) => n + (r.jobFaults?.faults.length ?? 0) + (r.decoded?.length ?? 0) + (r.kwpDtcs?.length ?? 0), 0);
}

/** The name slot and the identifier slot for a fault (UX-22): a readable name, or what it is with the German beside it. */
function nameSlots(label: FaultLabel | null, fallback: HumanName, untranslated: HumanName): { name: HumanName; ident?: string } {
    if (label?.text) return { name: label.text };
    if (label?.original) return { name: untranslated, ident: label.original };
    return { name: fallback };
}

/**
 * DIAGNOSIS — what this module said when it was read, first (UX-16).
 *
 * The faults read are the screen. What is one press away and read only sometimes is folded under
 * them: the frames the read sent (where something read their answer), the module's whole fault
 * dictionary, and what IDENT answered. Where the faults came from is a word under the heading (SGBD
 * の文, 実車未確認, 推定, バイトのまま) and the sentences behind those words are the heading's ⓘ.
 *
 * Nothing read yet is the empty state in VISU, and here only the heading (one empty state a screen,
 * UX-17). The dictionary is not offered for a module the car's IDENT has not confirmed is the one at
 * its address (`known`): it would be another module's table (SC10).
 */
export const DiagnosisView = memo(function DiagnosisView({
    ident,
    faults,
    rawFaults,
    catalog,
    known = true,
}: FaultRead & {
    catalog: EcuProfile | null;
    /** The module on the screen is the one at its address (variantChoice `ok`). False: its dictionary is not this car's. */
    known?: boolean;
}) {
    const { lang, t } = useLang();
    const untranslated = humanName(t.fault_untranslated);
    const none = <p className="py-2 text-xs text-slate-400">{t.faults_none}</p>;

    const jobRead = rawFaults?.some((r) => r.jobFaults) ?? false;
    const layoutRead = rawFaults?.some((r) => r.decoded) ?? false;
    const kwpRead = rawFaults?.some((r) => r.kwpDtcs) ?? false;
    const bytesOnly = rawFaults !== null && !jobRead && !layoutRead && !kwpRead;
    // The bytes stay in the open where they are the answer (CLAUDE.md): nothing read them, or a reading
    // not yet confirmed on a car did. Read to its end by the module's own SGBD job, they fold (UX-16).
    const bytesAreAnswer = bytesOnly || layoutRead || kwpRead;
    const count = faultCount({ faults, rawFaults });

    // One word each for where the faults came from; the sentences are the ⓘ's.
    const tags = [
        jobRead && t.faults_tag.sgbd,
        layoutRead && t.faults_tag.unverified,
        kwpRead && t.faults_tag.estimated,
        kwpRead && !layoutRead && t.faults_tag.unverified,
        bytesOnly && t.faults_tag.bytes,
    ].filter((x): x is string => !!x);
    const info = rawFaults ? (
        <>
            <p>{t.faults_raw_note(rawFaults.length)}</p>
            {jobRead && <p className="mt-1">{t.faults_jobRead}</p>}
            {layoutRead && <p className="mt-1">{t.faults_layout_unverified}</p>}
            {kwpRead && <p className="mt-1">{t.faults_kwp_estimated}</p>}
        </>
    ) : undefined;

    const frames = (rawFaults ?? []).map((r) => (
        <Well key={r.request} className="max-w-[60ch]">
            <p className="break-all font-mono text-xs text-slate-300">
                {r.request} → {r.response || '—'}
            </p>
        </Well>
    ));

    return (
        <Pane>
            <Section
                title={t.faults_read}
                count={typeof count === 'number' ? count : undefined}
                note={
                    tags.length > 0 ? (
                        <span className="flex gap-3">
                            {tags.map((x) => (
                                <Provenance key={x}>{x}</Provenance>
                            ))}
                        </span>
                    ) : undefined
                }
                info={info}
            >
                {rawFaults ? (
                    <div className="flex flex-col gap-2">
                        {/* The module's own FS_LESEN, run here (lib/sgbd/faultRead): its entries with its own text,
                            or the catalogue's name for the same code where there is one. */}
                        {jobRead && (
                            <>
                                <DataList>
                                    {rawFaults.flatMap((r) =>
                                        (r.jobFaults?.faults ?? []).map((d, i) => {
                                            const label = faultLabel(catalog, d.code, lang);
                                            const own: FaultLabel | null = label ?? (isUnnamedLocation(d.text) ? null : { text: null, original: d.text ?? '' });
                                            const present = presentFromKinds(d.kinds);
                                            const facts = lang === 'ja' ? kindsBesideState(d.kinds) : [];
                                            const slots = nameSlots(own, humanName(t.fault_unnamed), untranslated);
                                            return (
                                                <DataRow
                                                    key={`${r.request}-${d.code ?? i}`}
                                                    code={codeText(catalog, d.code)}
                                                    codeTone="danger"
                                                    name={slots.name}
                                                    ident={slots.ident}
                                                    trailing={
                                                        present === null ? undefined : (
                                                            <span className="shrink-0 font-mono text-[10px] text-slate-500">{present ? t.fault_present_now : t.fault_stored}</span>
                                                        )
                                                    }
                                                    detail={
                                                        <>
                                                            {facts.length > 0 && <p className="text-[10px] text-slate-400">{facts.join(' · ')}</p>}
                                                            <p className="font-mono text-[10px] text-slate-500">{[slots.ident ? null : d.text, ...d.kinds].filter(Boolean).join(' · ')}</p>
                                                        </>
                                                    }
                                                />
                                            );
                                        }),
                                    )}
                                </DataList>
                                {rawFaults.every((r) => !r.jobFaults || r.jobFaults.faults.length === 0) ? none : null}
                            </>
                        )}
                        {/* Another module's codes, read where its own SGBD reads them (engine faultLayouts) —
                            checked against EDIABAS in simulation, not yet on a car, and said so. */}
                        {layoutRead && (
                            <>
                                <DataList>
                                    {rawFaults.flatMap((r) =>
                                        (r.decoded ?? []).map((d, i) => {
                                            const slots = nameSlots(faultLabel(catalog, d.code, lang), humanName(''), untranslated);
                                            const state = d.present === true ? t.fault_present_now : d.present === false ? t.fault_stored : null;
                                            return (
                                                <DataRow
                                                    key={`${r.request}-${d.code}-${i}`}
                                                    code={d.code}
                                                    codeTone="danger"
                                                    name={slots.name}
                                                    ident={slots.ident}
                                                    trailing={
                                                        <span className="shrink-0 font-mono text-[10px] text-slate-500">
                                                            {[state, d.count === null ? null : `×${d.count}`].filter(Boolean).join(' ')}
                                                        </span>
                                                    }
                                                />
                                            );
                                        }),
                                    )}
                                </DataList>
                                {rawFaults.every((r) => !r.decoded || r.decoded.length === 0) ? none : null}
                            </>
                        )}
                        {/* DSC MK60 (lib/kwpOnDs2): the codes, read as ISO 14230 lays a $58 answer out —
                            not yet confirmed on a MK60, and said so. */}
                        {kwpRead && (
                            <>
                                <DataList>
                                    {rawFaults.flatMap((r) =>
                                        (r.kwpDtcs ?? []).map((d) => {
                                            const slots = nameSlots(faultLabel(catalog, d.code, lang), humanName(''), untranslated);
                                            return (
                                                <DataRow
                                                    key={`${r.request}-${d.code}`}
                                                    code={d.code.toUpperCase().replace('0X', '0x')}
                                                    codeTone="danger"
                                                    name={slots.name}
                                                    ident={slots.ident}
                                                    trailing={<span className="shrink-0 font-mono text-[10px] text-slate-500">{`0x${d.status.toString(16).padStart(2, '0')}`}</span>}
                                                />
                                            );
                                        }),
                                    )}
                                </DataList>
                                {rawFaults.every((r) => r.kwpDtcs?.length === 0) ? none : null}
                            </>
                        )}
                        {/* The bytes are the answer: here, under what was read from them, not folded away. */}
                        {bytesAreAnswer && frames}
                    </div>
                ) : faults === null ? null : faults.length === 0 ? (
                    none
                ) : (
                    <DataList>
                        {faults.map((f) => {
                            const code = formatErrorCode(f.errorCode);
                            const label = faultLabel(catalog, code, lang);
                            const slots = nameSlots(label, humanName(''), untranslated);
                            return (
                                <DataRow
                                    key={`${f.number}-${f.errorCode}`}
                                    code={code}
                                    codeTone="danger"
                                    name={slots.name}
                                    ident={slots.ident}
                                    trailing={
                                        <span className="shrink-0 font-mono text-[10px] text-slate-500">
                                            {mss54Present(f.errorType) ? t.fault_present_now : t.fault_stored} {formatErrorCode(f.errorType)}
                                        </span>
                                    }
                                    detail={
                                        <>
                                            {label?.text && label.original && label.original !== label.text && (
                                                <p className="font-mono text-[10px] text-slate-500">{label.original}</p>
                                            )}
                                            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                                                <Field label={t.faults_frequency} value={f.frequencyCounter} />
                                                <Field label={t.faults_logistics} value={f.logisticsCounter} />
                                            </div>
                                            <MicroLabel>{t.faults_freezeFrames}</MicroLabel>
                                            {f.environmentSets.map((s, i) => (
                                                <FreezeFrame
                                                    key={i}
                                                    index={i}
                                                    code={code}
                                                    bytes={[s.condition1, s.condition2, s.condition3, s.condition4]}
                                                    counter={s.counter}
                                                    profile={catalog}
                                                    lang={lang}
                                                />
                                            ))}
                                        </>
                                    }
                                />
                            );
                        })}
                    </DataList>
                )}
            </Section>

            {/* The frames, where the module's own SGBD job read their answer: one press away (and in the COMMS LOG). */}
            {rawFaults && !bytesAreAnswer && (
                <Fold title={t.faults_sentFrames} count={rawFaults.length}>
                    <div className="flex flex-col gap-2">{frames}</div>
                </Fold>
            )}

            {catalog && known && <FaultDictionary catalog={catalog} />}

            {/* What IDENT answered: the bytes, as they came back. The COMMS LOG has them too. */}
            {ident && (
                <Fold title="IDENT" count={ident.length} note={t.ident_note(ident.length)}>
                    <Well className="max-w-[60ch]">
                        <p className="break-all font-mono text-xs text-slate-300">{ident.hex}</p>
                    </Well>
                </Fold>
            )}
        </Pane>
    );
});

/**
 * The module's whole fault table (FORTTEXTE), closed until asked for. A code you have not got is still
 * a code you may be looking up, and it is the evidence that the names above come from a table rather
 * than being invented. Its rows follow the same rule as the faults read: a name that still carries
 * German is named as untranslated, the German beside it (UX-22).
 */
function FaultDictionary({ catalog }: { catalog: EcuProfile }) {
    const { lang, t } = useLang();
    const [query, setQuery] = useState('');
    const untranslated = humanName(t.fault_untranslated);

    // No slice, and no empty-on-empty-query: `0 / 226` is what "no matches" looks like.
    const hits = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return catalog.faultText;
        return catalog.faultText.filter((f) => {
            if (f.code.toLowerCase().includes(q)) return true;
            const x = catalog.texts[f.text];
            return !!x && [x.de, x.ja, x.en].some((s) => s.toLowerCase().includes(q));
        });
    }, [catalog, query]);

    return (
        <Fold title={t.faultRef} count={catalog.faultText.length} note={t.faultRef_info}>
            <ListControls query={query} onQuery={setQuery} placeholder={t.faultRef_search} shown={hits.length} total={catalog.faultText.length} />
            <DataList className="mt-3">
                {hits.map((f) => {
                    const x = textLabel(catalog, f.text, lang);
                    const slots = nameSlots(x, humanName(''), untranslated);
                    return (
                        <DataRow
                            key={f.code}
                            code={f.code}
                            name={slots.name}
                            ident={slots.ident}
                            detail={x.text && x.original && x.original !== x.text ? <p className="font-mono text-[10px] text-slate-500">{x.original}</p> : undefined}
                        />
                    );
                })}
            </DataList>
        </Fold>
    );
}

/**
 * How many faults are stored — the one number this tab is about, said from the same read MAIN shows
 * (UX-17): the count however the module was read; nothing while the answer is bytes nothing here
 * reads (MAIN shows them); the empty state only before anything was read.
 */
export function DiagnosisViz({ faults, rawFaults }: Pick<FaultRead, 'faults' | 'rawFaults'>) {
    const { t } = useLang();
    const n = faultCount({ faults, rawFaults });
    if (n === null) return <Awaiting icon={ScanLine} label={t.awaiting_read} />;
    if (n === 'bytes') return null;
    return <CountReadout value={n} tone={n === 0 ? 'text-slate-300' : 'text-red-400'} caption={n === 0 ? t.viz_clean : t.viz_faults} />;
}

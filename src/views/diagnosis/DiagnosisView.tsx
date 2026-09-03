'use client';

import { memo, useMemo, useState } from 'react';
import { ScanLine } from 'lucide-react';
import { formatErrorCode } from '@tsunagi/ds2-mss54';
import {
    DataList,
    DataRow,
    Field,
    ListControls,
    MicroLabel,
    Pane,
    Section,
    Well,
    humanName,
} from '@/components/ui';
import type { ErrorMemoryEntry } from '@tsunagi/ds2-mss54';
import { normCode } from '@/lib/faultCode';
import { useLang, type Lang } from '@/lib/i18n';
import { text as resolveText, type EcuProfile } from '@/lib/ecuCatalog';
import { Awaiting } from '@/views/shared/Awaiting';
import { CountReadout } from '@/views/shared/CatalogSummary';

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
}

/**
 * DIAGNOSIS — what the ECU is complaining about, and what the complaint means.
 *
 * Two sections that look alike and are not. The top one is what THIS car
 * answered. The bottom one is the whole fault table the SGBD publishes, and it
 * is here because a code you have not got is still a code you may be looking
 * up — and because it is the evidence that the names above are being resolved
 * from a table rather than invented.
 */
export const DiagnosisView = memo(function DiagnosisView({
    ident,
    faults,
    catalog,
}: FaultRead & { catalog: EcuProfile | null }) {
    const { lang, t } = useLang();
    const [query, setQuery] = useState('');

    // Code-keyed now. The old table was an unindexed bag of strings scraped by
    // XOR-ing the .prg and truncated at exactly 250, so a fault could be looked
    // up only by reading German. FORTTEXTE is the SGBD's real mapping.
    const faultByCode = useMemo(
        () => new Map((catalog?.faultText ?? []).map((f) => [normCode(f.code), f])),
        [catalog],
    );
    const envByCode = useMemo(
        () => new Map((catalog?.envFields ?? []).map((e) => [normCode(e.code), e])),
        [catalog],
    );

    // No slice, and no empty-on-empty-query. Returning [] with no query made the
    // counter read `0 / 226`, which is what "no matches" looks like — on a list
    // that had simply not been asked anything yet. The jobs list renders 115 rows
    // without complaint; 226 is not the problem.
    const hits = useMemo(() => {
        if (!catalog) return [];
        const q = query.trim().toLowerCase();
        if (!q) return catalog.faultText;
        return catalog.faultText.filter((f) => {
            if (f.code.toLowerCase().includes(q)) return true;
            const x = catalog.texts[f.text];
            return !!x && [x.de, x.ja, x.en].some((s) => s.toLowerCase().includes(q));
        });
    }, [catalog, query]);

    return (
        <Pane>
            {ident && (
                <Section title="IDENT" note={t.ident_note(ident.length)}>
                    <Well className="max-w-[60ch]">
                        <p className="break-all font-mono text-xs text-slate-300">{ident.hex}</p>
                    </Well>
                </Section>
            )}

            {/* The ECU's learned values used to be a section here, read from a
                sub-action button. They have their own tab now — see
                `views/adaptation`. They are not a footnote to the fault memory:
                after a repair they are the thing you came to look at, and the
                ECU's reset for them needed somewhere to be refused out loud. */}

            <Section title={t.faults_read} count={faults?.length}>
            {faults === null ? (
                <p className="py-2 font-mono text-xs uppercase text-slate-600">{t.awaiting_read}</p>
            ) : faults.length === 0 ? (
                <p className="py-2 text-xs text-emerald-400">{t.faults_none}</p>
            ) : (
                <DataList>
                    {faults.map((f) => {
                        const code = formatErrorCode(f.errorCode);
                        const known = faultByCode.get(normCode(code));
                        const meaning = known && catalog ? resolveText(catalog, known.text, lang) : null;
                        return (
                            <DataRow
                                key={`${f.number}-${f.errorCode}`}
                                code={code}
                                codeTone="danger"
                                name={meaning?.text ?? humanName('')}
                                trailing={
                                    <span className="shrink-0 font-mono text-[10px] text-slate-600">
                                        {formatErrorCode(f.errorType)}
                                    </span>
                                }
                                detail={
                                    <>
                                        {meaning?.original && meaning.original !== meaning.text && (
                                            <p className="font-mono text-[10px] text-slate-500">{meaning.original}</p>
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
                                                bytes={[s.condition1, s.condition2, s.condition3, s.condition4]}
                                                counter={s.counter}
                                                codes={known?.env}
                                                envByCode={envByCode}
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

            {catalog && (
                <Section title={t.faultRef} count={catalog.faultText.length} note={t.faultRef_note}>
                    <ListControls
                        query={query}
                        onQuery={setQuery}
                        placeholder={t.faultRef_search}
                        shown={hits.length}
                        total={catalog.faultText.length}
                    />
                    <DataList className="mt-3">
                        {hits.map((f) => {
                            const x = resolveText(catalog, f.text, lang);
                            return (
                                <DataRow
                                    key={f.code}
                                    code={f.code}
                                    name={x.text}
                                    detail={
                                        x.original !== x.text ? (
                                            <p className="font-mono text-[10px] text-slate-500">{x.original}</p>
                                        ) : undefined
                                    }
                                />
                            );
                        })}
                    </DataList>
                </Section>
            )}
        </Pane>
    );
});

/**
 * How many faults are stored — the one number this tab is about.
 *
 * Nothing read yet is an EMPTY state, not a zero. Rendering "—" put a barely
 * visible dash in the middle of a 460px void; the canonical placeholder says
 * what the instrument is waiting for instead.
 */
export function DiagnosisViz({ faults }: Pick<FaultRead, 'faults'>) {
    const { t } = useLang();
    const n = faults?.length;
    if (n === undefined) return <Awaiting icon={ScanLine} label={t.awaiting_read} />;
    return (
        <CountReadout
            value={n}
            tone={n === 0 ? 'text-emerald-400' : 'text-red-400'}
            caption={n === 0 ? t.viz_clean : t.viz_faults}
        />
    );
}

/**
 * A freeze frame, decoded.
 *
 * This used to print `20 40 60 80` — four raw bytes with no names and no units,
 * because the decode table was not in the dump. `FUMWELTTEXTE` carries the field
 * name, the unit and the arithmetic, and `FORTTEXTE.UW_1..UW_4` says WHICH four
 * fields this particular fault stored. Both arrived with the Phase 0 re-dump.
 *
 * Where the fault does not name its fields, the raw bytes are still shown. A
 * missing table means "we cannot name these", not "there was nothing here".
 */
function FreezeFrame({
    index,
    bytes,
    counter,
    codes,
    envByCode,
    profile,
    lang,
}: {
    index: number;
    bytes: number[];
    counter: number;
    codes?: string[];
    envByCode: Map<string, NonNullable<EcuProfile['envFields']>[number]>;
    profile: EcuProfile | null;
    lang: Lang;
}) {
    const hex = bytes.map((b) => b.toString(16).padStart(2, '0')).join(' ');
    const decoded =
        codes && profile
            ? bytes.map((b, i) => {
                  const e = codes[i] ? envByCode.get(normCode(codes[i])) : undefined;
                  if (!e) return null;
                  const value = b * (e.scale ?? 1) + (e.add ?? 0);
                  return { name: resolveText(profile, e.text, lang).text, value, unit: e.unit };
              })
            : null;

    return (
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <span className="font-mono text-[10px] text-slate-600">
                #{index + 1} {hex} ×{counter}
            </span>
            {decoded?.map(
                (d, i) =>
                    d && (
                        <Field
                            key={i}
                            label={d.name}
                            labelKind="data"
                            value={Number.isInteger(d.value) ? d.value : d.value.toFixed(1)}
                            unit={d.unit}
                        />
                    ),
            )}
        </div>
    );
}

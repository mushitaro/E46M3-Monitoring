'use client';

import { memo, useMemo } from 'react';
import { ScanLine } from 'lucide-react';
import { formatErrorCode, type ErrorMemoryEntry } from '@tsunagi/ds2-mss54';
import { DataList, DataRow, LABEL, Section, humanName } from '@/components/ui';
import { normCode } from '@/lib/faultCode';
import { useLang } from '@/lib/i18n';
import { text as resolveText, type EcuIndex, type EcuProfile } from '@/lib/ecuCatalog';
import type { ScanResult, ScanRun } from '@/lib/probe/scan';
import type { RunBlockKey } from '@/lib/runGate';
import { Awaiting } from '@/views/shared/Awaiting';
import { CountReadout } from '@/views/shared/CountReadout';

/** What DIAGNOSIS shows with ALL MODULES chosen: the last scan, and how far one in progress has got. */
export interface ScanShown {
    run: ScanRun | null;
    progress: { done: number; total: number } | null;
    index: EcuIndex | null;
    /** The MSS54's own catalogue, for the text of the one module that is decoded. */
    mss54: EcuProfile | null;
    /** The address whose row is open. */
    selected: string | null;
    onSelect: (address: string | null) => void;
}

/**
 * Where a row stands, in one or two words and a colour, and how far up the list it goes.
 *
 * Faults first, then what answered, then what was refused, then silence: the order of what the
 * owner has to do something about. A module with no decoder that answered is "undecoded", not
 * "no faults" — its bytes may hold one, and a green word over them would be a reading of fiction.
 */
export function standing(r: ScanResult, t: ReturnType<typeof useLang>['t']): { word: string; tone: string; rank: number; entries: ErrorMemoryEntry[] | null } {
    const entries = Array.isArray(r.decoded) ? (r.decoded as ErrorMemoryEntry[]) : null;
    switch (r.outcome) {
        case 'answered':
            if (entries) {
                return entries.length > 0
                    ? { word: t.scan_outcome.faults(entries.length), tone: 'text-red-400', rank: 0, entries }
                    : { word: t.scan_outcome.clean, tone: 'text-emerald-400', rank: 1, entries };
            }
            return { word: t.scan_outcome.undecoded, tone: 'text-slate-400', rank: 2, entries: null };
        case 'identified':
            return { word: t.scan_outcome.identified, tone: 'text-slate-400', rank: 2, entries: null };
        case 'rejected':
            return { word: t.scan_outcome.rejected, tone: 'text-amber-400', rank: 3, entries: null };
        case 'refused':
            return { word: t.scan_outcome.refused, tone: 'text-slate-500', rank: 4, entries: null };
        case 'skipped':
            return { word: t.scan_outcome.skipped, tone: 'text-slate-600', rank: 5, entries: null };
        case 'silent':
            return { word: t.scan_outcome.silent, tone: 'text-slate-600', rank: 6, entries: null };
    }
}

const hhmm = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/**
 * DIAGNOSIS with ALL MODULES: one row per address the scan asked, the address in the code column
 * and the module's name where a name goes. Pressing a row opens what it said — the MSS54's codes
 * with their text, another module's bytes as they came back, or why it was not asked — and OPEN
 * under the hub puts that module on the screen.
 */
export const ScanList = memo(function ScanList({ run, progress, index, mss54, selected, onSelect }: ScanShown) {
    const { lang, t } = useLang();
    const nameOf = (id: string) => {
        const m = index?.modules.find((x) => x.id === id);
        return m ? (lang === 'ja' ? m.name : m.name_en) || m.name_en : id;
    };
    const faultText = useMemo(() => new Map((mss54?.faultText ?? []).map((f) => [normCode(f.code), f])), [mss54]);
    const rows = useMemo(() => {
        if (!run) return [];
        return run.results
            .map((r) => ({ r, s: standing(r, t) }))
            .sort((a, b) => a.s.rank - b.s.rank || a.r.address.localeCompare(b.r.address));
    }, [run, t]);

    return (
        <Section
            title={t.scan_title}
            count={run?.results.length}
            note={run ? t.scan_note(hhmm(run.endedAt)) : undefined}
            info={t.scan_info}
        >
            {!run ? (
                <p className="py-2 font-mono text-xs uppercase text-slate-600">
                    {progress ? t.scan_progress(progress.done, progress.total) : t.awaiting_scan}
                </p>
            ) : (
                <DataList>
                    {rows.map(({ r, s }) => {
                        const open = selected === r.address;
                        return (
                            <DataRow
                                key={r.address}
                                code={r.address}
                                codeTone={s.rank === 0 ? 'danger' : 'neutral'}
                                name={humanName(r.modules.map(nameOf).join(' / '))}
                                selected={open}
                                onSelect={() => onSelect(open ? null : r.address)}
                                trailing={<span className={`shrink-0 ${LABEL} ${s.tone}`}>{s.word}</span>}
                                detail={open ? <Opened r={r} entries={s.entries} faultText={faultText} mss54={mss54} lang={lang} /> : undefined}
                            />
                        );
                    })}
                </DataList>
            )}
        </Section>
    );
});

/** What one address said, opened under its row. */
function Opened({
    r,
    entries,
    faultText,
    mss54,
    lang,
}: {
    r: ScanResult;
    entries: ErrorMemoryEntry[] | null;
    faultText: Map<string, NonNullable<EcuProfile['faultText']>[number]>;
    mss54: EcuProfile | null;
    lang: 'ja' | 'en';
}) {
    const { t } = useLang();
    const reason = r.reason && r.outcome !== 'silent' ? (t.runBlock[r.reason as RunBlockKey] ?? r.reason) : null;
    return (
        <>
            {entries?.map((f) => {
                const code = formatErrorCode(f.errorCode);
                const known = faultText.get(normCode(code));
                return (
                    // The row's own columns: the code under the address, the text under the name.
                    <p key={`${f.number}-${f.errorCode}`} className="flex items-baseline gap-x-3 text-[11px]">
                        <span className="w-10 shrink-0 text-right font-mono tabular-nums text-red-400">{code}</span>
                        <span className="min-w-0 truncate text-slate-300">{known && mss54 ? resolveText(mss54, known.text, lang).text : '—'}</span>
                        <span className="shrink-0 font-mono text-slate-600">×{f.frequencyCounter}</span>
                    </p>
                );
            })}
            {!entries &&
                r.exchanges
                    .filter((x) => x.response !== null)
                    .map((x) => (
                        <p key={x.request} className="break-all pl-[52px] font-mono text-[11px] text-slate-400">
                            {x.request} → {x.response || '—'}
                        </p>
                    ))}
            {r.variant && r.variant.basis !== 'm3-fitment' && <p className="pl-[52px] font-mono text-[11px] text-slate-400">{t.scan_variant(r.variant.sgbd, r.variant.moduleId !== null)}</p>}
            {reason && <p className="pl-[52px] text-[11px] text-slate-500">{reason}</p>}
            {r.modules.length > 1 && <p className="pl-[52px] text-[11px] text-slate-500">{t.scan_shared}</p>}
        </>
    );
}

/**
 * The picture beside the scan: how many addresses answered, of how many asked — or how far one in
 * progress has got. Red when the one decoded module holds a fault; the others cannot say.
 */
export function ScanViz({ run, progress }: Pick<ScanShown, 'run' | 'progress'>) {
    const { t } = useLang();
    if (progress) return <CountReadout value={progress.done} suffix={`/${progress.total}`} tone="text-slate-400" caption={t.scan_title} />;
    if (!run) return <Awaiting icon={ScanLine} label={t.awaiting_scan} />;
    const answered = run.results.filter((r) => r.outcome === 'answered').length;
    const faulted = run.results.some((r) => Array.isArray(r.decoded) && (r.decoded as unknown[]).length > 0);
    return <CountReadout value={answered} suffix={`/${run.results.length}`} tone={faulted ? 'text-red-400' : 'text-slate-200'} caption={t.viz_scanAnswered} />;
}

'use client';

import { memo, useEffect, useMemo, useState } from 'react';
import { ScanLine } from 'lucide-react';
import { formatErrorCode, type ErrorMemoryEntry } from '@tsunagi/ds2-mss54';
import { DataList, DataRow, LABEL, Section, humanName } from '../../components/ui';
import { codeText, faultName } from '../../lib/faultText';
import { isUnnamedLocation, kindsJa } from '../../lib/faultKinds';
import { useLang } from '../../lib/i18n';
import { loadEcuCatalog, mss54Present, presentFromKinds, readCutShort, scanSummary, type EcuIndex, type EcuProfile } from '@tsunagi/monitoring-engine';
import type { ScanResult, ScanRun } from '@tsunagi/monitoring-engine';
import type { SgbdFault } from '@tsunagi/monitoring-engine';
import type { RunBlockKey } from '@tsunagi/monitoring-engine';
import { Awaiting } from '../shared/Awaiting';
import { CountReadout } from '../shared/CountReadout';
import { FreezeFrame } from '../shared/FreezeFrame';

/** What DIAGNOSIS shows with ALL MODULES chosen: the last scan, and how far one in progress has got. */
export interface ScanShown {
    run: ScanRun | null;
    progress: { done: number; total: number } | null;
    index: EcuIndex | null;
    /** The MSS54's own catalogue, for the text of the one module that is decoded. */
    mss54: EcuProfile | null;
    /** The address OPEN under the hub puts on the screen: the row opened last. */
    selected: string | null;
    onSelect: (address: string | null) => void;
    /** What to do first, said where the list will be while nothing is connected (SC01 step 1). */
    idleHint?: string;
    /** The module the owner said answers at an address no IDENT rule decides (0x56 ASC or DSC; lib/variantChoice). */
    ownerChose?: (address: number) => string | null;
    /** The one module the link opens on (and single-module tools act on), said beside the title. */
    linkModule?: string;
}

/**
 * Where a row stands, in one or two words and a colour, and how far up the list it goes.
 *
 * Faults first, then what answered, then what was refused, then silence: the order of what the
 * owner has to do something about. A module with no decoder that answered is "undecoded", not
 * "no faults" — its bytes may hold one, and a green word over them would be a reading of fiction.
 * A read that stopped part of the way says so, with what it had read by then (IJ16).
 */
export function standing(
    r: ScanResult,
    t: ReturnType<typeof useLang>['t'],
): { word: string; tone: string; rank: number; entries: ErrorMemoryEntry[] | null; sgbd: SgbdFault[] | null } {
    const entries = Array.isArray(r.decoded) ? (r.decoded as ErrorMemoryEntry[]) : null;
    const sgbd = sgbdFaultsOf(r);
    const none = { entries: null, sgbd: null };
    switch (r.outcome) {
        case 'answered': {
            if (readCutShort(r)) {
                const n = entries?.length ?? sgbd?.length ?? r.faults?.length ?? 0;
                return { word: t.scan_outcome.partial(n), tone: n > 0 ? 'text-red-400' : 'text-amber-400', rank: n > 0 ? 0 : 2, entries, sgbd };
            }
            const n = entries?.length ?? sgbd?.length;
            if (n !== undefined) {
                return n > 0
                    ? { word: t.scan_outcome.faults(n), tone: 'text-red-400', rank: 0, entries, sgbd }
                    : { word: t.scan_outcome.clean, tone: 'text-emerald-400', rank: 1, entries, sgbd };
            }
            // Read where the module's own SGBD reads it (engine faultLayouts): said, and said unconfirmed.
            if (r.faults) {
                return r.faults.length > 0
                    ? { word: t.scan_outcome.faultsUnverified(r.faults.length), tone: 'text-red-400', rank: 0, ...none }
                    : { word: t.scan_outcome.cleanUnverified, tone: 'text-slate-400', rank: 2, ...none };
            }
            return { word: t.scan_outcome.undecoded, tone: 'text-slate-400', rank: 2, ...none };
        }
        case 'identified':
            return { word: t.scan_outcome.identified, tone: 'text-slate-400', rank: 2, ...none };
        case 'rejected':
            return { word: t.scan_outcome.rejected, tone: 'text-amber-400', rank: 3, ...none };
        case 'refused':
            // Its own SGBD has no fault read the app could send: said on the row, not a bare "not sent" (MM01).
            if (/carries no short fault-read frame/.test(r.reason ?? '')) return { word: t.scan_outcome.noFaultRead, tone: 'text-slate-500', rank: 4, ...none };
            return { word: t.scan_outcome.refused, tone: 'text-slate-500', rank: 4, ...none };
        case 'skipped':
            return { word: t.scan_outcome.skipped, tone: 'text-slate-600', rank: 5, ...none };
        case 'silent':
            return { word: t.scan_outcome.silent, tone: 'text-slate-600', rank: 6, ...none };
    }
}

/**
 * The entries a module's own SGBD read out of its answer: all of them when its job ran to its end and
 * said OKAY, and those it had read when it stopped part of the way (the row says the list may be
 * short). A job that ended with another verdict is not a list: the row stays "undecoded", with its bytes.
 */
export function sgbdFaultsOf(r: ScanResult): SgbdFault[] | null {
    const s = r.sgbdFaults;
    if (!s) return null;
    if (s.stopped !== null) return s.faults;
    return s.status === 'OKAY' ? s.faults : null;
}

/**
 * Which module a row is (F03, IJ15): the one its IDENT chose, or the one SGBD at the address. Where
 * several stay possible, a `?` with the candidates — never the candidates listed as if all were fitted.
 */
function rowName(r: ScanResult, nameOf: (id: string) => string, t: ReturnType<typeof useLang>['t'], ownerChose?: (address: number) => string | null): string {
    const owner = ownerChose?.(typeof r.address === 'number' ? r.address : parseInt(String(r.address), 16));
    if (owner && r.modules.includes(owner)) return nameOf(owner);
    const chosen = r.variant?.moduleId;
    if (chosen && r.modules.includes(chosen) && r.variant?.basis !== 'm3-fitment') return nameOf(chosen);
    if (r.modules.length === 1) return nameOf(r.modules[0]);
    // 0x56: the early cars' ASC MK20 and the late cars' DSC share it, and no group file chooses (CLAUDE.md).
    const byYear = r.modules.includes('ascmk20') && r.modules.includes('dsc_e46');
    return t.scan_undecided(r.modules.map(nameOf), byYear);
}

/** The catalogue of each module whose entries a row names, loaded as the rows need them. */
function useProfiles(run: ScanRun | null, mss54: EcuProfile | null): ReadonlyMap<string, EcuProfile> {
    const [loaded, setLoaded] = useState<ReadonlyMap<string, EcuProfile>>(new Map());
    const ids = useMemo(() => {
        const out = new Set<string>();
        for (const r of run?.results ?? []) {
            const id = r.decoded && (r.variant?.moduleId === 'mss54' || r.modules.length === 1 && r.modules[0] === 'mss54') ? 'mss54' : r.sgbdFaults?.module ?? (r.faults ? (r.variant?.moduleId ?? (r.modules.length === 1 ? r.modules[0] : null)) : null);
            if (id) out.add(id);
        }
        return [...out].sort().join(',');
    }, [run]);
    useEffect(() => {
        if (!ids) return;
        let live = true;
        void Promise.all(ids.split(',').map((id) => loadEcuCatalog(id).then((p) => [id, p] as const, () => null))).then((xs) => {
            if (live) setLoaded(new Map(xs.filter((x): x is readonly [string, EcuProfile] => x !== null)));
        });
        return () => {
            live = false;
        };
    }, [ids]);
    return useMemo(() => {
        const m = new Map(loaded);
        if (mss54) m.set('mss54', mss54);
        return m;
    }, [loaded, mss54]);
}

const hhmm = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/**
 * ALL MODULES on the screen, and the link opens on one module: which one, beside the title.
 *
 * The scan reaches every address on that one link, so opening on MSS54 is right; what was wrong was
 * that nothing said so — CONNECT under ALL MODULES went to MSS54 and the screen still read ALL
 * MODULES (owner, 2026-11-28). Shown connected and not, since it is where CONNECT goes too. Here
 * and not on the module row, which has no room beside the select on a head unit once connected.
 * The name before its parenthesis; the whole name and what it means are the title.
 */
function LinkTarget({ index, module }: { index: EcuIndex | null; module: string }) {
    const { lang, t } = useLang();
    const entry = index?.modules.find((e) => e.id === module);
    const full = entry ? (lang === 'ja' ? entry.name || entry.name_en : entry.name_en || entry.name) : module;
    return (
        // One line of text, not three boxes: the list's own rows are address, name, tag on lines of
        // their own, and a readout laid out the same way would read as a fourth row for 0x12.
        <span className="min-w-0 truncate font-mono text-[10px] text-slate-500" title={t.module_linkTitle(full)} data-testid="link-target">
            {[t.module_link, entry?.addressHex, full.split(' (')[0]].filter(Boolean).join(' ')}
        </span>
    );
}

/**
 * DIAGNOSIS with ALL MODULES: one row per address the scan asked, the address in the code column
 * and the module's name where a name goes. Pressing a row opens what it said — the codes with their
 * names, whether each is there now, and the conditions recorded with it; another module's bytes as
 * they came back where nothing reads them; or why it was not asked — and OPEN under the hub puts the
 * module of the row opened last on the screen. Rows open and close on their own, so two modules'
 * faults can be read side by side (SC02 step 2).
 */
export const ScanList = memo(function ScanList({ run, progress, index, mss54, selected, onSelect, idleHint, ownerChose, linkModule }: ScanShown) {
    const { lang, t } = useLang();
    const nameOf = (id: string) => {
        const m = index?.modules.find((x) => x.id === id);
        return m ? (lang === 'ja' ? m.name : m.name_en) || m.name_en : id;
    };
    const profiles = useProfiles(run, mss54);
    const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
    const rows = useMemo(() => {
        if (!run) return [];
        return run.results
            .map((r) => ({ r, s: standing(r, t) }))
            .sort((a, b) => a.s.rank - b.s.rank || a.r.address.localeCompare(b.r.address));
    }, [run, t]);
    const summary = run ? scanSummary(run.results) : null;
    const toggle = (address: string) => {
        const next = new Set(open);
        if (next.has(address)) {
            next.delete(address);
            if (selected === address) onSelect(null);
        } else {
            next.add(address);
            onSelect(address);
        }
        setOpen(next);
    };

    return (
        <Section
            title={t.scan_title}
            count={run?.results.length}
            note={run && summary ? `${t.scan_summary(summary.modules, summary.faults)} · ${t.scan_note(hhmm(run.endedAt))}` : undefined}
            info={t.scan_info}
            actions={linkModule ? <LinkTarget index={index} module={linkModule} /> : undefined}
        >
            {!run ? (
                <p className="py-2 font-mono text-xs text-slate-600">
                    {progress ? t.scan_progress(progress.done, progress.total) : (idleHint ?? t.awaiting_scan)}
                </p>
            ) : (
                <DataList>
                    {rows.map(({ r, s }) => {
                        const isOpen = open.has(r.address);
                        return (
                            <DataRow
                                key={r.address}
                                code={r.address}
                                codeTone={s.rank === 0 ? 'danger' : 'neutral'}
                                name={humanName(rowName(r, nameOf, t, ownerChose))}
                                selected={isOpen}
                                onSelect={() => toggle(r.address)}
                                trailing={<span className={`shrink-0 ${LABEL} ${s.tone}`}>{s.word}</span>}
                                detail={isOpen ? <Opened r={r} entries={s.entries} sgbd={s.sgbd} profiles={profiles} lang={lang} /> : undefined}
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
    sgbd,
    profiles,
    lang,
}: {
    r: ScanResult;
    entries: ErrorMemoryEntry[] | null;
    sgbd: SgbdFault[] | null;
    profiles: ReadonlyMap<string, EcuProfile>;
    lang: 'ja' | 'en';
}) {
    const { t } = useLang();
    const mss54 = profiles.get('mss54') ?? null;
    const sgbdProfile = (r.sgbdFaults && profiles.get(r.sgbdFaults.module)) || null;
    const layoutProfile = r.faults ? (profiles.get(r.variant?.moduleId ?? r.modules[0]) ?? null) : null;
    const reason = reasonText(r, t, lang);
    const cutShort = readCutShort(r);
    return (
        <>
            {entries?.map((f) => {
                const code = formatErrorCode(f.errorCode);
                const name = faultName(mss54, code, lang);
                return (
                    <div key={`${f.number}-${f.errorCode}`} className="space-y-0.5">
                        {/* The row's own columns: the code under the address, the name under the name. */}
                        <p className="flex items-baseline gap-x-3 text-[11px]">
                            <span className="w-10 shrink-0 text-right font-mono tabular-nums text-red-400">{code}</span>
                            <span className="min-w-0 flex-1 truncate text-slate-300">{name?.text || t.fault_unnamed}</span>
                            <span className="shrink-0 text-slate-400">{mss54Present(f.errorType) ? t.fault_present_now : t.fault_stored}</span>
                            <span className="shrink-0 font-mono text-slate-600">×{f.frequencyCounter}</span>
                        </p>
                        <div className="space-y-0.5 pl-[52px]">
                            {name?.original && name.original !== name.text && <p className="font-mono text-[10px] text-slate-500">{name.original}</p>}
                            {f.environmentSets.map((s, i) => (
                                <FreezeFrame
                                    key={i}
                                    index={i}
                                    code={code}
                                    bytes={[s.condition1, s.condition2, s.condition3, s.condition4]}
                                    counter={s.counter}
                                    profile={mss54}
                                    lang={lang}
                                />
                            ))}
                        </div>
                    </div>
                );
            })}
            {sgbd?.map((f, i) => {
                // The location's number in the module's own table, its name from that table in the reader's
                // language, and the SGBD's own German beside it (with what kind of fault it says it is).
                const name = faultName(sgbdProfile, f.code, lang);
                const present = presentFromKinds(f.kinds);
                return (
                    <div key={`${i}-${f.code}`} className="space-y-0.5">
                        <p className="flex items-baseline gap-x-3 text-[11px]">
                            <span className="w-10 shrink-0 text-right font-mono tabular-nums text-red-400">{codeText(sgbdProfile, f.code)}</span>
                            <span className="min-w-0 flex-1 truncate text-slate-300">{name?.text || (isUnnamedLocation(f.text) ? t.fault_unnamed : f.text)}</span>
                            {present !== null && <span className="shrink-0 text-slate-400">{present ? t.fault_present_now : t.fault_stored}</span>}
                        </p>
                        {f.kinds.length > 0 && lang === 'ja' && <p className="truncate pl-[52px] text-[10px] text-slate-400">{kindsJa(f.kinds).join(' · ')}</p>}
                        <p className="truncate pl-[52px] font-mono text-[10px] text-slate-500">{[f.text, ...f.kinds].filter(Boolean).join(' · ')}</p>
                    </div>
                );
            })}
            {r.faults?.map((f, i) => {
                const name = faultName(layoutProfile, f.code, lang);
                return (
                    <p key={`l-${i}-${f.code}`} className="flex items-baseline gap-x-3 text-[11px]">
                        <span className="w-10 shrink-0 text-right font-mono tabular-nums text-red-400">{f.code}</span>
                        <span className="min-w-0 flex-1 truncate text-slate-300">{name?.text || t.fault_unnamed}</span>
                        {f.present !== null && <span className="shrink-0 text-slate-400">{f.present ? t.fault_present_now : t.fault_stored}</span>}
                    </p>
                );
            })}
            {cutShort && <p className="pl-[52px] text-[11px] text-amber-400">{t.scan_partial}</p>}
            {r.sgbdFaults && <p className="pl-[52px] text-[11px] text-slate-500">{t.scan_sgbdRead(r.sgbdFaults.module, sgbd !== null)}</p>}
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
            {r.modules.length > 1 && !(r.variant?.moduleId && r.variant.basis !== 'm3-fitment') && <p className="pl-[52px] text-[11px] text-slate-500">{t.scan_shared}</p>}
        </>
    );
}

/**
 * Why a row went as it did, in the reader's language: the gate's own sentence where it held the read
 * back (runBlock), the scan's reasons the catalogue words, and nothing else — the engine's English
 * is not put in front of a Japanese reader (IJ15, U5). The variant line and the shared line above
 * already say what the untranslated reasons would.
 */
function reasonText(r: ScanResult, t: ReturnType<typeof useLang>['t'], lang: 'ja' | 'en'): string | null {
    if (!r.reason || r.outcome === 'silent') return null;
    const key = t.runBlock[r.reason as RunBlockKey];
    if (key) return key;
    const known = t.scan_reason(r.reason);
    if (known !== undefined) return known;
    return lang === 'en' ? r.reason : null;
}

/**
 * The picture beside the scan: how many addresses answered, of how many asked — or how far one in
 * progress has got. Red when a decoded module holds a fault; the undecoded ones cannot say.
 */
export function ScanViz({ run, progress }: Pick<ScanShown, 'run' | 'progress'>) {
    const { t } = useLang();
    if (progress) return <CountReadout value={progress.done} suffix={`/${progress.total}`} tone="text-slate-400" caption={t.scan_title} />;
    if (!run) return <Awaiting icon={ScanLine} label={t.awaiting_scan} />;
    const { modules, faults } = scanSummary(run.results);
    return <CountReadout value={modules} suffix={`/${run.results.length}`} tone={faults > 0 ? 'text-red-400' : 'text-slate-200'} caption={t.viz_scanAnswered} />;
}

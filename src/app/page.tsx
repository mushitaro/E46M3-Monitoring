'use client';

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CircleDot, PlugZap, Radio, Square, Zap } from 'lucide-react';
import { MSS54_LIVE_BLOCKS, formatErrorCode, planBlockReads } from '@tsunagi/ds2-mss54';
import { AppHeader } from '@/components/AppHeader';
import { Hub, HubCluster, HubNotice, SubActions, type HubConfig } from '@/components/Hub';
import { JobTable } from '@/components/JobTable';
import { LinkError } from '@/components/LinkError';
import { LogPopover } from '@/components/LogPopover';
import { StatusLed } from '@/components/StatusLed';
import { useDs2Link, type CommsLogLine, type LiveSample } from '@/hooks/useDs2Link';
import { useLang, type Lang, type Strings } from '@/lib/i18n';
import { jobRisk, loadEcuCatalog, loadEcuIndex, type EcuCatalog, type EcuIndexEntry } from '@/lib/ecuCatalog';
import { EMPTY_LEDGER, type Ledger } from '@/lib/ledger';

type Tab = 'diagnosis' | 'datalog' | 'calibration' | 'testjobs';
type Link = ReturnType<typeof useDs2Link>;

/**
 * The shell.
 *
 * Layout follows the ///M spatial system rather than being invented: a 48px app
 * header whose bottom rule is the tricolor stripe, a 44px tab bar, and a phi
 * (61.8 / 38.2) split whose right column is a fixed stack — pane title, a
 * visualization region, then a control panel holding the status row, a RESERVED
 * notice line, the hub cluster and a RESERVED sub-action row.
 *
 * The reserved slots are the part that is easy to skip and shouldn't be:
 * transient text appears and disappears INSIDE them, so a state change
 * recolours and relabels without reflowing anything. A panel that twitches
 * every time the link state moves reads as untrustworthy on a tool that
 * commands a car.
 */
export default function Home() {
    const { t, lang } = useLang();
    const link = useDs2Link();
    const [tab, setTab] = useState<Tab>('diagnosis');

    const [ecuIndex, setEcuIndex] = useState<EcuIndexEntry[]>([]);
    const [ecuId, setEcuId] = useState('mss54');
    const [loaded, setLoaded] = useState<{ id: string; catalog: EcuCatalog } | null>(null);
    const [catalogError, setCatalogError] = useState<string | null>(null);
    const catalog = loaded?.id === ecuId ? loaded.catalog : null;
    const ledger: Ledger = EMPTY_LEDGER;

    // Datalog state lives here so the right column can visualise a run while
    // the datalog tab is not the one on the left.
    const datalog = useDatalog(link);

    useEffect(() => {
        loadEcuIndex().then(setEcuIndex).catch((e: Error) => setCatalogError(e.message));
    }, []);

    useEffect(() => {
        let cancelled = false;
        loadEcuCatalog(ecuId)
            .then((c) => {
                if (!cancelled) setLoaded({ id: ecuId, catalog: c });
            })
            .catch((e: Error) => {
                if (!cancelled) setCatalogError(e.message);
            });
        return () => {
            cancelled = true;
        };
    }, [ecuId]);

    const connectedToVehicle = link.mode === 'vehicle' && link.state !== 'disconnected';
    const hub = useHubConfig(tab, link, datalog);

    return (
        <div className="flex h-dvh flex-col overflow-hidden bg-slate-950">
            <AppHeader ident={link.ident} />

            <nav
                role="tablist"
                className="flex h-[44px] shrink-0 items-center gap-1 border-b border-slate-900 bg-slate-900/50 px-4 backdrop-blur-sm"
            >
                {(
                    [
                        ['diagnosis', t.tab_diagnosis],
                        ['datalog', t.tab_datalog],
                        ['calibration', t.tab_calibration],
                        ['testjobs', t.tab_testjobs],
                    ] as const
                ).map(([id, labelText]) => (
                    <button
                        key={id}
                        role="tab"
                        aria-selected={tab === id}
                        onClick={() => setTab(id)}
                        className={`h-full border-b-2 px-3 text-xs font-semibold uppercase tracking-widest transition-colors ${
                            tab === id
                                ? 'border-blue-500 text-blue-400'
                                : 'border-transparent text-slate-500 hover:text-slate-300'
                        }`}
                    >
                        {labelText}
                    </button>
                ))}

                {/* Tools right, fenced with a vertical rule. The comms log is a
                    popover and not a tab: it has to be reachable WHILE doing the
                    thing that is failing, not somewhere you navigate away to. */}
                <div className="ml-auto flex items-center border-l border-slate-800 pl-4">
                    <LogPopover log={link.log} onClear={link.clearLog} onExport={() => exportLog(link.log)} />
                </div>
            </nav>

            <div className="shrink-0 px-4">
                {(link.error || catalogError) && (
                    <div className="pt-3">
                        <LinkError
                            message={link.error ?? catalogError ?? ''}
                            kind={link.errorKind}
                            onRetry={link.error ? link.clearError : undefined}
                        />
                    </div>
                )}
            </div>

            <main className="flex min-h-0 flex-1 flex-col gap-4 p-4 min-[900px]:flex-row">
                <section className="flex min-h-0 flex-1 flex-col border border-slate-800 bg-slate-900 min-[900px]:basis-[61.8%]">
                    <PaneTitle>{tabTitle(t)[tab]}</PaneTitle>
                    <div className="min-h-0 flex-1 overflow-auto p-3">
                        {tab === 'diagnosis' && <DiagnosisPane link={link} catalog={catalog} />}
                        {tab === 'datalog' && <DatalogPane datalog={datalog} />}
                        {tab === 'calibration' && (
                            <JobTable
                                jobs={catalog?.actuators ?? []}
                                ledger={ledger}
                                ecuId={ecuId}
                                connectedToVehicle={connectedToVehicle}
                                emptyLabel="—"
                            />
                        )}
                        {tab === 'testjobs' && (
                            <JobTable
                                jobs={catalog?.testJobs ?? []}
                                ledger={ledger}
                                ecuId={ecuId}
                                connectedToVehicle={connectedToVehicle}
                                emptyLabel="—"
                            />
                        )}
                    </div>
                </section>

                <aside className="flex min-h-0 flex-col border border-slate-800 bg-slate-900 min-[900px]:basis-[38.2%]">
                    <PaneTitle>{catalog ? (lang === 'en' ? catalog.name_en : catalog.name) : '—'}</PaneTitle>

                    <div className="relative min-h-[140px] flex-1 overflow-hidden p-3">
                        <Viz tab={tab} link={link} catalog={catalog} datalog={datalog} />
                    </div>

                    <div className="flex-initial overflow-y-auto px-5 pb-5 pt-4">
                        <div className="flex h-[32px] items-center gap-3">
                            <EcuSelect
                                index={ecuIndex}
                                value={ecuId}
                                lang={lang}
                                // The DS2 address is per module, so switching one
                                // under an open link would silently retarget it.
                                disabled={link.state !== 'disconnected'}
                                onChange={setEcuId}
                            />
                            <span className="ml-auto">
                                <StatusLed state={link.state} mode={link.mode} hasError={!!link.error} />
                            </span>
                        </div>

                        <HubNotice text={hub.notice} />
                        <HubCluster>
                            <Hub config={hub} />
                        </HubCluster>
                        <SubActions>
                            {link.state === 'disconnected' ? (
                                <SubButton onClick={() => void link.connect('practice')} tone="indigo">
                                    {t.practice}
                                </SubButton>
                            ) : (
                                <SubButton onClick={() => void link.disconnect()} tone="danger">
                                    {t.disconnect}
                                </SubButton>
                            )}
                            {tab === 'datalog' && datalog.samples.length > 0 && (
                                <SubButton onClick={datalog.exportCsv}>{t.exportCsv}</SubButton>
                            )}
                        </SubActions>
                    </div>
                </aside>
            </main>

            <UnverifiedBanner />
        </div>
    );
}

const tabTitle = (t: Strings): Record<Tab, string> => ({
    diagnosis: t.tab_diagnosis,
    datalog: t.tab_datalog,
    calibration: t.tab_calibration,
    testjobs: t.tab_testjobs,
});

function PaneTitle({ children }: { children: React.ReactNode }) {
    return (
        <div className="flex h-[44px] shrink-0 items-center border-b border-slate-800 px-3 text-[11px] font-semibold uppercase tracking-widest text-slate-400">
            {children}
        </div>
    );
}

/**
 * The hub's config, derived on every render from the live state. Nothing is
 * stored — storing it and re-syncing by hand is the source of "the button says
 * the wrong thing" bugs.
 *
 * The job tables deliberately contribute no config: they have dozens of
 * independently-runnable rows, each with its own inline control, and routing
 * those through one shared button would be an extra click and a re-derived
 * label. They fall through to a passive connected state.
 */
function useHubConfig(tab: Tab, link: Link, datalog: ReturnType<typeof useDatalog>): HubConfig {
    const { t } = useLang();

    if (link.state === 'disconnected') {
        return { label: t.hub_connect, Icon: PlugZap, tone: 'idle', onClick: () => void link.connect('vehicle') };
    }
    if (link.state === 'connecting') {
        return { label: t.hub_connecting, Icon: PlugZap, tone: 'connecting', disabled: true, spin: true };
    }
    if (link.state === 'busy') {
        return { label: t.hub_reading, Icon: Zap, tone: 'busy', disabled: true, spin: true };
    }
    if (link.state === 'logging') {
        return {
            label: t.hub_stop,
            Icon: Square,
            tone: 'armed',
            onClick: datalog.stop,
            notice: `${datalog.samples.length} ${t.samples}`,
        };
    }
    if (tab === 'diagnosis') {
        return {
            label: t.hub_read,
            Icon: Zap,
            tone: 'ready',
            onClick: () => void link.readIdent().then(() => link.readFaults()),
        };
    }
    if (tab === 'datalog') {
        return {
            label: t.hub_record,
            Icon: Radio,
            tone: 'ready',
            onClick: datalog.start,
            notice: datalog.costNotice,
        };
    }
    return { label: t.hub_connected, Icon: CircleDot, tone: 'idle', disabled: true };
}

/**
 * The visualization region — per-view, and not decoration: each one answers the
 * question the left pane is currently about, at a glance and from a distance.
 */
function Viz({
    tab,
    link,
    catalog,
    datalog,
}: {
    tab: Tab;
    link: Link;
    catalog: EcuCatalog | null;
    datalog: ReturnType<typeof useDatalog>;
}) {
    const { t } = useLang();

    if (tab === 'diagnosis') {
        const n = link.faults?.length;
        return (
            <div className="flex h-full flex-col items-center justify-center">
                <div
                    className={`font-mono text-6xl ${
                        n === undefined ? 'text-slate-800' : n === 0 ? 'text-emerald-400' : 'text-red-400'
                    }`}
                >
                    {n ?? '—'}
                </div>
                <div className="mt-1 text-[10px] uppercase tracking-widest text-slate-600">
                    {n === undefined ? t.viz_noData : n === 0 ? t.viz_clean : t.viz_faults}
                </div>
            </div>
        );
    }

    if (tab === 'datalog') return <Sparkline datalog={datalog} />;

    const jobs = tab === 'calibration' ? catalog?.actuators : catalog?.testJobs;
    const mix = { high: 0, medium: 0, low: 0 };
    for (const j of jobs ?? []) mix[jobRisk(j.id)]++;
    const total = (jobs ?? []).length || 1;

    return (
        <div className="flex h-full flex-col justify-center gap-2">
            <div className="text-[10px] uppercase tracking-widest text-slate-600">{t.riskMix}</div>
            <div className="flex h-3 overflow-hidden rounded-sm bg-slate-800">
                <div className="bg-red-500/70" style={{ width: `${(mix.high / total) * 100}%` }} />
                <div className="bg-amber-500/70" style={{ width: `${(mix.medium / total) * 100}%` }} />
                <div className="bg-slate-600" style={{ width: `${(mix.low / total) * 100}%` }} />
            </div>
            <div className="flex justify-between font-mono text-[10px]">
                <span className="text-red-400">
                    {mix.high} {t.risk_high}
                </span>
                <span className="text-amber-400">
                    {mix.medium} {t.risk_medium}
                </span>
                <span className="text-slate-500">
                    {mix.low} {t.risk_low}
                </span>
            </div>
        </div>
    );
}

/** A single-channel trace. Enough to see the shape; the pane shows the numbers. */
function Sparkline({ datalog }: { datalog: ReturnType<typeof useDatalog> }) {
    const { t } = useLang();
    const symbol = datalog.selected[0];
    const points = useMemo(() => {
        if (!symbol) return null;
        const window = datalog.samples.slice(-240);
        const values = window
            .map((s) => s.values[symbol])
            .filter((v): v is number => v !== null && v !== undefined);
        if (values.length < 2) return null;
        const min = Math.min(...values);
        const max = Math.max(...values);
        const span = max - min || 1;
        return {
            min,
            max,
            d: values
                .map((v, i) => `${(i / (values.length - 1)) * 100},${100 - ((v - min) / span) * 100}`)
                .join(' '),
        };
    }, [datalog.samples, symbol]);

    if (!points) {
        return (
            <div className="flex h-full items-center justify-center text-[10px] uppercase tracking-widest text-slate-700">
                {t.viz_noData}
            </div>
        );
    }

    return (
        <div className="flex h-full flex-col">
            <div className="flex items-baseline justify-between font-mono text-[10px] text-slate-600">
                <span className="text-slate-400">{symbol}</span>
                <span>
                    {points.min.toFixed(1)} – {points.max.toFixed(1)}
                </span>
            </div>
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="min-h-0 w-full flex-1">
                <polyline
                    points={points.d}
                    fill="none"
                    stroke="#26AEE4"
                    strokeWidth="1"
                    vectorEffect="non-scaling-stroke"
                />
            </svg>
        </div>
    );
}

function DiagnosisPane({ link, catalog }: { link: Link; catalog: EcuCatalog | null }) {
    const { lang, t } = useLang();
    const [query, setQuery] = useState('');

    const hits = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q || !catalog) return [];
        return catalog.faultText
            .filter((f) => [f.de, f.ja, f.en].some((s) => s.toLowerCase().includes(q)))
            .slice(0, 40);
    }, [catalog, query]);

    return (
        <>
            {link.ident && (
                <div className="mb-3 border border-slate-800 p-2">
                    <div className="text-[10px] uppercase tracking-widest text-slate-600">IDENT</div>
                    <p className="break-all font-mono text-xs text-slate-300">{link.ident.hex}</p>
                    <p className="mt-1 text-[10px] text-slate-600">
                        {link.ident.length} bytes — the field layout of this response is not yet known.
                        EdiabasLib used to decode it; shown raw rather than guessed at.
                    </p>
                </div>
            )}

            {link.faults === null ? (
                <p className="text-xs text-slate-600">—</p>
            ) : link.faults.length === 0 ? (
                <p className="text-xs text-emerald-400">{t.faults_none}</p>
            ) : (
                <ul className="space-y-2">
                    {link.faults.map((f) => (
                        <li key={`${f.number}-${f.errorCode}`} className="border border-slate-800 p-2">
                            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                                <span className="font-mono text-sm text-red-400">{formatErrorCode(f.errorCode)}</span>
                                <Readout label={t.faults_type} value={formatErrorCode(f.errorType)} />
                                <Readout label={t.faults_frequency} value={String(f.frequencyCounter)} />
                                <Readout label={t.faults_logistics} value={String(f.logisticsCounter)} />
                            </div>
                            <div className="mt-2 text-[10px] uppercase tracking-widest text-slate-600">
                                {t.faults_freezeFrames}
                            </div>
                            <table className="mt-1 w-full font-mono text-[11px] text-slate-400">
                                <tbody>
                                    {f.environmentSets.map((s, i) => (
                                        <tr key={i} className="border-t border-slate-800/60">
                                            <td className="py-0.5 pr-3 text-slate-600">#{i + 1}</td>
                                            <td className="py-0.5 pr-3">
                                                {[s.condition1, s.condition2, s.condition3, s.condition4]
                                                    .map((b) => b.toString(16).padStart(2, '0'))
                                                    .join(' ')}
                                            </td>
                                            <td className="py-0.5 text-slate-500">{s.counter}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </li>
                    ))}
                </ul>
            )}

            {catalog && (
                <div className="mt-4 border-t border-slate-800 pt-3">
                    <div className="mb-1 text-[10px] uppercase tracking-widest text-slate-600">
                        {t.faultRef} ({catalog.faultText.length})
                    </div>
                    <p className="mb-2 text-[11px] text-slate-600">{t.faultRef_note}</p>
                    <input
                        type="search"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder={t.search}
                        className="w-full border border-slate-700 bg-slate-800 px-2 py-1 font-mono text-xs text-slate-200 placeholder:text-slate-600 focus:border-blue-500 focus:outline-none"
                    />
                    <ul className="mt-2 space-y-1">
                        {hits.map((f, i) => (
                            <li key={i} className="border-b border-slate-800/60 pb-1">
                                <div className="text-[11px] text-slate-300">{lang === 'en' ? f.en : f.ja}</div>
                                <div className="font-mono text-[10px] text-slate-600">{f.de}</div>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </>
    );
}

function DatalogPane({ datalog }: { datalog: ReturnType<typeof useDatalog> }) {
    const { t } = useLang();
    return (
        <>
            <div className="mb-3 flex flex-wrap items-center gap-4 font-mono text-[11px] text-slate-500">
                <span>
                    {t.samples} <span className="text-slate-300">{datalog.samples.length}</span>
                </span>
                <span>
                    {t.rate}{' '}
                    <span className="text-slate-300">
                        {datalog.rateHz ? `${datalog.rateHz.toFixed(1)} Hz` : '—'}
                    </span>
                </span>
                <span className="text-slate-600">{datalog.costNotice}</span>
            </div>

            <table className="mb-4 w-full font-mono text-xs">
                <tbody>
                    {datalog.selected.map((symbol) => (
                        <tr key={symbol} className="border-t border-slate-800">
                            <td className="py-1 pr-4 text-slate-400">{symbol}</td>
                            <td className="py-1 text-right text-slate-200">
                                {datalog.latest[symbol] == null ? '—' : datalog.latest[symbol]!.toFixed(2)}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>

            <ChannelPicker selected={datalog.selected} disabled={datalog.running} onToggle={datalog.toggle} />
        </>
    );
}

/**
 * 213 checkboxes, memoized. Without this every sample flush re-rendered the
 * whole picker, and against a synchronous simulator that starved the poll loop
 * badly enough to report 1.0 Hz — the app measuring itself instead of the link,
 * in the one view whose job is to report the link's real rate.
 */
const ChannelPicker = memo(function ChannelPicker({
    selected,
    disabled,
    onToggle,
}: {
    selected: string[];
    disabled: boolean;
    onToggle: (symbol: string, on: boolean) => void;
}) {
    return (
        <div className="space-y-2">
            {MSS54_LIVE_BLOCKS.map((block) => (
                <details key={block.selection} className="border border-slate-800">
                    <summary className="cursor-pointer px-2 py-1 text-[11px] uppercase tracking-widest text-slate-400">
                        <span className="font-mono text-slate-600">{block.selection}</span> {block.name}{' '}
                        <span className="text-slate-600">({block.fields.length})</span>
                    </summary>
                    <div className="max-h-48 overflow-auto px-2 pb-2">
                        {block.fields.map((f) => (
                            <label
                                key={`${block.selection}:${f.symbol}`}
                                className="flex cursor-pointer items-center gap-2 py-0.5 text-[11px] text-slate-400 hover:text-slate-200"
                            >
                                <input
                                    type="checkbox"
                                    checked={selected.includes(f.symbol)}
                                    disabled={disabled}
                                    onChange={(e) => onToggle(f.symbol, e.target.checked)}
                                    className="size-3 accent-blue-500"
                                />
                                <span className="font-mono">{f.symbol}</span>
                                <span className="truncate text-slate-600">{f.name}</span>
                                {f.unit && <span className="ml-auto text-slate-700">{f.unit}</span>}
                            </label>
                        ))}
                    </div>
                </details>
            ))}
        </div>
    );
});

/** A bound on the in-memory run, stated rather than silent. */
const MAX_SAMPLES = 200_000;
const FLUSH_INTERVAL_MS = 500;

function useDatalog(link: Link) {
    const { t } = useLang();
    const [selected, setSelected] = useState<string[]>(['n', 'tmot']);
    const [samples, setSamples] = useState<LiveSample[]>([]);
    const [latest, setLatest] = useState<Record<string, number | null>>({});
    const samplesRef = useRef<LiveSample[]>([]);
    const flushAtRef = useRef(0);

    const plan = useMemo(() => planBlockReads(selected), [selected]);
    const running = link.state === 'logging';

    const rateHz = useMemo(() => {
        const s = samples.slice(-24);
        if (s.length < 2) return null;
        const span = s[s.length - 1].time - s[0].time;
        return span > 0 ? (s.length - 1) / span : null;
    }, [samples]);

    const onSample = useCallback((sample: LiveSample) => {
        // push, not concat: concat copies the whole array every sample, which is
        // quadratic in the run length and hung the renderer once the exchange
        // got fast.
        const buf = samplesRef.current;
        buf.push(sample);
        if (buf.length > MAX_SAMPLES) buf.splice(0, buf.length - MAX_SAMPLES);
        const now = performance.now();
        if (now - flushAtRef.current < FLUSH_INTERVAL_MS) return;
        flushAtRef.current = now;
        setLatest(sample.values);
        setSamples(buf.slice());
    }, []);

    const start = useCallback(() => {
        samplesRef.current.length = 0;
        flushAtRef.current = 0;
        setSamples([]);
        // Both endings land in the same place: the stop button and a link
        // failure. A run that dies must not leave the view looking live.
        link.startLog(selected, onSample, () => setSamples(samplesRef.current.slice()));
    }, [link, onSample, selected]);

    const toggle = useCallback((symbol: string, on: boolean) => {
        setSelected((prev) => (on ? [...prev, symbol] : prev.filter((s) => s !== symbol)));
    }, []);

    const exportCsv = useCallback(() => {
        const rows = [
            ['time_s', ...selected].join(','),
            ...samplesRef.current.map((s) =>
                [s.time.toFixed(3), ...selected.map((k) => s.values[k] ?? '')].join(','),
            ),
        ];
        download(rows.join('\r\n'), 'text/csv', `e46m3-datalog-${stamp()}.csv`);
    }, [selected]);

    return {
        selected,
        samples,
        latest,
        rateHz,
        running,
        start,
        stop: link.stopLog,
        toggle,
        exportCsv,
        // The cost model, stated: one round trip per BLOCK, not per channel.
        costNotice: t.channels_selected(selected.length, plan.blocks.length),
    };
}

function EcuSelect({
    index,
    value,
    lang,
    disabled,
    onChange,
}: {
    index: EcuIndexEntry[];
    value: string;
    lang: Lang;
    disabled: boolean;
    onChange: (id: string) => void;
}) {
    const { t } = useLang();
    return (
        <div className="flex items-center gap-1 rounded bg-slate-800 px-2 py-0.5">
            <span className="text-[9px] uppercase text-slate-500">{t.module}</span>
            <select
                value={value}
                disabled={disabled || index.length === 0}
                onChange={(e) => onChange(e.target.value)}
                className="max-w-44 cursor-pointer bg-transparent text-[10px] font-bold text-blue-400 outline-none disabled:cursor-not-allowed disabled:opacity-60"
            >
                {index.map((e) => (
                    <option key={e.id} value={e.id} className="bg-slate-900 text-slate-300">
                        {lang === 'en' ? e.name_en : e.name}
                    </option>
                ))}
            </select>
        </div>
    );
}

function SubButton({
    children,
    onClick,
    tone = 'neutral',
}: {
    children: React.ReactNode;
    onClick: () => void;
    tone?: 'neutral' | 'danger' | 'indigo';
}) {
    const cls =
        tone === 'danger'
            ? 'border-slate-700 text-slate-300 hover:border-red-500 hover:text-red-400'
            : tone === 'indigo'
              ? 'border-indigo-500/60 text-indigo-400 hover:bg-indigo-500/10'
              : 'border-slate-700 text-slate-300 hover:border-blue-500 hover:text-blue-400';
    return (
        <button
            type="button"
            onClick={onClick}
            className={`border bg-slate-800 px-3 py-1 font-mono text-[10px] uppercase tracking-widest transition-colors ${cls}`}
        >
            {children}
        </button>
    );
}

function Readout({ label, value }: { label: string; value: string }) {
    return (
        <span className="flex items-baseline gap-1.5">
            <span className="text-[10px] uppercase tracking-widest text-slate-600">{label}</span>
            <span className="font-mono text-xs text-slate-300">{value}</span>
        </span>
    );
}

/**
 * Permanent, not dismissible. Every number this app can display comes from a
 * static scrape of SGBD bytecode or a decompiled catalog, and none of it has
 * been confirmed against a car. Behind a one-time dialog, the app's own
 * uncertainty is the first thing a user forgets.
 */
function UnverifiedBanner() {
    const { t } = useLang();
    return (
        <footer className="shrink-0 border-t border-amber-500/30 bg-amber-500/5 px-4 py-1.5">
            <p className="text-[11px] text-amber-400">{t.unverified}</p>
        </footer>
    );
}

function exportLog(log: CommsLogLine[]) {
    const text = log
        .map((l) => `${new Date(l.t).toISOString()} ${l.kind.toUpperCase().padEnd(5)} ${l.text}`)
        .join('\r\n');
    download(text, 'text/plain', `e46m3-comms-${stamp()}.txt`);
}

function download(content: string, type: string, filename: string) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

function stamp() {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

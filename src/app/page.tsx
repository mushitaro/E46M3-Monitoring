'use client';

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Activity,
    AlertTriangle,
    CircleDot,
    Cpu,
    Download,
    FlaskConical,
    ListChecks,
    Loader2,
    PlugZap,
    Radio,
    RotateCcw,
    ScanLine,
    Square,
    Unplug,
    Zap,
    type LucideIcon,
} from 'lucide-react';
import { MSS54_LIVE_BLOCKS, formatErrorCode, planBlockReads } from '@tsunagi/ds2-mss54';
import { AppHeader } from '@/components/AppHeader';
import { ElectricalFaultDialog } from '@/components/ElectricalFaultDialog';
import { Hub, HubCluster, HubNotice, SubActions, type HubConfig, type NoticeTone } from '@/components/Hub';
import { JobTable } from '@/components/JobTable';
import { LogPopover } from '@/components/LogPopover';
import { MicroLabel, SearchInput, TextButton, Well } from '@/components/ui';
import { useDs2Link, type CommsLogLine, type LiveSample } from '@/hooks/useDs2Link';
import { useLang, type Lang } from '@/lib/i18n';
import { jobRisk, loadEcuCatalog, loadEcuIndex, type EcuCatalog, type EcuIndexEntry } from '@/lib/ecuCatalog';
import { EMPTY_LEDGER, type Ledger } from '@/lib/ledger';

type Tab = 'diagnosis' | 'datalog' | 'calibration' | 'testjobs';
type Link = ReturnType<typeof useDs2Link>;

/**
 * The shell.
 *
 * Layout follows the ///M spatial system rather than being invented: a 48px app
 * header whose bottom rule is the tricolor stripe, then a phi (61.8 / 38.2)
 * split. Each column opens with its OWN 44px bar — tabs on the left, the module
 * identity on the right — so the two rules meet and form one continuous line
 * across the split. The right column then stacks a visualization region and a
 * control panel holding the status row, a RESERVED notice line, the hub cluster
 * and a RESERVED sub-action row.
 *
 * Two things this deliberately does NOT do, both of which it used to:
 *
 *   - It does not put a full-width tab bar above the split. That was a third
 *     bar (48 + 44 + 44), and it pushed a pane title into each column to say
 *     what the tab bar had just said.
 *   - It does not OUTLINE the columns, or pad and gap them apart. The columns
 *     are separated by one shared hairline, `border-r border-slate-900`, and
 *     they run to the edges. Boxing each and floating them on a 16px gutter is
 *     a card layout; this is an instrument, and the difference is entirely in
 *     whether regions are ruled or framed. See `components/ui.tsx` for the rule
 *     and the primitives that keep it.
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
    const [faultOpen, setFaultOpen] = useState(false);

    // One notice line, one precedence: a link error outranks a catalog error
    // outranks whatever the hub wanted to say about cost or progress. The hub's
    // own notice is never urgent, so it always loses.
    const notice: { text?: string; tone: NoticeTone } =
        link.error ? { text: link.error, tone: 'error' }
        : catalogError ? { text: catalogError, tone: 'warn' }
        : { text: hub.notice, tone: 'info' };

    return (
        <div className="flex h-dvh flex-col overflow-hidden bg-slate-950">
            <AppHeader
                ident={link.ident}
                state={link.state}
                mode={link.mode}
                hasError={!!link.error}
            />


            <main className="flex min-h-0 flex-1 flex-col overflow-hidden min-[900px]:flex-row">
                {/* Both columns carry a faint fill. Left at /40, right at /20 over
                    the true-black base: without them the split is a single
                    #0A0A0D hairline on #000000, which measures as a rule and
                    reads as nothing — the whole app looks like one flat void with
                    text floating in it. The surfaces are what make the regions
                    legible now that they are no longer outlined. */}
                {/* No z-index on this column. `relative` plus a numeric z makes
                    it a stacking context, which re-bases the tab bar and the log
                    popover INSIDE it — so the popover's z-40 dismiss backdrop
                    could not cover the right column (z-20) and clicking the hub
                    to dismiss the log fired the hub instead, dropping the link. */}
                <section className="relative flex h-[38.2%] min-h-0 flex-col border-b border-slate-900 bg-slate-950/40 min-[900px]:h-full min-[900px]:w-[61.8%] min-[900px]:border-b-0 min-[900px]:border-r">
                    <nav role="tablist" className={`${BAR} z-30`}>
                        <div className="no-scrollbar mr-auto flex h-full min-w-0 flex-1 gap-6 overflow-x-auto overflow-y-hidden">
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
                                    className={`flex h-full shrink-0 items-center whitespace-nowrap border-b-2 text-[10px] font-bold uppercase tracking-widest transition-colors ${
                                        tab === id
                                            ? 'border-blue-400 text-blue-400'
                                            : 'border-transparent text-slate-500 hover:text-slate-300'
                                    }`}
                                >
                                    {labelText}
                                </button>
                            ))}
                        </div>

                        {/* Tools right, fenced with a vertical rule. The comms log
                            is a popover and not a tab: it has to be reachable WHILE
                            doing the thing that is failing, not somewhere you
                            navigate away to. */}
                        <div className="ml-4 flex h-full items-center border-l border-slate-800 pl-4">
                            <LogPopover log={link.log} onClear={link.clearLog} onExport={() => exportLog(link.log)} />
                        </div>
                    </nav>

                    {/* pt-2 pb-2 px-4 is the scroll-content padding from the
                        spacing scale, not a free-hand value. */}
                    <div className="min-h-0 flex-1 overflow-auto px-4 pb-2 pt-2">
                        {tab === 'diagnosis' && <DiagnosisPane link={link} catalog={catalog} />}
                        {tab === 'datalog' && <DatalogPane datalog={datalog} />}
                        {tab === 'calibration' && (
                            <JobTable
                                jobs={catalog?.actuators ?? []}
                                ledger={ledger}
                                ecuId={ecuId}
                                connectedToVehicle={connectedToVehicle}
                            />
                        )}
                        {tab === 'testjobs' && (
                            <JobTable
                                jobs={catalog?.testJobs ?? []}
                                ledger={ledger}
                                ecuId={ecuId}
                                connectedToVehicle={connectedToVehicle}
                            />
                        )}
                    </div>
                </section>

                <aside className="relative z-20 flex min-h-0 flex-1 flex-col overflow-hidden bg-slate-900/20 backdrop-blur-sm min-[900px]:w-[38.2%] min-[900px]:flex-none">
                    <div className={BAR}>
                        <span className="truncate text-[10px] font-bold uppercase tracking-widest text-slate-500">
                            {t.pane_visualization}
                        </span>
                    </div>

                    <div className="relative min-h-[140px] flex-1 overflow-hidden bg-gradient-to-b from-slate-900/10 to-transparent p-4">
                        <Viz tab={tab} link={link} catalog={catalog} datalog={datalog} />
                    </div>

                    {/* Controls take their natural height; the picture above
                        absorbs the slack. The reverse pins the picture and
                        crushes the dial. px-5 pt-4 pb-5 is the control-panel
                        padding from the spacing scale. */}
                    <div className="flex flex-initial flex-col overflow-y-auto px-5 pb-5 pt-4">
                        {/* The status row states WHAT is being addressed on the
                            left and offers its controls on the right — the same
                            shape as the reference app's DME row. Centring a lone
                            chip left the panel with no anchor and no label. */}
                        <div className="flex h-[32px] items-center justify-between px-2">
                            <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                                <Cpu className="size-3" />
                                {t.module}
                            </span>
                            <EcuSelect
                                index={ecuIndex}
                                value={ecuId}
                                lang={lang}
                                // The DS2 address is per module, so switching one
                                // under an open link would silently retarget it.
                                disabled={link.state !== 'disconnected'}
                                onChange={setEcuId}
                            />
                        </div>

                        {/* A failure is reported HERE, in the slot that is
                            already reserved for it, next to the control that
                            caused it — not as a strip between the header and the
                            columns. That strip cost 26px of permanent dead space
                            when empty and shoved the whole workspace down when
                            full; this costs nothing and puts the message where
                            the eye already is. */}
                        <HubNotice text={notice.text} tone={notice.tone} />
                        <HubCluster>
                            <Hub config={hub} />
                        </HubCluster>
                        <SubActions>
                            {/* The two failure kinds need OPPOSITE advice, so
                                only one of these can ever appear: retry is the
                                one action that cannot help an electrical fault,
                                and the checklist is noise for a desync. */}
                            {link.errorKind === 'electrical' ? (
                                <TextButton onClick={() => setFaultOpen(true)} tone="destructive" Icon={AlertTriangle}>
                                    {t.details}
                                </TextButton>
                            ) : (
                                link.error && (
                                    <TextButton onClick={link.clearError} tone="primary" Icon={RotateCcw}>
                                        {t.retry}
                                    </TextButton>
                                )
                            )}
                            {link.state === 'disconnected' ? (
                                <TextButton onClick={() => void link.connect('practice')} tone="secondary" Icon={FlaskConical}>
                                    {t.practice}
                                </TextButton>
                            ) : (
                                <TextButton onClick={() => void link.disconnect()} tone="danger" Icon={Unplug}>
                                    {t.disconnect}
                                </TextButton>
                            )}
                            {tab === 'datalog' && datalog.samples.length > 0 && (
                                <TextButton onClick={datalog.exportCsv} Icon={Download}>
                                    {t.exportCsv}
                                </TextButton>
                            )}
                        </SubActions>
                    </div>
                </aside>
            </main>

            <UnverifiedBanner />

            {faultOpen && <ElectricalFaultDialog message={link.error ?? ''} onClose={() => setFaultOpen(false)} />}
        </div>
    );
}

/**
 * The bar recipe, once. Both columns open with one, at the same height, so
 * their bottom rules form a single line across the split.
 */
const BAR =
    'flex h-[44px] flex-none items-center border-b border-slate-900 bg-slate-900/50 px-4 backdrop-blur-sm';


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
    // Loader2, not the state's own glyph. animate-spin rotates whatever it is
    // given, and PlugZap and Zap both have an obvious "up" — spun end over end
    // they read as a corrupt icon rather than as progress, at the two moments
    // the user most needs to believe the tool is working.
    if (link.state === 'connecting') {
        return { label: t.hub_connecting, Icon: Loader2, tone: 'connecting', disabled: true, spin: true };
    }
    if (link.state === 'busy') {
        return { label: t.hub_reading, Icon: Loader2, tone: 'busy', disabled: true, spin: true };
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
        // Nothing read yet is an EMPTY state, not a zero. Rendering "—" at
        // text-6xl in slate-800 put a barely-visible dash in the middle of a
        // 460px void; the canonical placeholder says what the instrument is
        // waiting for.
        if (n === undefined) return <Awaiting icon={ScanLine} label={t.awaiting_read} />;
        // 22px is the ceiling — the size the reference app uses for its one
        // hub-scale numeric readout. At text-6xl this was a 60px glyph, four
        // times the largest type anywhere else and six times the chrome around
        // it: a car with three faults read as an alarm poster rather than an
        // instrument.
        return (
            <div className="flex h-full flex-col items-center justify-center">
                <div
                    className={`font-mono text-[22px] font-bold leading-none tabular-nums ${
                        n === 0 ? 'text-emerald-400' : 'text-red-400'
                    }`}
                >
                    {n}
                </div>
                <div className="mt-2 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                    {n === 0 ? t.viz_clean : t.viz_faults}
                </div>
            </div>
        );
    }

    if (tab === 'datalog') return <Sparkline datalog={datalog} />;

    const jobs = tab === 'calibration' ? catalog?.actuators : catalog?.testJobs;
    if (!jobs || jobs.length === 0) return <Awaiting icon={ListChecks} label={t.awaiting_catalog} />;

    const mix = { high: 0, medium: 0, low: 0 };
    for (const j of jobs) mix[jobRisk(j.id)]++;
    const total = jobs.length;

    return (
        <div className="flex h-full flex-col justify-center gap-3">
            <div className="flex items-baseline justify-between">
                <span className="text-[9px] font-bold uppercase tracking-widest text-slate-600">{t.riskMix}</span>
                <span className="font-mono text-[10px] text-slate-500">{total}</span>
            </div>
            <div className="flex h-3 overflow-hidden rounded-sm bg-slate-800">
                <div className="bg-red-500/70" style={{ width: `${(mix.high / total) * 100}%` }} />
                <div className="bg-amber-500/70" style={{ width: `${(mix.medium / total) * 100}%` }} />
                <div className="bg-slate-600" style={{ width: `${(mix.low / total) * 100}%` }} />
            </div>
            <div className="grid grid-cols-3 gap-x-2 font-mono">
                <MixCell n={mix.high} label={t.risk_high} tone="text-red-400" />
                <MixCell n={mix.medium} label={t.risk_medium} tone="text-amber-400" />
                <MixCell n={mix.low} label={t.risk_low} tone="text-slate-400" />
            </div>
        </div>
    );
}

function MixCell({ n, label, tone }: { n: number; label: string; tone: string }) {
    return (
        <div className="flex flex-col leading-none">
            <span className="text-[8px] uppercase tracking-wider text-slate-600">{label}</span>
            <span className={`mt-1.5 text-[11px] font-bold tabular-nums ${tone}`}>{n}</span>
        </div>
    );
}

/**
 * The canonical empty state: a dashed ring, a dimmed glyph, and terse mono
 * uppercase copy. Calm and centred — an instrument awaiting input, never an
 * error shout. This is the one placeholder shape; reuse it rather than
 * inventing a per-view em-dash.
 */
function Awaiting({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
    return (
        <div className="flex h-full flex-col items-center justify-center text-slate-700">
            <div className="mb-4 flex size-16 items-center justify-center rounded-full border-2 border-dashed border-slate-800 opacity-50">
                <Icon className="size-6 opacity-50" />
            </div>
            <p className="font-mono text-xs uppercase opacity-50">{label}</p>
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

    if (!points) return <Awaiting icon={Activity} label={t.awaiting_samples} />;

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
                <Well className="mb-4 max-w-[60ch]">
                    <MicroLabel>IDENT</MicroLabel>
                    <p className="mt-1 break-all font-mono text-xs text-slate-300">{link.ident.hex}</p>
                    <p className="mt-1 text-[10px] text-slate-600">{t.ident_note(link.ident.length)}</p>
                </Well>
            )}

            {link.faults === null ? (
                <p className="py-2 font-mono text-xs uppercase text-slate-600">{t.awaiting_read}</p>
            ) : link.faults.length === 0 ? (
                <p className="py-2 text-xs text-emerald-400">{t.faults_none}</p>
            ) : (
                <ul className="divide-y divide-slate-800/50">
                    {link.faults.map((f) => (
                        <li key={`${f.number}-${f.errorCode}`} className="py-3 first:pt-0">
                            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                                <span className="font-mono text-xs text-red-400">{formatErrorCode(f.errorCode)}</span>
                                <Readout label={t.faults_type} value={formatErrorCode(f.errorType)} />
                                <Readout label={t.faults_frequency} value={String(f.frequencyCounter)} />
                                <Readout label={t.faults_logistics} value={String(f.logisticsCounter)} />
                            </div>
                            <div className="mt-2">
                                <MicroLabel>{t.faults_freezeFrames}</MicroLabel>
                            </div>
                            {/* w-auto, not w-full. Stretched to the pane the three
                                columns fly apart — the index at the far left, the
                                counter 800px away at the far right — and the table
                                stops reading as one record. */}
                            <table className="mt-1 w-auto font-mono text-[11px] text-slate-400">
                                <tbody>
                                    {f.environmentSets.map((s, i) => (
                                        <tr key={i}>
                                            <td className="py-0.5 pr-4 text-slate-600">#{i + 1}</td>
                                            <td className="py-0.5 pr-6">
                                                {[s.condition1, s.condition2, s.condition3, s.condition4]
                                                    .map((b) => b.toString(16).padStart(2, '0'))
                                                    .join(' ')}
                                            </td>
                                            <td className="py-0.5 text-right tabular-nums text-slate-500">
                                                {s.counter}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </li>
                    ))}
                </ul>
            )}

            {catalog && (
                <div className="mt-6 border-t border-slate-800/50 pt-4">
                    <MicroLabel>
                        {t.faultRef} ({catalog.faultText.length})
                    </MicroLabel>
                    <p className="mb-2 mt-1 max-w-[60ch] text-[11px] text-slate-600">{t.faultRef_note}</p>
                    {/* Capped. Stretched to a 900px column this was a grey slab
                        the width of the pane, which is the largest object on the
                        screen and says nothing. */}
                    <SearchInput value={query} onChange={setQuery} placeholder={t.search} className="w-full max-w-[420px]" />
                    <ul className="mt-2 divide-y divide-slate-800/50">
                        {hits.map((f, i) => (
                            <li key={i} className="py-1.5 first:pt-0">
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

            <table className="mb-6 w-full font-mono text-xs">
                <tbody className="divide-y divide-slate-800/50">
                    {datalog.selected.map((symbol) => (
                        <tr key={symbol}>
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
        <div className="divide-y divide-slate-800/50 border-t border-slate-800/50">
            {MSS54_LIVE_BLOCKS.map((block) => (
                <details key={block.selection}>
                    <summary className="cursor-pointer py-1.5 text-[11px] uppercase tracking-widest text-slate-400 hover:text-slate-200">
                        <span className="font-mono text-slate-600">{block.selection}</span> {block.name}{' '}
                        <span className="text-slate-600">({block.fields.length})</span>
                    </summary>
                    <div className="max-h-48 overflow-auto pb-2 pl-4">
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
                                {f.unit && <span className="ml-auto text-slate-500">{f.unit}</span>}
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
    // No label inside the chip: the status row it sits in already says MODULE,
    // and printing it twice on one 32px line is the sort of thing that makes a
    // panel look unread.
    return (
        <div className="flex items-center rounded bg-slate-800 px-2 py-0.5">
            <select
                value={value}
                disabled={disabled || index.length === 0}
                onChange={(e) => onChange(e.target.value)}
                className="max-w-52 cursor-pointer bg-transparent text-[10px] font-bold text-blue-400 outline-none disabled:cursor-not-allowed disabled:opacity-60"
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
 *
 * Built as the 26px context bar rather than a tinted panel: it is a standing
 * condition of the whole app, so it reads as chrome, and a permanent banner that
 * shouts stops being read within a day.
 */
function UnverifiedBanner() {
    const { t } = useLang();
    return (
        <footer className="flex h-[26px] flex-none items-center border-t border-slate-900 bg-slate-950/60 px-4">
            <p className="truncate text-[10px] tracking-wide text-amber-400/80">{t.unverified}</p>
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

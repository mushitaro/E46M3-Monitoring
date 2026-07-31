'use client';

import { memo, useCallback, useMemo, useRef, useState } from 'react';
import { MSS54_LIVE_BLOCKS, formatErrorCode, planBlockReads } from '@tsunagi/ds2-mss54';
import { AppHeader } from '@/components/AppHeader';
import { LinkError } from '@/components/LinkError';
import { StatusLed } from '@/components/StatusLed';
import { useDs2Link, type LiveSample } from '@/hooks/useDs2Link';
import { useLang } from '@/lib/i18n';

type Tab = 'diagnosis' | 'datalog' | 'log';

export default function Home() {
    const { t } = useLang();
    const link = useDs2Link();
    const [tab, setTab] = useState<Tab>('diagnosis');

    return (
        <div className="flex h-dvh flex-col overflow-hidden bg-slate-950">
            <AppHeader
                right={
                    <div className="flex items-center gap-4">
                        <StatusLed state={link.state} mode={link.mode} hasError={!!link.error} />
                        <ConnectionControls link={link} />
                    </div>
                }
            />

            {/* Tab bar — 44px, matching the content bars so their rules line up. */}
            <nav
                role="tablist"
                className="flex h-[44px] shrink-0 items-center gap-1 border-b border-slate-900 bg-slate-900/50 px-4 backdrop-blur-sm"
            >
                {(
                    [
                        ['diagnosis', t.tab_diagnosis],
                        ['datalog', t.tab_datalog],
                        ['log', t.tab_log],
                    ] as const
                ).map(([id, label]) => (
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
                        {label}
                    </button>
                ))}
            </nav>

            {/* Reserved slot: a transient error appears INSIDE it, so a failure
                does not reflow the panes below. */}
            <div className="min-h-[0px] shrink-0 px-4">
                {link.error && (
                    <div className="pt-3">
                        <LinkError message={link.error} kind={link.errorKind} onRetry={link.clearError} />
                    </div>
                )}
            </div>

            <main className="flex min-h-0 flex-1 flex-col gap-4 p-4 min-[900px]:flex-row">
                {tab === 'diagnosis' && <DiagnosisView link={link} />}
                {tab === 'datalog' && <DatalogView link={link} />}
                {tab === 'log' && <CommsLogView link={link} />}
            </main>

            <UnverifiedBanner />
        </div>
    );
}

type Link = ReturnType<typeof useDs2Link>;

function ConnectionControls({ link }: { link: Link }) {
    const { t } = useLang();
    const connected = link.state !== 'disconnected' && link.state !== 'connecting';
    const busy = link.state === 'busy' || link.state === 'logging' || link.state === 'connecting';

    if (connected) {
        return (
            <button
                type="button"
                onClick={() => void link.disconnect()}
                disabled={busy}
                className="border border-slate-700 bg-slate-800 px-3 py-1 font-mono text-[11px] uppercase tracking-widest text-slate-300 hover:border-red-500 hover:text-red-400 disabled:opacity-40"
            >
                {t.disconnect}
            </button>
        );
    }

    return (
        <div className="flex items-center gap-2">
            <button
                type="button"
                onClick={() => void link.connect('vehicle')}
                disabled={busy || !link.webSerialSupported}
                title={link.webSerialSupported ? undefined : t.notSupported_body}
                className="border border-blue-600 bg-blue-600/10 px-3 py-1 font-mono text-[11px] uppercase tracking-widest text-blue-400 hover:bg-blue-600/20 disabled:opacity-40"
            >
                {t.connect}
            </button>
            <button
                type="button"
                onClick={() => void link.connect('practice')}
                disabled={busy}
                className="border border-indigo-500/60 bg-indigo-500/10 px-3 py-1 font-mono text-[11px] uppercase tracking-widest text-indigo-400 hover:bg-indigo-500/20 disabled:opacity-40"
            >
                {t.practice}
            </button>
        </div>
    );
}

function Panel({ title, children, className = '' }: { title: string; children: React.ReactNode; className?: string }) {
    return (
        <section className={`flex min-h-0 flex-col border border-slate-800 bg-slate-900 ${className}`}>
            <div className="flex h-[44px] shrink-0 items-center border-b border-slate-800 px-3 text-[11px] font-semibold uppercase tracking-widest text-slate-400">
                {title}
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-3">{children}</div>
        </section>
    );
}

/**
 * A bound on the in-memory run.
 *
 * The old PWA capped at 5000 and dropped the oldest silently, which at its
 * 250 ms interval was ~20 minutes. Here the rate is the round trip, so the cap
 * is stated in samples and the UI shows the count — a run that hits it is
 * visible rather than quietly lossy.
 */
const MAX_SAMPLES = 200_000;
/** Samples reach React at most this often; the loop is never throttled by it. */
const FLUSH_INTERVAL_MS = 500;

/** φ: 61.8 / 38.2. Not 70/30 — the proportion is the system's, not a taste call. */
const PHI_MAIN = 'min-[900px]:basis-[61.8%]';
const PHI_SIDE = 'min-[900px]:basis-[38.2%]';

function DiagnosisView({ link }: { link: Link }) {
    const { t } = useLang();
    const idle = link.state === 'connected';

    return (
        <>
            <Panel title={t.tab_diagnosis} className={`flex-1 ${PHI_MAIN}`}>
                <div className="mb-3 flex flex-wrap gap-2">
                    <ActionButton onClick={() => void link.readIdent()} disabled={!idle}>
                        {t.readIdent}
                    </ActionButton>
                    <ActionButton onClick={() => void link.readFaults()} disabled={!idle}>
                        {t.readFaults}
                    </ActionButton>
                </div>

                {link.faults === null ? (
                    <p className="text-xs text-slate-600">—</p>
                ) : link.faults.length === 0 ? (
                    <p className="text-xs text-emerald-400">{t.faults_none}</p>
                ) : (
                    <>
                        <p className="mb-2 text-xs text-slate-400">{t.faults_count(link.faults.length)}</p>
                        <ul className="space-y-2">
                            {link.faults.map((f) => (
                                <li key={`${f.number}-${f.errorCode}`} className="border border-slate-800 p-2">
                                    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                                        <span className="font-mono text-sm text-red-400">
                                            {formatErrorCode(f.errorCode)}
                                        </span>
                                        <Readout label={t.faults_type} value={formatErrorCode(f.errorType)} />
                                        <Readout label={t.faults_frequency} value={String(f.frequencyCounter)} />
                                        <Readout label={t.faults_logistics} value={String(f.logisticsCounter)} />
                                    </div>
                                    <div className="mt-2">
                                        <div className="text-[10px] uppercase tracking-widest text-slate-600">
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
                                    </div>
                                </li>
                            ))}
                        </ul>
                    </>
                )}
            </Panel>

            <Panel title="IDENT" className={`flex-1 ${PHI_SIDE}`}>
                {link.ident ? (
                    <>
                        <p className="break-all font-mono text-xs text-slate-300">{link.ident.hex}</p>
                        <p className="mt-2 text-[11px] text-slate-600">
                            {link.ident.length} bytes. The field layout of this response is not yet known —
                            EdiabasLib used to decode it. Shown raw rather than guessed at.
                        </p>
                    </>
                ) : (
                    <p className="text-xs text-slate-600">—</p>
                )}
                {link.quickTest && (
                    <div className="mt-4 border-t border-slate-800 pt-3">
                        <Readout label="quicktest" value={formatErrorCode(link.quickTest.status)} />
                        <Readout label="A" value={String(link.quickTest.counterA)} />
                        <Readout label="B" value={String(link.quickTest.counterB)} />
                    </div>
                )}
            </Panel>
        </>
    );
}

function DatalogView({ link }: { link: Link }) {
    const { t } = useLang();
    const [selected, setSelected] = useState<string[]>(['n', 'tmot']);
    const [samples, setSamples] = useState<LiveSample[]>([]);
    const samplesRef = useRef<LiveSample[]>([]);
    const [latest, setLatest] = useState<Record<string, number | null>>({});

    const plan = useMemo(() => planBlockReads(selected), [selected]);
    const logging = link.state === 'logging';

    /**
     * Measured, never assumed. The rate is the round-trip time, so it is a fact
     * about the cable and the ECU, not a setting. Clocked off sample.time rather
     * than Date.now() so it stays honest when the tab is backgrounded.
     */
    const rateHz = useMemo(() => {
        const s = samples.slice(-24);
        if (s.length < 2) return null;
        const span = s[s.length - 1].time - s[0].time;
        return span > 0 ? (s.length - 1) / span : null;
    }, [samples]);

    /**
     * State batching is the caller's problem, not the loop's.
     *
     * Rendering per sample re-renders the 213-row channel picker with it, which
     * measured 1.0 Hz against a simulator that answers instantly — the sample
     * rate became a property of React rather than of the wire, which is exactly
     * the number this view exists to report honestly. Samples accumulate in a
     * ref and reach React at most every 500 ms; the measured rate is still
     * computed from sample.time, so it stays a fact about the link.
     */
    const flushAtRef = useRef(0);
    const onSample = useCallback((sample: LiveSample) => {
        // push, not concat. concat copies the whole array every sample, which is
        // quadratic in the run length — invisible while each exchange cost 30 ms
        // and fatal the moment it did not. It hung the renderer outright.
        const buf = samplesRef.current;
        buf.push(sample);
        if (buf.length > MAX_SAMPLES) buf.splice(0, buf.length - MAX_SAMPLES);

        const now = performance.now();
        if (now - flushAtRef.current < FLUSH_INTERVAL_MS) return;
        flushAtRef.current = now;
        setLatest(sample.values);
        // A fresh array so React sees a change; the copy happens twice a second,
        // not once per sample.
        setSamples(buf.slice());
    }, []);

    const start = useCallback(() => {
        samplesRef.current.length = 0;
        flushAtRef.current = 0;
        setSamples([]);
        // Both endings land here: the stop button and a link failure. A run that
        // dies must not quietly leave the view looking like it is still going.
        link.startLog(selected, onSample, () => {
            setSamples(samplesRef.current.slice());
        });
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

    return (
        <>
            <Panel title={t.tab_datalog} className={`flex-1 ${PHI_MAIN}`}>
                <div className="mb-3 flex flex-wrap items-center gap-2">
                    <ActionButton onClick={logging ? link.stopLog : start} disabled={link.state !== 'connected' && !logging}>
                        {logging ? t.stopLog : t.startLog}
                    </ActionButton>
                    <ActionButton onClick={exportCsv} disabled={samples.length === 0}>
                        {t.exportCsv}
                    </ActionButton>
                    <span className="ml-auto flex gap-4 font-mono text-[11px] text-slate-500">
                        <span>
                            {t.samples} {samples.length}
                        </span>
                        <span>
                            {t.rate} {rateHz ? `${rateHz.toFixed(1)} Hz` : '—'}
                        </span>
                    </span>
                </div>

                {/* The cost model, stated: one round trip per BLOCK, not per channel. */}
                <p className="mb-3 text-[11px] text-slate-500">
                    {t.channels_selected(selected.length, plan.blocks.length)}
                </p>

                <table className="w-full font-mono text-xs">
                    <tbody>
                        {selected.map((symbol) => (
                            <tr key={symbol} className="border-t border-slate-800">
                                <td className="py-1 pr-4 text-slate-400">{symbol}</td>
                                <td className="py-1 text-right text-slate-200">
                                    {latest[symbol] === null || latest[symbol] === undefined
                                        ? '—'
                                        : latest[symbol]!.toFixed(2)}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </Panel>

            <Panel title={t.channels} className={`flex-1 ${PHI_SIDE}`}>
                <ChannelPicker selected={selected} disabled={logging} onToggle={toggle} />
            </Panel>
        </>
    );
}

/**
 * 213 checkboxes. Memoized because it is a sibling of the live readout: without
 * this, every sample flush re-rendered the whole picker, and on a synchronous
 * simulator that starved the poll loop badly enough to report 1.0 Hz — the app
 * measuring itself instead of the link, in the one view whose job is to report
 * the link's real rate.
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
                <div className="space-y-3">
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
                                            className="accent-blue-500"
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

function CommsLogView({ link }: { link: Link }) {
    const { t } = useLang();
    const exportLog = useCallback(() => {
        const text = link.log
            .map((l) => `${new Date(l.t).toISOString()} ${l.kind.toUpperCase().padEnd(5)} ${l.text}`)
            .join('\r\n');
        download(text, 'text/plain', `e46m3-comms-${stamp()}.txt`);
    }, [link.log]);

    return (
        <Panel title={t.tab_log} className="flex-1">
            <div className="mb-3 flex gap-2">
                <ActionButton onClick={exportLog} disabled={link.log.length === 0}>
                    {t.exportLog}
                </ActionButton>
                <ActionButton onClick={link.clearLog} disabled={link.log.length === 0}>
                    {t.clearLog}
                </ActionButton>
            </div>
            <pre className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed">
                {link.log.map((l, i) => (
                    <div
                        key={i}
                        className={
                            l.kind === 'error'
                                ? 'text-red-400'
                                : l.kind === 'warn'
                                  ? 'text-amber-400'
                                  : l.kind === 'tx'
                                    ? 'text-blue-400'
                                    : l.kind === 'rx'
                                      ? 'text-slate-300'
                                      : 'text-slate-500'
                        }
                    >
                        {new Date(l.t).toLocaleTimeString(undefined, { hour12: false })} {l.text}
                    </div>
                ))}
            </pre>
        </Panel>
    );
}

function ActionButton({
    children,
    onClick,
    disabled,
}: {
    children: React.ReactNode;
    onClick: () => void;
    disabled?: boolean;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            className="border border-slate-700 bg-slate-800 px-3 py-1 font-mono text-[11px] uppercase tracking-widest text-slate-300 transition-colors hover:border-blue-500 hover:text-blue-400 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-slate-700 disabled:hover:text-slate-300"
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
 * Permanent, not dismissible. Every number this app can currently display comes
 * from a static scrape of SGBD bytecode or a decompiled catalog, and none of it
 * has been confirmed against a car. Hiding that behind a one-time dialog would
 * make the app's own uncertainty the thing users forget first.
 */
function UnverifiedBanner() {
    const { t } = useLang();
    return (
        <footer className="shrink-0 border-t border-amber-500/30 bg-amber-500/5 px-4 py-1.5">
            <p className="text-[11px] text-amber-400">{t.unverified}</p>
        </footer>
    );
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

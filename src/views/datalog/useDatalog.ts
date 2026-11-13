'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { channelId, planBlockReads, type ChannelId } from '@tsunagi/ds2-mss54';
import type { LiveSample, useDs2Link } from '@/hooks/useDs2Link';
import { datalogCsv, download, stamp } from '@/lib/download';
import type { EcuIndex } from '@tsunagi/monitoring-engine';
import { EMPTY_LEDGER, type Ledger } from '@tsunagi/monitoring-engine';
import { isModuleChannel, moduleChannels, moduleLogData, moduleLogReads, type ModuleChannelInfo } from '@tsunagi/monitoring-engine';
import { useLang } from '@/lib/i18n';

type Link = ReturnType<typeof useDs2Link>;

/** A bound on the in-memory run, stated rather than silent. */
const MAX_SAMPLES = 200_000;
const FLUSH_INTERVAL_MS = 500;

/**
 * The recording, and the file it becomes.
 *
 * This lives in the shell rather than inside the DATALOG view, because the run
 * has to survive the operator switching tabs: the right column keeps drawing the
 * trace, the hub keeps offering STOP (`lib/viewHub`), and a tab change must not
 * be the thing that ends a recording.
 */
export function useDatalog(link: Link, others: { ledger: Ledger; index: EcuIndex | null } = { ledger: EMPTY_LEDGER, index: null }) {
    const { t } = useLang();
    // Read when a run starts and on every sample, never captured at render.
    const othersRef = useRef(others);
    useEffect(() => {
        othersRef.current = others;
    }, [others]);
    /** Other modules' channels DATALOG offers (SMG II's read values), once the module index is here. */
    const [moduleInfos, setModuleInfos] = useState<ModuleChannelInfo[]>([]);
    useEffect(() => {
        const index = others.index;
        if (!index) return;
        let live = true;
        // Every module whose own status-read code ships (operator 2026-11-13: 「全モジュールのデータログ」),
        // one after another so the head unit is not asked for every module at once. SMG II first, as before.
        void (async () => {
            const order = [...index.modules].sort((a, b) => (a.id === 'smg2' ? -1 : b.id === 'smg2' ? 1 : 0));
            const found: ModuleChannelInfo[] = [];
            for (const m of order) {
                if (m.id === 'mss54') continue;
                const d = await moduleLogData(m.id, m.address);
                if (!live) return;
                if (!d) continue;
                found.push(...moduleChannels(m.id, d));
                setModuleInfos([...found]);
            }
        })();
        return () => {
            live = false;
        };
    }, [others.index]);
    const moduleInfo = useCallback((c: string) => moduleInfos.find((i) => i.channel === c) ?? null, [moduleInfos]);
    // Engine speed and coolant temperature, both from block 3 — one round trip.
    // Written as channel ids, not symbols: `n` alone does not say which block,
    // and block 35 carries an `n` too.
    const [selected, setSelectedState] = useState<ChannelId[]>([channelId(3, 'n'), channelId(3, 'tmot')]);
    // The selection as of now, not as of the last render: the assistant chooses channels and starts
    // the recording in two calls that can both land before the page renders between them, and the
    // recording must take the channels just chosen (S10).
    const selectedRef = useRef(selected);
    const setSelected = useCallback((next: ChannelId[] | ((prev: ChannelId[]) => ChannelId[])) => {
        const value = typeof next === 'function' ? next(selectedRef.current) : next;
        selectedRef.current = value;
        setSelectedState(value);
    }, []);
    const [samples, setSamples] = useState<LiveSample[]>([]);
    const [latest, setLatest] = useState<Partial<Record<ChannelId, number | null>>>({});
    const samplesRef = useRef<LiveSample[]>([]);
    const flushAtRef = useRef(0);
    /**
     * The channels the RUN recorded, frozen at start.
     *
     * The CSV used to be written from the live `selected` array, and the picker
     * re-enables the moment a run stops. Deselect a channel afterwards and its
     * column vanished from the file - data that WAS captured, silently dropped;
     * select a new one and an empty column appeared as though it had been
     * recorded. A file has to describe the run that happened, not the state of
     * the UI when someone clicked export.
     */
    const recordedRef = useRef<ChannelId[]>([]);
    const [recorded, setRecorded] = useState<ChannelId[]>([]);

    const plan = useMemo(() => planBlockReads(selected.filter((c) => !isModuleChannel(c))), [selected]);
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

    const start = useCallback(async () => {
        samplesRef.current.length = 0;
        flushAtRef.current = 0;
        setSamples([]);
        // Stale readings from a previous run must not survive into this one's
        // readout while the first sample is still in flight.
        setLatest({});
        const chosen = selectedRef.current;
        recordedRef.current = [...chosen];
        setRecorded([...chosen]);
        // Both endings land in the same place: the stop button and a link
        // failure. A run that dies must not leave the view looking live.
        const end = () => setSamples(samplesRef.current.slice());
        const own = chosen.filter((c) => !isModuleChannel(c));
        const others = chosen.filter((c) => isModuleChannel(c));
        if (others.length === 0) {
            link.startLog(own, onSample, end);
            return;
        }
        // Another module's channels: their reads (catalogue, frame, the SGBD code that reads the
        // answer) are loaded first; a channel none of them can give is left empty, not guessed.
        const addressOf = (m: string) => othersRef.current.index?.modules.find((x) => x.id === m)?.address ?? null;
        await moduleLogReads(others, addressOf).then(({ reads }) =>
            link.startLog(own, onSample, end, { reads, ledger: () => othersRef.current.ledger }),
        );
    }, [link, onSample]);

    const toggle = useCallback(
        (id: ChannelId, on: boolean) => setSelected((prev) => (on ? [...prev, id] : prev.filter((s) => s !== id))),
        [setSelected],
    );

    /** The whole selection at once: the assistant's monitoring_log_channels. */
    const select = useCallback((ids: readonly ChannelId[]) => setSelected([...new Set(ids)]), [setSelected]);
    /** The selection as of now (see selectedRef). */
    const current = useCallback(() => selectedRef.current, []);

    /** The run as it stands — the frozen channels and every sample so far, not the last flush. */
    const snapshot = useCallback(() => ({ recorded: recordedRef.current, samples: samplesRef.current }), []);

    // The column rule lives with the CSV writer in lib/download — see datalogCsv.
    const exportCsv = useCallback(() => {
        download(datalogCsv(recordedRef.current, samplesRef.current), 'text/csv', `e46m3-datalog-${stamp()}.csv`);
        // No dependency on `selected` — that is the whole point. The file
        // describes the run, and the run is over.
    }, []);

    /**
     * The last run as a saved session keeps it: the same CSV the export writes, read from the refs
     * so it is the whole run and not the last flush. Null when nothing was recorded.
     */
    const capture = useCallback((): { channels: string[]; samples: number; csv: string } | null => {
        const samples = samplesRef.current;
        if (samples.length === 0) return null;
        return {
            channels: [...recordedRef.current],
            samples: samples.length,
            csv: datalogCsv(recordedRef.current, samples),
        };
    }, []);

    // The selection has moved away from what the last run recorded, so the file
    // and the on-screen list now describe different things.
    const selectionDrifted =
        recorded.length > 0 &&
        (recorded.length !== selected.length || recorded.some((c, i) => c !== selected[i]));

    return {
        selected,
        /** What the last run actually captured. Empty until one has been started. */
        recorded,
        selectionDrifted,
        samples,
        latest,
        rateHz,
        running,
        start,
        stop: link.stopLog,
        toggle,
        select,
        current,
        snapshot,
        exportCsv,
        capture,
        /** Other modules' channels (SMG II), and one by its id. */
        moduleInfos,
        moduleInfo,
        // The cost model, stated: one round trip per BLOCK, not per channel.
        costNotice: t.channels_selected(selected.length, plan.blocks.length),
    };
}

export type Datalog = ReturnType<typeof useDatalog>;

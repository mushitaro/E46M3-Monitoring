'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { channelId, planBlockReads, type ChannelId } from '@tsunagi/ds2-mss54';
import type { LiveSample, useDs2Link } from '@/hooks/useDs2Link';
import { datalogCsv, download, stamp } from '@/lib/download';
import type { EcuIndex } from '@tsunagi/monitoring-engine';
import { EMPTY_LEDGER, appNow, type Ledger } from '@tsunagi/monitoring-engine';
import { isModuleChannel, moduleChannels, moduleLogData, moduleLogReads, type ModuleChannelInfo } from '@tsunagi/monitoring-engine';
import { GEAR_CHANNEL, PART_S, channelsOf, segmentStats, type DatalogSegment } from '@/lib/datalogRun';
import { useLang } from '@/lib/i18n';

type Link = ReturnType<typeof useDs2Link>;

/** A bound on the in-memory run, stated rather than silent. */
const MAX_SAMPLES = 200_000;
const FLUSH_INTERVAL_MS = 500;
/** The DME's speed block: read beside other modules' values, so their gate knows whether the car moves. */
const SPEED_BLOCK = 19;

/** What a recording (or one ten-minute part of it) is kept as: the CSV EXPORT writes, and its segments. */
export interface DatalogCapture {
    channels: string[];
    samples: number;
    csv: string;
    /** Which ten-minute part of the run, from 1 (journal: a part after the first is an episode of its own). */
    part?: number;
    /** Where the channels changed in it, and the rate each stretch got. */
    segments?: Array<{ from: number; channels: number; blocks: number; rateHz: number | null; why: DatalogSegment['why'] }>;
}

/** A ten-minute part that has closed while the recording goes on, and when it began (`appNow()`). */
export interface DatalogPart {
    at: number;
    capture: DatalogCapture;
}

/** The DME blocks a sample costs for these channels, as the link reads them (link/session `logBlocks`). */
function blocksFor(chosen: readonly ChannelId[]): number {
    const own = chosen.filter((c) => !isModuleChannel(c));
    const planned = planBlockReads(own).blocks;
    const others = own.length !== chosen.length;
    return planned.length + (others && !planned.some((b) => b.selection === SPEED_BLOCK) ? 1 : 0);
}

/**
 * The recording, and the file it becomes.
 *
 * This lives in the shell rather than inside the DATALOG view, because the run
 * has to survive the operator switching tabs: the right column keeps drawing the
 * trace, the hub keeps offering STOP (`lib/viewHub`), and a tab change must not
 * be the thing that ends a recording.
 *
 * One run, in segments (lib/datalogRun): choosing other channels while it records changes what it
 * reads from the next sample on, and the run goes on; every ten minutes it is cut into a part the
 * journal keeps as its own episode.
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
     * The run's segments, the first frozen at start.
     *
     * The CSV used to be written from the live `selected` array, and the picker
     * re-enables the moment a run stops. Deselect a channel afterwards and its
     * column vanished from the file - data that WAS captured, silently dropped;
     * select a new one and an empty column appeared as though it had been
     * recorded. A file has to describe the run that happened, not the state of
     * the UI when someone clicked export — every segment of it.
     */
    const segmentsRef = useRef<DatalogSegment[]>([]);
    const [segments, setSegments] = useState<DatalogSegment[]>([]);
    /** Where the open ten-minute part began: seconds into the run, and `appNow()`. */
    const partRef = useRef({ from: 0, at: 0, part: 1 });
    /** The channels a change asked for while recording, until the link says from which sample. */
    const pendingRef = useRef<ChannelId[] | null>(null);
    const partListeners = useRef(new Set<(p: DatalogPart) => void>());
    /** A recording has been started and has not ended: true from START, before the link's state says so. */
    const runningRef = useRef(false);
    /** The moment the assistant analysed (`monitoring_moment`), seconds into the run: the graph's cursor. */
    const [cursor, setCursor] = useState<number | null>(null);

    const plan = useMemo(() => planBlockReads(selected.filter((c) => !isModuleChannel(c))), [selected]);
    const running = link.state === 'logging';

    const pushSegment = useCallback((s: DatalogSegment) => {
        segmentsRef.current = [...segmentsRef.current, s];
        setSegments(segmentsRef.current);
    }, []);

    /** The run's columns: every segment's channels, and the gear the link reads beside them. */
    const columns = useCallback((): ChannelId[] => {
        const cols = channelsOf(segmentsRef.current);
        return cols.includes(GEAR_CHANNEL) ? cols : [...cols, GEAR_CHANNEL];
    }, []);

    /** These samples and the segments over them, as a capture. */
    const captureOf = useCallback(
        (from: number, to: number, part?: number): DatalogCapture | null => {
            const all = samplesRef.current;
            const own = all.filter((s) => s.time >= from && s.time < to);
            if (own.length === 0) return null;
            const segs = segmentStats(segmentsRef.current, all).filter((s) => s.from < to && (segmentsRef.current.find((x) => x.from > s.from)?.from ?? Infinity) > from);
            const cols = columns();
            return {
                channels: [...cols],
                samples: own.length,
                csv: datalogCsv(cols, own),
                ...(part !== undefined ? { part } : {}),
                segments: segs.map((s) => ({ from: Math.round(s.from * 10) / 10, channels: s.channels.length, blocks: s.blocks, rateHz: s.rateHz, why: s.why })),
            };
        },
        [columns],
    );

    // The rate of the segment that is running: a change of channels changes it.
    const rateHz = useMemo(() => {
        const from = segments[segments.length - 1]?.from ?? 0;
        const s = samples.slice(-24).filter((x) => x.time >= from);
        if (s.length < 2) return null;
        const span = s[s.length - 1].time - s[0].time;
        return span > 0 ? (s.length - 1) / span : null;
    }, [samples, segments]);

    const onSample = useCallback(
        (sample: LiveSample) => {
            // push, not concat: concat copies the whole array every sample, which is
            // quadratic in the run length and hung the renderer once the exchange
            // got fast.
            const buf = samplesRef.current;
            // Ten minutes of this part: it closes and goes to the journal, the run goes on.
            const part = partRef.current;
            if (sample.time - part.from >= PART_S) {
                const closed = captureOf(part.from, sample.time, part.part);
                const last = segmentsRef.current[segmentsRef.current.length - 1];
                const at = appNow();
                partRef.current = { from: sample.time, at, part: part.part + 1 };
                if (last) pushSegment({ ...last, from: sample.time, at, why: 'part', part: part.part + 1 });
                if (closed) partListeners.current.forEach((l) => l({ at: part.at, capture: closed }));
            }
            buf.push(sample);
            if (buf.length > MAX_SAMPLES) buf.splice(0, buf.length - MAX_SAMPLES);
            const now = performance.now();
            if (now - flushAtRef.current < FLUSH_INTERVAL_MS) return;
            flushAtRef.current = now;
            setLatest(sample.values);
            setSamples(buf.slice());
        },
        [captureOf, pushSegment],
    );

    /** Other modules' reads for these channels (catalogue, frame, the SGBD code that reads the answer). */
    const readsFor = useCallback(async (chosen: readonly ChannelId[]) => {
        const others = chosen.filter((c) => isModuleChannel(c));
        if (others.length === 0) return undefined;
        // A channel none of them can give is left empty, not guessed.
        const addressOf = (m: string) => othersRef.current.index?.modules.find((x) => x.id === m)?.address ?? null;
        const { reads } = await moduleLogReads(others, addressOf);
        return { reads, ledger: () => othersRef.current.ledger };
    }, []);

    const start = useCallback(async () => {
        samplesRef.current.length = 0;
        flushAtRef.current = 0;
        setSamples([]);
        setCursor(null);
        // Stale readings from a previous run must not survive into this one's
        // readout while the first sample is still in flight.
        setLatest({});
        const chosen = selectedRef.current;
        const at = appNow();
        partRef.current = { from: 0, at, part: 1 };
        pendingRef.current = null;
        segmentsRef.current = [{ from: 0, at, channels: [...chosen], blocks: blocksFor(chosen), why: 'start', part: 1 }];
        setSegments(segmentsRef.current);
        // Both endings land in the same place: the stop button and a link
        // failure. A run that dies must not leave the view looking live.
        runningRef.current = true;
        const end = () => {
            runningRef.current = false;
            setSamples(samplesRef.current.slice());
        };
        const own = chosen.filter((c) => !isModuleChannel(c));
        const onRetune = ({ time, blocks }: { time: number; blocks: number }) => {
            const next = pendingRef.current ?? selectedRef.current;
            pendingRef.current = null;
            pushSegment({ from: time, at: appNow(), channels: [...next], blocks, why: 'channels', part: partRef.current.part });
        };
        const reads = await readsFor(chosen).catch(() => undefined);
        link.startLog(own, onSample, end, reads, { onRetune });
    }, [link, onSample, readsFor, pushSegment]);

    /**
     * Other channels while the run goes on: from the link's next sample, a segment of the same run.
     * False when nothing is recording, or the link would not take them (nothing of the DME's left).
     */
    const retune = useCallback(
        async (ids: readonly ChannelId[]): Promise<boolean> => {
            if (link.state !== 'logging') return false;
            const chosen = [...new Set(ids)];
            const own = chosen.filter((c) => !isModuleChannel(c));
            const reads = await readsFor(chosen);
            pendingRef.current = chosen;
            const ok = link.retuneLog(own, reads);
            if (!ok) {
                pendingRef.current = null;
                return false;
            }
            setSelected(chosen);
            return true;
        },
        [link, readsFor, setSelected],
    );

    const toggle = useCallback(
        (id: ChannelId, on: boolean) => {
            const next = on ? [...selectedRef.current, id] : selectedRef.current.filter((s) => s !== id);
            // While recording, a change on the screen is a segment of the same run, as the assistant's is.
            if (link.state === 'logging') {
                if (next.length > 0) void retune(next);
                return;
            }
            setSelected(next);
        },
        [link.state, retune, setSelected],
    );

    /** The whole selection at once: the assistant's monitoring_log_channels. */
    const select = useCallback((ids: readonly ChannelId[]) => setSelected([...new Set(ids)]), [setSelected]);
    /** The selection as of now (see selectedRef). */
    const current = useCallback(() => selectedRef.current, []);
    /** Recording, as of now (see runningRef). */
    const isRunning = useCallback(() => runningRef.current, []);

    /**
     * Seconds one DME round trip took in the recording so far (its rate and blocks per sample), for
     * how fast another selection would go; null before anything was recorded on this page.
     */
    const roundTripS = useCallback((): number | null => {
        const stats = segmentStats(segmentsRef.current, samplesRef.current).filter((x) => x.rateHz && x.blocks > 0);
        const last = stats[stats.length - 1];
        return last?.rateHz ? 1 / (last.rateHz * last.blocks) : null;
    }, []);

    /** The run as it stands — every column it recorded, every sample so far (not the last flush), its segments. */
    const snapshot = useCallback(
        () => ({ recorded: channelsOf(segmentsRef.current), columns: columns(), samples: samplesRef.current, segments: segmentsRef.current, startedAt: segmentsRef.current[0]?.at ?? null }),
        [columns],
    );

    // The column rule lives with the CSV writer in lib/download — see datalogCsv.
    const exportCsv = useCallback(() => {
        download(datalogCsv(columns(), samplesRef.current), 'text/csv', `e46m3-datalog-${stamp()}.csv`);
        // No dependency on `selected` — that is the whole point. The file
        // describes the run, and the run is over.
    }, [columns]);

    /**
     * The last run as a saved session keeps it: the same CSV the export writes, read from the refs
     * so it is the whole run and not the last flush. Null when nothing was recorded.
     */
    const capture = useCallback((): DatalogCapture | null => captureOf(-Infinity, Infinity), [captureOf]);

    /** The part of the run not yet handed to the journal (the whole run, under ten minutes), and when it began. */
    const capturePart = useCallback((): DatalogPart | null => {
        const p = partRef.current;
        const c = captureOf(p.from, Infinity, p.part);
        return c ? { at: p.at, capture: c } : null;
    }, [captureOf]);

    /** Told of each ten-minute part as it closes. */
    const onPart = useCallback((listener: (p: DatalogPart) => void) => {
        partListeners.current.add(listener);
        return () => {
            partListeners.current.delete(listener);
        };
    }, []);

    const recorded = useMemo(() => channelsOf(segments), [segments]);
    const lastChannels = segments[segments.length - 1]?.channels ?? [];
    // The selection has moved away from what the last run recorded, so the file
    // and the on-screen list now describe different things.
    const selectionDrifted =
        lastChannels.length > 0 &&
        (lastChannels.length !== selected.length || lastChannels.some((c, i) => c !== selected[i]));

    return {
        selected,
        /** What the last run actually captured, every segment's. Empty until one has been started. */
        recorded,
        segments,
        selectionDrifted,
        samples,
        latest,
        rateHz,
        running,
        start,
        stop: link.stopLog,
        retune,
        toggle,
        select,
        current,
        isRunning,
        roundTripS,
        snapshot,
        exportCsv,
        capture,
        capturePart,
        onPart,
        /** The moment the assistant analysed, seconds into the run; null for none. */
        cursor,
        setCursor,
        /** Other modules' channels (SMG II), and one by its id. */
        moduleInfos,
        moduleInfo,
        // The cost model, stated: one round trip per BLOCK, not per channel.
        costNotice: t.channels_selected(selected.length, plan.blocks.length),
    };
}

export type Datalog = ReturnType<typeof useDatalog>;

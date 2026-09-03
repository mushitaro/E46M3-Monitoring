'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { channelId, planBlockReads, type ChannelId } from '@tsunagi/ds2-mss54';
import type { LiveSample, useDs2Link } from '@/hooks/useDs2Link';
import { download, stamp } from '@/lib/download';
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
export function useDatalog(link: Link) {
    const { t } = useLang();
    // Engine speed and coolant temperature, both from block 3 — one round trip.
    // Written as channel ids, not symbols: `n` alone does not say which block,
    // and block 35 carries an `n` too.
    const [selected, setSelected] = useState<ChannelId[]>([channelId(3, 'n'), channelId(3, 'tmot')]);
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
        // Stale readings from a previous run must not survive into this one's
        // readout while the first sample is still in flight.
        setLatest({});
        recordedRef.current = [...selected];
        setRecorded([...selected]);
        // Both endings land in the same place: the stop button and a link
        // failure. A run that dies must not leave the view looking live.
        link.startLog(selected, onSample, () => setSamples(samplesRef.current.slice()));
    }, [link, onSample, selected]);

    const toggle = useCallback((id: ChannelId, on: boolean) => {
        setSelected((prev) => (on ? [...prev, id] : prev.filter((s) => s !== id)));
    }, []);

    // Headings are channel ids — `3:n`, `35:n` — so a file that read both blocks
    // has two distinct columns instead of one column called `n` holding the
    // last block read. The colon is CSV-safe and the pair is machine-readable.
    const exportCsv = useCallback(() => {
        const rows = [
            ['time_s', ...recordedRef.current].join(','),
            ...samplesRef.current.map((s) =>
                [s.time.toFixed(3), ...recordedRef.current.map((k) => s.values[k] ?? '')].join(','),
            ),
        ];
        download(rows.join('\r\n'), 'text/csv', `e46m3-datalog-${stamp()}.csv`);
        // No dependency on `selected` — that is the whole point. The file
        // describes the run, and the run is over.
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
        exportCsv,
        // The cost model, stated: one round trip per BLOCK, not per channel.
        costNotice: t.channels_selected(selected.length, plan.blocks.length),
    };
}

export type Datalog = ReturnType<typeof useDatalog>;

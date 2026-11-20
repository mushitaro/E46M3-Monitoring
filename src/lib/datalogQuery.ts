/**
 * The DATALOG recording as the assistant reads it, and the channels it may choose.
 *
 * On 2026-11-04 the owner asked, by voice and driving, for the cause of three VANOS faults: "set the
 * datalog items and analyse". The assistant could start a recording but could not choose what it
 * recorded nor read a sample of it, so a whole drive was recorded and nothing could be said about
 * it. These are the two halves it lacked: the MSS54's live channels by name (block and symbol, its
 * name in English and Japanese, unit), and the recording as statistics and a thinned trace.
 *
 * Pure: the facade hands in the selection and the samples.
 */
import { MSS54_CHANNELS, planBlockReads, type ChannelId } from '@tsunagi/ds2-mss54';
import { GEAR_CHANNEL, gearAt, nearestSample } from './datalogRun';

export interface ChannelInfo {
    channel: ChannelId;
    name: string;
    ja: string;
    unit: string;
    block: number;
    blockName: string;
}

const info = (id: ChannelId): ChannelInfo | null => {
    const c = MSS54_CHANNELS.get(id);
    return c ? { channel: id, name: c.field.name, ja: c.field.ja, unit: c.field.unit, block: c.block.selection, blockName: c.block.name } : null;
};

/** Channels whose id, symbol, name (English, Japanese, German) or block name holds every word of the query. */
export function findChannels(query: string, limit = 30): ChannelInfo[] {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const out: ChannelInfo[] = [];
    for (const [id, c] of MSS54_CHANNELS) {
        const f = c.field as { de?: string; sgbdRow?: string };
        const hay = `${id} ${c.field.symbol} ${c.field.name} ${c.field.ja} ${f.de ?? ''} ${f.sgbdRow ?? ''} ${c.block.name} ${c.block.ja}`.toLowerCase();
        if (words.every((w) => hay.includes(w))) {
            const i = info(id);
            if (i) out.push(i);
        }
        if (out.length >= limit) break;
    }
    return out;
}

/**
 * The live channels a catalogue read job stands for. `STATUS_EVANOS1_IST` reads the SGBD's
 * `BETRIEBSWTAB.mw_evanos1_ist`, and the live block that carries the same row is the way to read it:
 * the catalogue job's telegram is not one the app can be sure of, the block's is.
 */
export function channelsForJob(job: string): ChannelInfo[] {
    const row = `.mw_${job.replace(/^STATUS_/i, '').toLowerCase()}`;
    const out: ChannelInfo[] = [];
    for (const [id, c] of MSS54_CHANNELS) {
        const r = (c.field as { sgbdRow?: string }).sgbdRow?.toLowerCase();
        const i = r && r.endsWith(row) ? info(id) : null;
        if (i) out.push(i);
    }
    return out;
}

/** The channels named that the MSS54's live blocks do not have. */
export function unknownChannels(ids: readonly string[]): string[] {
    return ids.filter((id) => !MSS54_CHANNELS.has(id as ChannelId));
}

/** What a selection costs: one round trip per block. */
export function selectionCost(ids: readonly ChannelId[]): { channels: number; blocks: number } {
    return { channels: ids.length, blocks: planBlockReads(ids).blocks.length };
}

interface Sample {
    time: number;
    values: Partial<Record<string, number | null>>;
}

/**
 * A recording, summed up: per channel the count, mean, min and max over the window, and the samples
 * in it thinned evenly to at most `max`. `seconds` takes the last so many seconds; absent, the whole run.
 */
export function datalogSummary(
    recorded: readonly ChannelId[],
    samples: readonly Sample[],
    opts: { channels?: readonly string[]; seconds?: number; max?: number; gear?: boolean } = {},
    /** Another module's channel (`smg2:JOB:RESULT`) by its id: its name and unit (lib/sgbd/logChannels). */
    other: (c: string) => { name: string; ja: string; unit: string | null } | null = () => null,
) {
    const end = samples.length ? samples[samples.length - 1].time : 0;
    const from = opts.seconds !== undefined ? end - opts.seconds : -Infinity;
    const window = samples.filter((s) => s.time >= from);
    const wanted = (opts.channels?.length ? recorded.filter((c) => opts.channels!.includes(c)) : recorded) as ChannelId[];
    const stats = wanted.map((c) => {
        let n = 0;
        let sum = 0;
        let min = Infinity;
        let max = -Infinity;
        for (const s of window) {
            const v = s.values[c];
            if (typeof v !== 'number' || !Number.isFinite(v)) continue;
            n++;
            sum += v;
            min = Math.min(min, v);
            max = Math.max(max, v);
        }
        const i = info(c) ?? other(c);
        const r = (v: number) => Math.round(v * 1000) / 1000;
        return { channel: c, name: i?.name ?? null, ja: i?.ja ?? null, unit: i?.unit ?? null, n, mean: n ? r(sum / n) : null, min: n ? r(min) : null, max: n ? r(max) : null };
    });
    const cap = Math.max(2, opts.max ?? 120);
    const at = window.length <= cap ? window.map((_, k) => k) : thinKeepingPeaks(window, wanted, cap);
    // The gear is read once a second beside the channels: a row carries the DME's last read at most 1.5 s before it.
    const gear = opts.gear === true && !wanted.includes(GEAR_CHANNEL);
    return {
        seconds: window.length ? Math.round((end - window[0].time) * 10) / 10 : 0,
        samples: window.length,
        stats,
        trace: at.map((k) => {
            const s = window[k];
            return {
                t: Math.round(s.time * 100) / 100,
                ...Object.fromEntries(wanted.map((c) => [c, s.values[c] ?? null])),
                ...(gear ? { [GEAR_CHANNEL]: gearAt(window, k)?.value ?? null } : {}),
            };
        }),
    };
}

/** What each channel is, by name and unit: the DME's live channels, and another module's where DATALOG offers it. */
export function describeChannels(
    ids: readonly string[],
    other: (c: string) => { name: string; ja: string; unit: string | null; module?: string } | null = () => null,
) {
    return ids.map((c) => {
        const i = info(c as ChannelId);
        if (i) return { channel: c, name: i.name, ja: i.ja, unit: i.unit, block: i.block };
        const o = other(c);
        return { channel: c, name: o?.name ?? null, ja: o?.ja ?? null, unit: o?.unit ?? null, ...(o?.module ? { module: o.module } : {}) };
    });
}

/** Samples a moment of a recording returns at most; thinned evenly beyond this. */
const MOMENT_SAMPLES = 60;

/**
 * A moment of a DATALOG recording: the samples `windowS` wide around `centre` seconds into the run,
 * thinned, each with the gear the DME calculated as of then, and the one sample nearest the centre —
 * the cursor the screen draws (views/datalog). Null when the window holds no sample.
 */
export function momentOf(samples: readonly Sample[], centre: number, windowS: number, channels: readonly string[] | null) {
    const from = centre - windowS / 2;
    const to = centre + windowS / 2;
    const idx: number[] = [];
    for (let i = 0; i < samples.length; i++) if (samples[i].time >= from && samples[i].time <= to) idx.push(i);
    if (idx.length === 0) return null;
    const near = nearestSample(samples, Math.min(Math.max(centre, samples[idx[0]].time), samples[idx[idx.length - 1]].time)) ?? idx[0];
    const round = (x: number) => Math.round(x * 100) / 100;
    const pick = (i: number) => {
        const v = samples[i].values;
        const values = channels ? Object.fromEntries(channels.filter((c) => c in v).map((c) => [c, v[c] ?? null])) : { ...v };
        return { t: round(samples[i].time), gear: gearAt(samples, i), values };
    };
    const thinned = idx.length <= MOMENT_SAMPLES ? idx : Array.from({ length: MOMENT_SAMPLES }, (_, k) => idx[Math.round((k * (idx.length - 1)) / (MOMENT_SAMPLES - 1))]);
    return {
        window: { from: Math.max(0, Math.round(from * 10) / 10), to: Math.round(to * 10) / 10, centre: Math.round(centre * 10) / 10 },
        cursor: pick(near),
        samples: thinned.map(pick),
    };
}

/**
 * At most `cap` samples of a window, keeping its shape: two thirds spread evenly over time, the rest where
 * each asked channel is lowest and highest in its stretch, and where each target/actual pair (`…_soll` and `…_ist`) is furthest
 * apart. Even thinning stepped over a pull's top when it lasted less than a step, and thinning on the
 * engine speed alone dropped the moment a cam fell furthest behind its target: the assistant then said a
 * smaller lag than the car had (SC13). A trace without its peaks is not the run.
 */
function thinKeepingPeaks(window: readonly Sample[], channels: readonly string[], cap: number): number[] {
    const suffix = (c: string) => c.split(':').pop() ?? c;
    // A quantity by its name, from whichever block this sample read it (a run's segments differ).
    const value = (i: number, name: string): number | null => {
        for (const c of channels) {
            if (suffix(c) !== name) continue;
            const v = window[i].values[c];
            if (typeof v === 'number' && Number.isFinite(v)) return v;
        }
        return null;
    };
    const names = [...new Set(channels.map(suffix))];
    const series: Array<(i: number) => number | null> = names.map((n) => (i: number) => value(i, n));
    for (const n of names) {
        if (!n.endsWith('_soll')) continue;
        const ist = n.replace(/_soll$/, '_ist');
        if (!names.includes(ist)) continue;
        series.push((i) => {
            const a = value(i, n);
            const b = value(i, ist);
            return a === null || b === null ? null : a - b;
        });
    }
    // Two thirds of the budget spread evenly over time, so the trace has no holes; the rest on the peaks.
    const even = Math.max(2, Math.ceil((cap * 2) / 3));
    const keep = new Set<number>();
    for (let k = 0; k < Math.min(even, window.length); k++) keep.add(Math.round((k * (window.length - 1)) / (Math.min(even, window.length) - 1)));
    let room = cap - keep.size;
    const buckets = Math.max(1, Math.floor(room / (2 * Math.max(1, series.length))));
    for (let b = 0; b < buckets && room > 0; b++) {
        const from = Math.floor((b * window.length) / buckets);
        const to = Math.floor(((b + 1) * window.length) / buckets);
        for (const f of series) {
            let lo = -1;
            let hi = -1;
            for (let i = from; i < to; i++) {
                const v = f(i);
                if (v === null) continue;
                if (lo < 0 || (f(lo) as number) > v) lo = i;
                if (hi < 0 || (f(hi) as number) < v) hi = i;
            }
            for (const i of [lo, hi]) {
                if (i < 0 || keep.has(i) || room <= 0) continue;
                keep.add(i);
                room--;
            }
        }
    }
    return [...keep].sort((x, y) => x - y);
}
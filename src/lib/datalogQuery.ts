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
export function datalogSummary(recorded: readonly ChannelId[], samples: readonly Sample[], opts: { channels?: readonly string[]; seconds?: number; max?: number } = {}) {
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
        const i = info(c);
        const r = (v: number) => Math.round(v * 1000) / 1000;
        return { channel: c, name: i?.name ?? null, ja: i?.ja ?? null, unit: i?.unit ?? null, n, mean: n ? r(sum / n) : null, min: n ? r(min) : null, max: n ? r(max) : null };
    });
    const cap = Math.max(2, opts.max ?? 120);
    const thinned = window.length <= cap ? window : Array.from({ length: cap }, (_, k) => window[Math.round((k * (window.length - 1)) / (cap - 1))]);
    return {
        seconds: window.length ? Math.round((end - window[0].time) * 10) / 10 : 0,
        samples: window.length,
        stats,
        trace: thinned.map((s) => ({ t: Math.round(s.time * 100) / 100, ...Object.fromEntries(wanted.map((c) => [c, s.values[c] ?? null])) })),
    };
}

/**
 * A recorded channel as the screen names it: a person's name in the name slot, the identifier beside
 * it, and one spelling of each unit (UX-09, docs/UX-DESIGN.md §3).
 *
 * Channel ids are machine identity — `19:v` (DME block 19, symbol v), `smg2:STATUS_IO_LESEN:STAT_PHYD_WERT`
 * (a module's job and result). They were printed where a name goes: in PROBE's judgements, its
 * comparisons and the bars beside them, and in DATALOG wherever a module's result had no comment. The
 * owner heard 「SMG の油圧」 from the assistant and saw `smg2:STATUS_IO_LESEN:STAT_PHYD_WERT` on the
 * screen. Here every such place asks one function.
 *
 * Where the module's data gives no name, the name is what KIND of value it is (「SMG II の値」), a
 * claim the source supports, and the identifier stays in its own slot — never the raw result name
 * promoted to the name, and never a guessed translation.
 *
 * Pure, so vitest (node) holds it.
 */
import { MSS54_CHANNELS, type ChannelId } from '@tsunagi/ds2-mss54';

/** What the screen needs to know of another module's channel (engine `ModuleChannelInfo`). */
export interface OtherChannel {
    module: string;
    result: string;
    name: string;
    ja: string;
    unit: string | null;
}

export interface ChannelLabel {
    /** A person's name, or the kind of value where none is written. Never an identifier. */
    name: string;
    /** One spelling per unit (rpm, °C), or ''. */
    unit: string;
    /** The identifier, for the ident slot. */
    ident: string;
    /** The module's own data names it (false: `name` is the kind of value only). */
    named: boolean;
}

export interface ChannelWords {
    /** 「SMG II の値」: a module's value with no name in its data. */
    channel_ofModule: (module: string) => string;
    /** A value the app has no name for at all. */
    channel_unnamed: string;
}

/**
 * The units the modules' own SGBDs spell their own way (`Grad C`, `1/min`), in the catalogue's one
 * spelling. Only the spelling changes; a unit not listed here is shown as written.
 */
const UNIT: Record<string, string> = {
    'grad c': '°C',
    gradc: '°C',
    'grad celsius': '°C',
    grad: '°',
    '1/min': 'rpm',
    'u/min': 'rpm',
    upm: 'rpm',
    sek: 's',
    sec: 's',
    volt: 'V',
    'grad/s': '°/s',
    'grad/sek': '°/s',
};

export function normUnit(unit: string | null | undefined): string {
    if (!unit) return '';
    const u = unit.trim();
    return UNIT[u.toLowerCase()] ?? u;
}

/** A module's id as a reader says it, in the ident slot and in 「… の値」. */
const MODULE_SHORT: Record<string, string> = { smg2: 'SMG II', mss54: 'DME', dsc_e46: 'DSC', dsc_mk60: 'DSC' };
export const moduleShort = (module: string): string => MODULE_SHORT[module] ?? module.toUpperCase();

export function channelLabel(
    id: string,
    lang: 'ja' | 'en',
    words: ChannelWords,
    other?: ((id: string) => OtherChannel | null) | null,
    moduleName?: (module: string) => string,
): ChannelLabel {
    const c = MSS54_CHANNELS.get(id as ChannelId);
    if (c) return { name: lang === 'en' ? c.field.name : c.field.ja, unit: normUnit(c.field.unit), ident: id, named: true };
    const m = /^([a-z0-9_]+):([A-Z0-9_]+):([A-Z0-9_]+)$/.exec(id);
    const info = other?.(id) ?? null;
    if (m || info) {
        const mod = info?.module ?? m![1];
        const result = info?.result ?? m![3];
        const text = info ? (lang === 'en' ? info.name : info.ja) : '';
        // The engine falls back to the result's own name when the SGBD wrote no comment: that is an
        // identifier, not a name.
        const named = !!text && text !== result;
        const who = MODULE_SHORT[mod] ?? moduleName?.(mod) ?? mod.toUpperCase();
        return { name: named ? text : words.channel_ofModule(who), unit: normUnit(info?.unit), ident: `${who} · ${result}`, named };
    }
    return { name: words.channel_unnamed, unit: '', ident: id, named: false };
}

/**
 * Channel ids written into a sentence (a plan's purpose or steps, as the assistant wrote them), each
 * replaced by its name — 「19:v と 19:v_asc の差」 reads 「車速（直接入力） と 車速（ASC） の差」. Only ids
 * the app knows are replaced; everything else is left as written.
 */
export function namesInText(text: string, lang: 'ja' | 'en', words: ChannelWords, other?: ((id: string) => OtherChannel | null) | null): string {
    return text.replace(/\b(\d{1,3}:[A-Za-z][A-Za-z0-9_]*|[a-z0-9_]{2,32}:[A-Z0-9_]{2,64}:[A-Z0-9_]{1,64})\b/g, (id) => {
        const l = channelLabel(id, lang, words, other);
        return l.named ? l.name : id;
    });
}

/**
 * Targets and their actuals among a set of channels (`…_soll` and `…_ist` of one block), each pair as
 * [target, actual], every other channel alone — in the order given.
 */
export function pairTargets<T extends string>(channels: readonly T[]): T[][] {
    const out: T[][] = [];
    const used = new Set<T>();
    for (const c of channels) {
        if (used.has(c)) continue;
        const m = /^(.*)_soll$/.exec(c);
        const ist = m ? (`${m[1]}_ist` as T) : null;
        if (ist && channels.includes(ist)) {
            out.push([c, ist]);
            used.add(c).add(ist);
            continue;
        }
        const n = /^(.*)_ist$/.exec(c);
        const soll = n ? (`${n[1]}_soll` as T) : null;
        if (soll && channels.includes(soll)) continue;
        out.push([c]);
        used.add(c);
    }
    return out;
}

/**
 * A target and its actual under one title: what the two names share (吸気VANOS バンク1 目標角 and
 * 吸気VANOS バンク1 実角 → 吸気VANOS バンク1), so neither is cut to tell them apart (UX-05, UX-08). The
 * legend then says only 目標 and 実.
 */
export function pairTitle(a: string, b: string): string {
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    const common = a.slice(0, i).replace(/[\s·:：（(]+$/u, '').trim();
    return common.length >= 2 ? common : a;
}

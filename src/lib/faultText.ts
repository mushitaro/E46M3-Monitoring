/**
 * A fault as the owner reads it (U5): its code in its module's own spelling, its name from the module's
 * own fault-text table (FORTTEXTE) in the reader's language with the SGBD's German beside it, and the
 * conditions its freeze frames recorded, with units a person reads.
 *
 * Shared by DIAGNOSIS (one module and ALL MODULES) and the assistant's answers, so the screen and the
 * assistant name a fault the same way (U3). Nothing here reads a byte the module's own tables do not
 * describe: a code the table lacks has no name, said as such, not a guessed one.
 */
import { hexCode, text as resolveText, type EcuProfile, type HumanName, type LocalisedText, type TextRef, type TextTier } from '@tsunagi/monitoring-engine';
import { normCode } from '@/lib/faultCode';

type Lang = 'ja' | 'en';

/**
 * A unit as a person reads it. The SGBDs write the degree as a word (`Grad C`, `Grad KW`); the owner
 * reads °C and °KW. Anything else is left as the SGBD wrote it.
 */
export function displayUnit(unit: string | null | undefined): string | undefined {
    if (!unit) return undefined;
    const u = unit.trim();
    if (/^Grad\s*C$/i.test(u)) return '°C';
    if (/^Grad\s*KW$/i.test(u)) return '°KW';
    if (/^Grad$/i.test(u)) return '°';
    return u;
}

/** The module's own entry for a code, by its number (`23948` is `0x5D8C`). */
export function catalogFault(profile: EcuProfile | null, code: number | string | null): EcuProfile['faultText'][number] | undefined {
    if (!profile || code === null) return undefined;
    const want = typeof code === 'number' ? code : parseInt(code, 16);
    if (!Number.isFinite(want)) return undefined;
    return profile.faultText.find((f) => parseInt(f.code, 16) === want);
}

/** A code as its module's catalogue spells it (`0x5D8C`, `0x2A`), or plain hex where the catalogue lacks it. */
export function codeText(profile: EcuProfile | null, code: number | null): string {
    if (code === null) return '—';
    return catalogFault(profile, code)?.code ?? hexCode(code);
}

/** A fault's name from its module's own table: the reader's language, and the SGBD's German original. Null: the table has no such code. */
export function faultName(profile: EcuProfile | null, code: number | string | null, lang: Lang): { text: HumanName; original: string } | null {
    const known = catalogFault(profile, code);
    if (!known || !profile) return null;
    const t = resolveText(profile, known.text, lang);
    return t.original || t.text ? t : null;
}

/**
 * Whether a Japanese name from a module's own table still carries the SGBD's German — a
 * half-translation (`Drehzahlfuehler・前左・elektrisch・故障`) or the source left as it was
 * (`Getriebetemperatur`).
 *
 * Where each name came from is recorded now (`untranslatedText`, below); this reads what the
 * generator leaves in the text itself — its shape — the way the repository's own check does
 * (tools/verify_translation_quality.py `has_leftover_german`): a run of three or more Latin letters
 * in mixed case is German left in, unless it is an identifier (all capitals), a hex literal, a
 * quoted value, a K-/I-/D-Bus, or one of the few names and units that check allows. A name with no
 * Japanese at all is the source text. Checked against every fault name the catalogues ship
 * (2026-11-21): the two agree on all 1,531 distinct names, of which 188 carry German.
 *
 * It is one half of what decides the NAME slot (UX-22, docs/UX-DESIGN.md §3; `untranslatedText`): a
 * phrase a person wrote can still carry German. Nothing is translated here; nothing is guessed.
 */
export function hasSourceLeft(ja: string | null | undefined): boolean {
    const t = (ja ?? '').trim();
    if (!t || !JAPANESE.test(t)) return true;
    const quoted = [...t.matchAll(QUOTED)].map((m) => [m.index + 1, m.index + 1 + m[1].length] as const);
    const hex = [...t.matchAll(HEX_LITERAL)].map((m) => m[0]);
    for (const m of t.matchAll(LATIN_RUN)) {
        const w = m[0];
        if (IDENTIFIER.test(w) || KEPT_WORDS.has(w.toUpperCase())) continue;
        if (hex.some((h) => h.includes(w))) continue;
        if (quoted.some(([a, b]) => a <= m.index && m.index + w.length <= b)) continue;
        if (w === 'Bus' && /[KID]-$/.test(t.slice(0, m.index))) continue;
        return true;
    }
    return false;
}

const JAPANESE = /[\u3040-\u30ff\u3400-\u9fff]/;
const LATIN_RUN = /[A-Za-zÄÖÜäöüß]{3,}/g;
const IDENTIFIER = /^[A-Z][A-Z0-9_]*$/;
const HEX_LITERAL = /0[xX][0-9a-fA-F]+/g;
const QUOTED = /['"‘’“”]([^'"‘’“”]{1,40})['"‘’“”]/g;
/** Mixed-case words the repository's check keeps as they are (names, units): the ones the fault tables hold. */
const KEPT_WORDS = new Set(['BOSCH', 'HIGH', 'FETRAWE', 'SPORT', 'SEC', 'MIN', 'MSEC', 'BAR', 'MBAR', 'PPM', 'RPM', 'HZ', 'KMH', 'INK']);

/**
 * The tiers of the generator's translation a person wrote (tools/translate.py `TIERS`): a phrase from
 * the curated tables, or the text being one word of the token dictionary. Not `tokens` — the
 * dictionary's words laid side by side by machine (`frei 15` → `許可15`), which reads as Japanese and
 * may say something the SGBD does not — and not `source`, the German as it was.
 */
const WRITTEN_BY_A_PERSON: ReadonlySet<TextTier> = new Set<TextTier>(['phrase', 'word']);

/**
 * Whether an interned text is NOT a name a person can read as the module's own words, and so stays out
 * of the name slot: its translation was composed word by word by machine or is the German as it was
 * (its recorded `tier`), its tier was never recorded (a catalogue from before: not known, so not
 * shown as known), or German is still in it (`hasSourceLeft`). The ONE rule for the screen and the
 * assistant alike (`untranslated` for a fault), so the two can never disagree.
 */
export function untranslatedText(t: Pick<LocalisedText, 'ja' | 'tier'> | null | undefined): boolean {
    if (!t) return true;
    if (!t.tier || !WRITTEN_BY_A_PERSON.has(t.tier)) return true;
    return hasSourceLeft(t.ja);
}

/**
 * Whether a fault's name from its module's own table stays out of the name slot (`untranslatedText`).
 * False where the table has no such code: that is a fault with no name, not an untranslated one.
 */
export function untranslated(profile: EcuProfile | null, code: number | string | null): boolean {
    const known = catalogFault(profile, code);
    if (!known || !profile) return false;
    const t = profile.texts[known.text];
    return !!t && untranslatedText(t);
}

/**
 * A name for the name slot, from a module's own table: the reader's language where a person wrote it
 * (`text`), null where not (`untranslatedText`), and the SGBD's German always.
 */
export interface FaultLabel {
    text: HumanName | null;
    original: string;
}

/** An interned text as a name: see `FaultLabel`. */
export function textLabel(profile: EcuProfile, ref: TextRef | undefined, lang: Lang): FaultLabel {
    const t = ref === undefined ? undefined : profile.texts[ref];
    if (!t) return { text: null, original: '' };
    if (untranslatedText(t)) return { text: null, original: t.de };
    return { text: resolveText(profile, ref, lang).text, original: t.de };
}

/** A fault's name from its module's own table, for the name slot. Null: the table has no such code. */
export function faultLabel(profile: EcuProfile | null, code: number | string | null, lang: Lang): FaultLabel | null {
    const known = catalogFault(profile, code);
    if (!known || !profile) return null;
    const l = textLabel(profile, known.text, lang);
    return l.text || l.original ? l : null;
}

/** One condition a freeze frame recorded, named and with its unit. */
export interface Condition {
    name: HumanName;
    value: number;
    unit: string | undefined;
}

/**
 * A freeze frame's four bytes as the conditions they record: the fields the fault names
 * (FORTTEXTE `UW_1..UW_4`), each scaled as FUMWELTTEXTE says. Null where the fault names no fields or
 * the profile has no table: the bytes stay the answer.
 */
export function freezeFrameConditions(profile: EcuProfile | null, code: string, bytes: readonly number[], lang: Lang): Array<Condition | null> | null {
    const known = profile?.faultText.find((f) => normCode(f.code) === normCode(code));
    if (!profile || !known?.env) return null;
    const env = new Map((profile.envFields ?? []).map((e) => [normCode(e.code), e]));
    return bytes.map((b, i) => {
        const e = known.env?.[i] ? env.get(normCode(known.env[i])) : undefined;
        if (!e) return null;
        const value = b * (e.scale ?? 1) + (e.add ?? 0);
        return { name: resolveText(profile, e.text, lang).text, value: Number.isInteger(value) ? value : Number(value.toFixed(1)), unit: displayUnit(e.unit) };
    });
}

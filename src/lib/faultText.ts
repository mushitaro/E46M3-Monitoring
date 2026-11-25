/**
 * A fault as the owner reads it (U5): its code in its module's own spelling, its name from the module's
 * own fault-text table (FORTTEXTE) in the reader's language with the SGBD's German beside it, and the
 * conditions its freeze frames recorded, with units a person reads.
 *
 * Shared by DIAGNOSIS (one module and ALL MODULES) and the assistant's answers, so the screen and the
 * assistant name a fault the same way (U3). Nothing here reads a byte the module's own tables do not
 * describe: a code the table lacks has no name, said as such, not a guessed one.
 */
import { hexCode, text as resolveText, type EcuProfile, type HumanName } from '@tsunagi/monitoring-engine';
import { normCode } from './faultCode';

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

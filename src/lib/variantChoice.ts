/**
 * Which of this app's modules answers at an address, for running jobs that drive something there.
 *
 *   - An address the car's IDENT identified (a group rule: 0x12, 0x32, 0x80) as another module rules
 *     this one out (SC10 F01: on a car whose 0x32 is a GS20, SMG II is not offered and nothing of
 *     SMG II's is sent there).
 *   - An address several of this app's modules share with no group rule to tell them apart (0x56:
 *     ASC MK20 on an early car, DSC on a late one) is the owner's to say, once per car, on the screen
 *     (IJ F01). Until then nothing that drives goes there; reads stay as they are (variants: on an M3,
 *     the common frames).
 *
 * The owner's answer is kept on this device per car — by a digest of the VIN's last seven, never the
 * characters themselves (the VIN stays in the scan's own field only, U8) — or under one key while no
 * VIN has been read.
 *
 * Pure apart from the storage it is handed, so vitest (node) holds it.
 */
import type { Fitment, ScanRun } from '@tsunagi/monitoring-engine';

export type VariantState =
    | { state: 'ok' }
    | { state: 'ask'; address: number; hex: string; candidates: { id: string; name: string; nameJa?: string }[] }
    | { state: 'ruledOut'; address: number; hex: string; other: string };

/** The owner's answers: car key → address → module id. */
export type VariantChoices = Record<string, Record<string, string>>;

export const VARIANT_CHOICE_KEY = 'monitoring.variantChoice';

const hex2 = (n: number) => `0x${n.toString(16).toUpperCase().padStart(2, '0')}`;

/** A car's key: a digest of what identifies it, never the characters. */
export function carKey(vinShort: string | null | undefined): string {
    if (!vinShort) return 'car';
    let h = 0x811c9dc5;
    for (const ch of vinShort) {
        h ^= ch.charCodeAt(0);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return `car-${h.toString(16)}`;
}

/** What identified the module at an address on this car: the open link's IDENT, else the last scan's. */
export function identifiedAt(address: number, fitment: Fitment, scan: ScanRun | null): { moduleId: string | null; sgbd: string | null } | null {
    const f = fitment.get(address);
    if (f && (f.moduleId || f.sgbd)) return { moduleId: f.moduleId, sgbd: f.sgbd };
    const v = scan?.results.find((r) => String(r.address).toLowerCase() === hex2(address).toLowerCase() || Number(r.address) === address)?.variant;
    if (v && v.basis === 'identified' && (v.moduleId || v.sgbd)) return { moduleId: v.moduleId, sgbd: v.sgbd };
    return null;
}

export function variantState(input: {
    moduleId: string;
    address: number;
    /** This app's modules at the address, with their names (English, and the screen's Japanese). */
    candidates: { id: string; name: string; nameJa?: string }[];
    /** The address has a group rule: its IDENT decides. */
    hasRule: boolean;
    identified: { moduleId: string | null; sgbd: string | null } | null;
    /** The owner's answer for this car and address, if given. */
    chosen: string | null;
    nameOf: (id: string) => string;
}): VariantState {
    const { moduleId, address, candidates, hasRule, identified, chosen, nameOf } = input;
    const hex = hex2(address);
    if (identified && identified.moduleId !== moduleId) {
        return { state: 'ruledOut', address, hex, other: identified.moduleId ? nameOf(identified.moduleId) : (identified.sgbd ?? '?') };
    }
    if (hasRule || candidates.length < 2) return { state: 'ok' };
    if (chosen === moduleId) return { state: 'ok' };
    if (chosen) return { state: 'ruledOut', address, hex, other: nameOf(chosen) };
    return { state: 'ask', address, hex, candidates };
}

/**
 * Whether the car's year is what decides between an address's modules (0x56: ASC MK20 early, DSC late).
 * Elsewhere (0xF0's board monitors, 0x7F's navigation computers) no IDENT rule tells them apart, and
 * nothing says the year does either.
 */
export function decidedByYear(candidates: readonly { id: string }[]): boolean {
    const ids = new Set(candidates.map((c) => c.id));
    return ids.has('ascmk20') && ids.has('dsc_e46');
}

/** The assistant's sentence for a state that is not ok, or null. */
export function variantRefusal(v: VariantState, moduleName: string): string | null {
    if (v.state === 'ruledOut')
        return `On this car ${v.hex} is ${v.other}, not ${moduleName}: ${moduleName}'s jobs are not run here, and nothing of it is offered. Say so to the owner.`;
    if (v.state === 'ask')
        return `${v.hex} may be ${v.candidates.map((c) => c.name).join(' or ')} (${decidedByYear(v.candidates) ? "the car's year decides, and " : ''}no IDENT rule tells them apart). Nothing that drives is sent there until the owner has said which, once, on the screen (ACTUATOR asks). Reads go on as before.`;
    return null;
}

export function readChoices(storage: Pick<Storage, 'getItem'> | null): VariantChoices {
    try {
        const raw = storage?.getItem(VARIANT_CHOICE_KEY);
        const v = raw ? (JSON.parse(raw) as VariantChoices) : {};
        return v && typeof v === 'object' ? v : {};
    } catch {
        return {};
    }
}

export function withChoice(all: VariantChoices, car: string, address: number, moduleId: string): VariantChoices {
    return { ...all, [car]: { ...(all[car] ?? {}), [hex2(address)]: moduleId } };
}

export function choiceFor(all: VariantChoices, car: string, address: number): string | null {
    return all[car]?.[hex2(address)] ?? null;
}

import { readEcuData } from './ecuData.ts';
import type { PracticeIdent } from './practiceCar.ts';

interface PracticeModel {
    module: string;
    ident: PracticeIdent;
    rpm?: { request: number[]; length: number; offset: number; width: 1 | 2; scale: number };
    fault?: { length: number; code: number; frequency: number; present: { at: number; mask: number } | null };
}

export interface PracticeFleet {
    models: Record<string, PracticeModel>;
    defaultM3Idents: Record<number, PracticeIdent>;
    modules: { address: number; hw: string; reads: { control: number; argument: number; response: number[] }[] }[];
}

let loading: Promise<PracticeFleet | null> | undefined;

/** Private fixture descriptions travel through the same authorized data loader as their decoding tables. */
export function loadPracticeFleet(): Promise<PracticeFleet | null> {
    if (!loading) {
        loading = readEcuData('variants.json').then(async response => {
            if (!response.ok) return null;
            const data = await response.json() as { schema: number; practiceFleet?: PracticeFleet };
            const fleet = data.practiceFleet;
            return data.schema === 1 && fleet?.models && fleet.defaultM3Idents && Array.isArray(fleet.modules) ? fleet : null;
        }).catch(() => null);
        const pending = loading;
        void pending.then(result => { if (!result && loading === pending) loading = undefined; });
    }
    return loading;
}

export function practiceModelFor(fleet: PracticeFleet | null, ident: PracticeIdent | undefined): PracticeModel | undefined {
    if (!fleet || !ident || !('hw' in ident)) return;
    return Object.values(fleet.models).find(model => 'hw' in model.ident &&
        model.ident.hw.toUpperCase() === ident.hw.toUpperCase() && model.ident.diag.toUpperCase() === ident.diag.toUpperCase());
}

export function practiceRpmPayload(model: PracticeModel, rpm: number, data?: Uint8Array): Uint8Array | null {
    const rule = model.rpm;
    if (!rule || !Number.isInteger(rule.length) || rule.length < 1 || rule.length > 255 ||
        !Number.isInteger(rule.offset) || rule.offset < 0 || (rule.width !== 1 && rule.width !== 2) ||
        rule.offset + rule.width > rule.length || !Number.isFinite(rule.scale) || rule.scale <= 0 ||
        !Number.isFinite(rpm)) return null;
    const out = data ?? new Uint8Array(rule.length);
    if (rule.offset + rule.width > out.length) return null;
    const raw = Math.round(rpm / rule.scale);
    if (raw < 0 || raw >= 2 ** (8 * rule.width)) return null;
    if (rule.width === 1) out[rule.offset] = raw;
    else new DataView(out.buffer, out.byteOffset, out.byteLength).setUint16(rule.offset, raw);
    return out;
}

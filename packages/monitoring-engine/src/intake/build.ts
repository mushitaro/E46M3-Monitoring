/**
 * A scan of every module (lib/probe/scan) written as the intake report `e46.intake-check.v1`
 * (./intakeCheck), for the store's E46 /// MAINTENANCE (operator, 2026-11-10).
 *
 * Pure. It reads only what the scan already read: nothing here is sent to the car, and nothing is
 * guessed. Where the scan does not know something, the report says null:
 *
 *   - the odometer: the scan does not read it;
 *   - the VIN: the short one (last seven) is what the scan read from the instrument cluster itself
 *     (`scan.vin`, ../clusterVin; operator, 2026-11-10 A). A whole VIN is taken only from the bytes
 *     the scan read (and anything else the page read in the same episode), by the rule the desk's
 *     redaction masks with (../investigation/redact). On a DS2 E46 the common IDENT and the fault
 *     reads do not carry one, so `vin` is null on a car. Where the cluster's seven and a VIN the bytes
 *     spell disagree, both are null: the report does not pick one;
 *   - an identification field that is not printable text where the DS2 layout puts it;
 *   - a fault's text where the module's table has no row for its code. A module with no decoder of its
 *     own is read where its own SGBD reads its faults (../faultLayouts), unverified on a car; one with no
 *     proved layout keeps only its bytes (`faultRaw`).
 */
import { formatErrorCode, type ErrorMemoryEntry } from '@tsunagi/ds2-mss54';
import { vinsInHex } from '../investigation/redact.ts';
import type { ScanResult, ScanRun } from '../probe/scan.ts';
import { telegramBytes } from '../runGate.ts';
import { isCommonIdent } from '../variants.ts';
import { INTAKE_CHECK_SCHEMA, intakeCheckReport, type IntakeCheckReport, type IntakeFinding, type IntakeIdent, type IntakeModule } from './intakeCheck.ts';

export const PRODUCER_APP = 'E46M3 /// MONITORING';

export interface IntakeInput {
    /** A fresh id for this report (crypto.randomUUID). */
    id: string;
    scan: ScanRun;
    practice: boolean;
    /** The build-id the page carries; `dev` when it carries none. */
    build: string;
    /** Which generated SGBD set the page loaded (the index's generatedAt). */
    sgbdSet: string;
    /** The page had heard the server's time (lib/clock `isAnchored`). */
    clockSet: boolean;
    /** The app's modules: id, SGBD file, name in the reader's language. */
    modules: ReadonlyArray<{ id: string; sgbd: string; name: string }>;
    /** A fault's text from its module's own table, in the reader's language; null where it has none. */
    faultText(moduleId: string, code: string): string | null;
    /** A scan result's reason as a sentence (the gate's keys are words to look up). */
    reasonText(reason: string): string;
    /** Other answers read in the same episode, as hex: where else a VIN may be spelled. */
    alsoRead?: readonly string[];
}

const compact = (hex: string) => hex.replace(/\s+/g, '').toLowerCase();
const iso = (ms: number) => new Date(ms).toISOString();
const sgbdName = (file: string) => file.replace(/\.prg$/i, '').toUpperCase();

/** Printable text in `bytes[from, from+length)`, trimmed; null when any byte is not printable or it is empty. */
function asciiAt(bytes: Uint8Array, from: number, length: number): string | null {
    if (bytes.length < from + length) return null;
    const slice = bytes.subarray(from, from + length);
    if (!slice.every((b) => b >= 0x20 && b < 0x7f)) return null;
    const s = String.fromCharCode(...slice).trim();
    return s.length > 0 ? s : null;
}

/**
 * The fields of a common DS2 IDENT answer (a whole frame: address, length, status, data, checksum),
 * where the group files and the DS2 layout put them (./intakeCheck `intakeIdent`). A refusal or a
 * frame too short for the layout keeps its bytes and no fields.
 */
export function decodeIdent(frameHex: string): IntakeIdent {
    const raw = compact(frameHex);
    const bytes = Uint8Array.from(raw.match(/../g) ?? [], (h) => parseInt(h, 16));
    const positive = bytes.length >= 16 && bytes[2] === 0xa0;
    if (!positive) return { partNo: null, hw: null, sw: null, codingIndex: null, diagIndex: null, layout: null, raw };
    return {
        partNo: asciiAt(bytes, 3, 7),
        hw: asciiAt(bytes, 10, 2),
        sw: null,
        codingIndex: asciiAt(bytes, 12, 2),
        diagIndex: asciiAt(bytes, 14, 2),
        layout: 'ds2-common',
        raw,
    };
}

const isIdentRequest = (request: string) => isCommonIdent(telegramBytes(request) ?? new Uint8Array(0));

function moduleOf(x: ScanResult, input: IntakeInput): IntakeModule {
    const byId = (id: string) => input.modules.find((m) => m.id === id) ?? null;
    const fitted = x.variant?.basis === 'm3-fitment' && x.modules.length === 1 ? x.modules[0] : null;
    const variant = x.variant?.moduleId ?? fitted;
    const sgbd = x.variant?.sgbd ?? (fitted ? sgbdName(byId(fitted)?.sgbd ?? fitted) : null);
    const names = (variant ? [variant] : x.modules).map((id) => byId(id)?.name ?? id);
    const identX = x.exchanges.find((e) => isIdentRequest(e.request) && e.response !== null);
    const faultRaw = x.exchanges.filter((e) => !isIdentRequest(e.request) && e.response !== null).map((e) => compact(e.response as string));
    return {
        address: x.address,
        name: names.length > 0 ? names.join(' / ').slice(0, 80) : null,
        sgbd,
        variant,
        basis: x.variant?.basis ?? null,
        outcome: x.outcome,
        ident: identX ? decodeIdent(identX.response as string) : null,
        faultRaw: faultRaw.slice(0, 8).map((h) => (h.length <= 4096 ? h : '')),
        reason: x.reason ? input.reasonText(x.reason).slice(0, 200) : null,
    };
}

/**
 * Another module's faults, read where its own SGBD reads them (../faultLayouts): its own fault-text
 * table names them, and every one is unverified until a car has answered.
 */
function layoutFindingsOf(x: ScanResult, input: IntakeInput): IntakeFinding[] {
    if (!x.faults) return [];
    const moduleId = x.variant?.moduleId ?? (x.modules.length === 1 ? x.modules[0] : null);
    const from = x.exchanges.find((e) => !isIdentRequest(e.request) && e.response !== null && telegramBytes(e.request)?.[3] === 0x01);
    const raw = from ? compact(from.response as string) : '';
    const seen = new Map<string, number>();
    return x.faults.map((f) => {
        const n = (seen.get(f.code) ?? 0) + 1;
        seen.set(f.code, n);
        return {
            id: `${x.address}:${f.code}${n > 1 ? `#${n}` : ''}`,
            address: x.address,
            code: f.code,
            text: moduleId ? (input.faultText(moduleId, f.code)?.slice(0, 200) ?? null) : null,
            state: f.present === true ? 'present' : f.present === false ? 'stored' : 'unknown',
            count: f.count,
            unverified: true,
            raw: raw.length <= 4096 ? raw : '',
        };
    });
}

/** The MSS54's entries, decoded from the frame whose argument is 01 (the error memory). */
function findingsOf(x: ScanResult, input: IntakeInput): IntakeFinding[] {
    if (!Array.isArray(x.decoded)) return layoutFindingsOf(x, input);
    const from = x.exchanges.find((e) => !isIdentRequest(e.request) && e.response !== null && telegramBytes(e.request)?.[3] === 0x01);
    const raw = from ? compact(from.response as string) : '';
    const seen = new Map<string, number>();
    return (x.decoded as ErrorMemoryEntry[]).map((f) => {
        const code = formatErrorCode(f.errorCode);
        const n = (seen.get(code) ?? 0) + 1;
        seen.set(code, n);
        return {
            id: `${x.address}:${code}${n > 1 ? `#${n}` : ''}`,
            address: x.address,
            code,
            text: input.faultText('mss54', code)?.slice(0, 200) ?? null,
            // The MSS54's record says how often, not whether the fault is present now.
            state: 'unknown',
            count: f.frequencyCounter,
            // The MSS54 decoder is the one this app was built on and has read real cars since.
            unverified: false,
            raw: raw.length <= 4096 ? raw : '',
        };
    });
}

/** The one VIN the bytes spell, full and short; null where none or more than one is spelled. */
function vinOf(hexes: readonly string[]): { vin: string | null; vinShort: string | null } {
    const full = new Set<string>();
    const short = new Set<string>();
    for (const h of hexes) {
        const v = vinsInHex(h);
        v.full.forEach((x) => full.add(x));
        v.short.forEach((x) => short.add(x));
    }
    const vin = full.size === 1 ? [...full][0] : null;
    for (const f of full) if (/^[A-HJ-NPR-Z]{2}\d{5}$/.test(f.slice(-7))) short.add(f.slice(-7));
    return { vin, vinShort: full.size <= 1 && short.size === 1 ? [...short][0] : null };
}

/**
 * The report's VIN fields: the cluster's own read (`scan.vin`) for the short one, the bytes for a
 * whole one, and nothing where they disagree.
 */
function vinFields(scan: ScanRun, spelled: { vin: string | null; vinShort: string | null }): { vin: string | null; vinShort: string | null } {
    const cluster = scan.vin?.vinShort ?? null;
    if (cluster === null) return spelled;
    const agrees = (spelled.vin === null || spelled.vin.slice(-7) === cluster) && (spelled.vinShort === null || spelled.vinShort === cluster);
    return agrees ? { vin: spelled.vin, vinShort: cluster } : { vin: null, vinShort: null };
}

/** The report and its JSON text (the bytes both tabs hash and the saved file holds). Throws if the shape is broken. */
export function buildIntakeCheck(input: IntakeInput): { report: IntakeCheckReport; json: string } {
    const { scan } = input;
    const modules = scan.results.map((x) => moduleOf(x, input));
    const at = (address: string) => modules.find((m) => m.address === address)?.sgbd ?? null;
    const read = [...scan.results.flatMap((x) => x.exchanges.flatMap((e) => (e.response ? [e.response] : []))), ...(input.alsoRead ?? [])];
    const report: IntakeCheckReport = {
        schema: INTAKE_CHECK_SCHEMA,
        id: input.id,
        producer: { app: PRODUCER_APP, build: input.build || 'dev', sgbdSet: input.sgbdSet },
        practice: input.practice,
        profile: { engine: at('0x12'), gearbox: at('0x32') },
        measuredAt: iso(scan.endedAt),
        clock: input.clockSet ? 'server' : 'device',
        scan: { startedAt: iso(scan.startedAt), end: scan.end },
        odometerKm: null,
        ...vinFields(scan, vinOf(read)),
        modules,
        findings: scan.results.flatMap((x) => findingsOf(x, input)).slice(0, 500),
        readings: [],
    };
    const parsed = intakeCheckReport.parse(report);
    return { report: parsed, json: `${JSON.stringify(parsed, null, 2)}\n` };
}

/** SHA-256 of the report's text, as lowercase hex: what both tabs and the store name it by. */
export async function sha256Hex(text: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** The file name the report is saved under when no MAINTENANCE tab takes it. */
export function intakeFileName(report: Pick<IntakeCheckReport, 'measuredAt' | 'practice'>): string {
    const stamp = report.measuredAt.slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
    return `intake-check_${stamp}${report.practice ? '_PRACTICE' : ''}.json`;
}

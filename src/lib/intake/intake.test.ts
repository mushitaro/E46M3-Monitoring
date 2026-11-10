import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Ds2Error, Ds2Status, type Ds2Frame } from '@tsunagi/ds2-core';
import type { ErrorMemoryEntry } from '@tsunagi/ds2-mss54';
import { z } from 'zod';
import { EMPTY_LEDGER } from '../ledger';
import { moduleProtocol } from '../moduleProtocol';
import { M3_IDENTS, NON_M3_IDENTS, PRACTICE_PART_NUMBER, type PracticeIdent } from '../practiceCar';
import { runScan, scanTargets, type ScanRun } from '../probe/scan';
import type { TelegramTable } from '../telegrams';
import { FIXTURE_MODULES, FIXTURE_RULES, identFrame } from '../testing/variantFixture';
import { fittedFrom, type Fitted } from '../variants';
import { buildIntakeCheck, decodeIdent, intakeFileName, sha256Hex, type IntakeInput } from './build';
import { handOff, MAINSTAYS, type HandoffWindow, type MessageLike } from './handoff';
import { INTAKE_CHECK_SCHEMA, INTAKE_HANDOFF_PROTOCOL, intakeCheckReport } from './intakeCheck';

/**
 * The intake report end to end below the screen: a scan of the practice car's modules (the K-line a
 * fake, as in scan.test), the report written from it, and SEND to a MAINTENANCE tab that is a mock
 * — what it answers, and what happens when it is not there.
 */

const VIN = 'WBSBL93060JR12345';
const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0));

const table = (module: string, address: number, fs: string[]): TelegramTable => ({
    module,
    sgbd: module.toUpperCase(),
    address,
    jobs: { FS_LESEN: fs.map((hex) => ({ hex, cmd: 4, cmdName: '', occurrences: 1, confidence: 'shared' as const })) },
});
const PROTOCOLS = [
    moduleProtocol('mss54', 0x12, table('mss54', 0x12, ['12 05 04 00 13', '12 05 04 01 12'])),
    moduleProtocol('smg2', 0x32, table('smg2', 0x32, ['32 05 04 01 32'])),
    moduleProtocol('kombi46', 0x80, table('kombi46', 0x80, ['80 05 04 01 80'])),
];
const ok = (payload: number[]): Ds2Frame => ({ address: 0, length: 0, controlOrStatus: Ds2Status.ACKNOWLEDGE, payload: new Uint8Array(payload), checksum: 0 }) as Ds2Frame;

const ENTRIES = [
    { errorCode: 0x2a, errorType: 0x08, frequencyCounter: 3 },
    { errorCode: 0xd1, errorType: 0x02, frequencyCounter: 1 },
] as unknown as ErrorMemoryEntry[];

/** A scan of the practice car: an M3 (MSS54 + SMG II) by default; KOMBI's answer can carry a VIN. */
async function practiceScan(opts: { idents?: Record<number, PracticeIdent>; kombi?: number[] } = {}): Promise<ScanRun> {
    const idents = opts.idents ?? M3_IDENTS;
    const fitment = new Map<number, Fitted>();
    let t = Date.UTC(2026, 10, 10, 8, 0, 0);
    return runScan(scanTargets(PROTOCOLS), {
        ledger: () => EMPTY_LEDGER,
        identity: {
            rules: FIXTURE_RULES,
            identOk: new Set([0x12, 0x32, 0x80]),
            fitment: () => fitment,
            identify: async (address) => {
                const f = fittedFrom(FIXTURE_RULES, FIXTURE_MODULES, address, identFrame(address, idents[address] ?? { hw: '00', diag: '00' }));
                fitment.set(address, f);
                return f;
            },
        },
        dmeAnswers: async () => true,
        exchange: async (address) => {
            if (address === 0x80) return ok(opts.kombi ?? [0x00]);
            if (address === 0x32) return ok([0x00]);
            if (address === 0x12) return ok([0x02, 0x2a, 0x08, 0x03]);
            throw new Ds2Error('READ_TIMEOUT', 'no answer', { kind: 'timeout' });
        },
        decode: () => ENTRIES,
        stopped: () => false,
        pause: async () => {},
        now: () => (t += 1000),
    });
}

const input = (scan: ScanRun, over: Partial<IntakeInput> = {}): IntakeInput => ({
    id: '6c2b1d0e-1f43-4c1a-9a51-8b2f0d4e7a10',
    scan,
    practice: true,
    build: '150.abc1234',
    sgbdSet: 'ecu-data@2026-11-10T01:00:37+00:00',
    clockSet: true,
    modules: [
        { id: 'mss54', sgbd: 'MSS54DS0.prg', name: 'エンジン（MSS54）' },
        { id: 'smg2', sgbd: 'SMG2.prg', name: 'SMG II' },
        { id: 'kombi46', sgbd: 'KOMBI46.prg', name: 'メーター' },
    ],
    faultText: (_m, code) => (code === formatted(0x2a) ? '吸気温センサー' : null),
    reasonText: (r) => r,
    ...over,
});
const formatted = (n: number) => `0x${n.toString(16).toUpperCase().padStart(2, '0')}`;

describe('the IDENT, read where the group files read it', () => {
    it('takes the part number, hardware number, coding and diagnosis index from a positive answer', () => {
        const id = decodeIdent(Buffer.from(identFrame(0x12, M3_IDENTS[0x12])).toString('hex'));
        expect(id).toMatchObject({ partNo: PRACTICE_PART_NUMBER, hw: '1B', codingIndex: '00', diagIndex: '90', sw: null, layout: 'ds2-common' });
    });

    it('keeps the bytes of a refusal and reads nothing into them', () => {
        const id = decodeIdent(Buffer.from(identFrame(0x12, M3_IDENTS[0x12], 0xa2)).toString('hex'));
        expect(id).toMatchObject({ partNo: null, hw: null, layout: null });
        expect(id.raw).toMatch(/^12[0-9a-f]+$/);
    });
});

describe('the intake report from a scan of the practice car', () => {
    it('has every address, its variant and IDENT, and the MSS54’s faults with their text', async () => {
        const { report, json } = buildIntakeCheck(input(await practiceScan()));
        expect(report.schema).toBe(INTAKE_CHECK_SCHEMA);
        expect(report.profile).toEqual({ engine: 'MSS54DS0', gearbox: 'SMG2' });
        expect(report.modules.map((m) => [m.address, m.outcome, m.sgbd, m.variant])).toEqual([
            ['0x12', 'answered', 'MSS54DS0', 'mss54'],
            ['0x32', 'answered', 'SMG2', 'smg2'],
            ['0x80', 'answered', 'KOMBI46', 'kombi46'],
        ]);
        expect(report.modules[0].ident?.partNo).toBe(PRACTICE_PART_NUMBER);
        // KOMBI on an M3 keeps the fitment without an IDENT: no identification to report.
        expect(report.modules[2]).toMatchObject({ basis: 'm3-fitment', ident: null, faultRaw: ['00'] });
        expect(report.findings).toEqual([
            expect.objectContaining({ id: '0x12:0x2A', code: '0x2A', text: '吸気温センサー', count: 3, state: 'unknown', unverified: false, raw: '022a0803' }),
            expect.objectContaining({ id: '0x12:0xD1', text: null, count: 1 }),
        ]);
        expect(report.odometerKm).toBeNull();
        expect(report.practice).toBe(true);
        // The text both tabs hash is the text that parses back to the report.
        expect(intakeCheckReport.parse(JSON.parse(json))).toEqual(report);
        expect(intakeFileName(report)).toMatch(/^intake-check_20261110-\d{4}_PRACTICE\.json$/);
    });

    it('a non-M3 (MS43, GS20): the variants the IDENT chose, no MSS54 faults, nothing guessed', async () => {
        const { report } = buildIntakeCheck(input(await practiceScan({ idents: NON_M3_IDENTS })));
        expect(report.profile).toEqual({ engine: 'MS430DS0', gearbox: 'GS20' });
        expect(report.modules.find((m) => m.address === '0x12')).toMatchObject({ outcome: 'identified', sgbd: 'MS430DS0', variant: null, faultRaw: [] });
        expect(report.findings).toEqual([]);
    });

    it('takes the VIN only from bytes the scan read, and only when one is spelled', async () => {
        expect(buildIntakeCheck(input(await practiceScan())).report).toMatchObject({ vin: null, vinShort: null });
        const withVin = buildIntakeCheck(input(await practiceScan({ kombi: [0x01, ...ascii(VIN), 0x00] }))).report;
        expect(withVin).toMatchObject({ vin: VIN, vinShort: 'JR12345' });
        const two = buildIntakeCheck(input(await practiceScan({ kombi: [...ascii(VIN), 0x00, ...ascii('WBSBL93060JR99999')] }))).report;
        expect(two).toMatchObject({ vin: null, vinShort: null });
    });

    it('takes the VIN’s last seven from the cluster’s own read in the scan (KOMBI, AIF block 2)', async () => {
        const cluster = (vinShort: string | null): ScanRun['vin'] => ({ address: '0x80', moduleId: 'kombi46r', job: 'STATUS_AIF_FG_NR_LESEN', outcome: 'answered', vinShort });
        const scan = await practiceScan();
        const fromCluster = buildIntakeCheck(input({ ...scan, vin: cluster('JR12345') }));
        // The cluster keeps the last seven only: the seventeen stay unknown, not guessed.
        expect(fromCluster.report).toMatchObject({ vin: null, vinShort: 'JR12345' });
        expect(fromCluster.vinSource).toBe('cluster');
        expect(intakeCheckReport.parse(JSON.parse(fromCluster.json))).toEqual(fromCluster.report);

        // An answer spelling the whole VIN that ends the same: both, from the two.
        const agree = buildIntakeCheck(input({ ...(await practiceScan({ kombi: [0x01, ...ascii(VIN), 0x00] })), vin: cluster('JR12345') }));
        expect(agree.report).toMatchObject({ vin: VIN, vinShort: 'JR12345' });

        // Two sources that disagree: none, so the store does not match the car by a wrong one.
        const disagree = buildIntakeCheck(input({ ...(await practiceScan({ kombi: [0x01, ...ascii(VIN), 0x00] })), vin: cluster('JR99999') }));
        expect(disagree.report).toMatchObject({ vin: null, vinShort: null });
        expect(disagree.vinSource).toBe('conflict');

        // A cluster read that held no short VIN says nothing; neither does a scan without one.
        expect(buildIntakeCheck(input({ ...scan, vin: cluster(null) }))).toMatchObject({ report: { vin: null, vinShort: null }, vinSource: null });
        expect(buildIntakeCheck(input(scan)).vinSource).toBeNull();
        expect(buildIntakeCheck(input(await practiceScan({ kombi: [0x01, ...ascii(VIN), 0x00] }))).vinSource).toBe('bytes');
    });

    it('says whose clock the time is on', async () => {
        expect(buildIntakeCheck(input(await practiceScan(), { clockSet: false })).report.clock).toBe('device');
    });
});

/** The store's MAINTENANCE tab, as a mock: answers `hello` with `ready`, then the report as told. */
function maintenanceTab(answer: 'received' | 'refused' | 'silent' | 'not-ready', origin = MAINSTAYS[0].origin) {
    const listeners = new Set<(e: MessageLike) => void>();
    const got: Array<{ message: Record<string, unknown>; targetOrigin: string }> = [];
    const opener = {
        postMessage(message: unknown, targetOrigin: string) {
            got.push({ message: message as Record<string, unknown>, targetOrigin });
            // A browser delivers only to the window whose origin is targetOrigin.
            if (targetOrigin !== origin) return;
            const m = message as { type: string; nonce: string; sha256?: string; json?: string };
            const reply = (data: unknown) => queueMicrotask(() => listeners.forEach((l) => l({ origin, source: opener, data })));
            if (m.type === 'hello' && answer !== 'not-ready') reply({ protocol: INTAKE_HANDOFF_PROTOCOL, type: 'ready', nonce: m.nonce, accepts: [INTAKE_CHECK_SCHEMA], ref: 'car-42' });
            if (m.type === 'report' && answer === 'received') reply({ protocol: INTAKE_HANDOFF_PROTOCOL, type: 'received', nonce: m.nonce, sha256: m.sha256 });
            if (m.type === 'report' && answer === 'refused') reply({ protocol: INTAKE_HANDOFF_PROTOCOL, type: 'refused', nonce: m.nonce, reason: 'vin-mismatch' });
        },
    };
    const win: HandoffWindow = {
        opener,
        addEventListener: (_t, l) => listeners.add(l),
        removeEventListener: (_t, l) => listeners.delete(l),
    };
    return { win, got, listeners, opener };
}

const NONCE = 'nonce0123456789abcdef';
const fast = { nonce: NONCE, readyMs: 30, receivedMs: 30 };

describe('SEND: scan → report → the MAINTENANCE tab (a mock)', () => {
    it('hands the report over after ready, to the registered origin only, and hears it received', async () => {
        const { json } = buildIntakeCheck(input(await practiceScan()));
        const sha = await sha256Hex(json);
        const tab = maintenanceTab('received');
        const out = await handOff(tab.win, json, sha, fast);
        expect(out).toEqual({ kind: 'received', mainstay: MAINSTAYS[0], sha256: sha });
        expect(tab.got.map((g) => [g.message.type, g.targetOrigin])).toEqual([
            ['hello', MAINSTAYS[0].origin],
            ['report', MAINSTAYS[0].origin],
        ]);
        // The report is the exact text hashed, with MAINTENANCE's ref echoed back.
        expect(tab.got[1].message).toMatchObject({ json, sha256: sha, ref: 'car-42', nonce: NONCE });
        expect(tab.listeners.size).toBe(0);
    });

    it('relays a refusal (the VIN does not match) as the store said it', async () => {
        const out = await handOff(maintenanceTab('refused').win, '{}', 'a'.repeat(64), fast);
        expect(out).toMatchObject({ kind: 'refused', reason: 'vin-mismatch' });
    });

    it('no opener, or no ready: no tab — the caller saves the file', async () => {
        const none: HandoffWindow = { opener: null, addEventListener: () => {}, removeEventListener: () => {} };
        expect(await handOff(none, '{}', 'a'.repeat(64), fast)).toEqual({ kind: 'no-tab' });
        expect(await handOff(maintenanceTab('not-ready').win, '{}', 'a'.repeat(64), fast)).toEqual({ kind: 'no-tab' });
        // An opener on another origin never hears the hello, so it never sees the report either.
        const elsewhere = maintenanceTab('received', 'https://example.com');
        expect(await handOff(elsewhere.win, '{}', 'a'.repeat(64), fast)).toEqual({ kind: 'no-tab' });
        expect(elsewhere.got.some((g) => g.message.type === 'report')).toBe(false);
    });

    it('ready and then silence: no answer', async () => {
        expect(await handOff(maintenanceTab('silent').win, '{}', 'a'.repeat(64), fast)).toMatchObject({ kind: 'no-answer' });
    });

    it('ignores a message from another window, another origin, or another SEND', async () => {
        const tab = maintenanceTab('silent');
        const p = handOff(tab.win, '{}', 'a'.repeat(64), fast);
        const fake = (e: Partial<MessageLike>) => tab.listeners.forEach((l) => l({ origin: MAINSTAYS[0].origin, source: tab.opener, data: null, ...e }));
        await Promise.resolve();
        await new Promise((r) => setTimeout(r, 5));
        const received = { protocol: INTAKE_HANDOFF_PROTOCOL, type: 'received', nonce: NONCE, sha256: 'a'.repeat(64) };
        fake({ source: {}, data: received });
        fake({ origin: 'https://evil.example', data: received });
        fake({ data: { ...received, nonce: 'another-nonce-0123456' } });
        fake({ data: { ...received, sha256: 'b'.repeat(64) } });
        expect(await p).toMatchObject({ kind: 'no-answer' });
    });
});

describe('the schema, one file for both tools', () => {
    it('imports nothing but zod, so MAINTENANCE can keep the same bytes', () => {
        const src = readFileSync(join(__dirname, 'intakeCheck.ts'), 'utf-8');
        expect([...src.matchAll(/^import .* from '([^']+)';$/gm)].map((m) => m[1])).toEqual(['zod']);
    });

    it('the JSON Schema in docs/schemas is the one zod gives (scripts/gen-intake-schema.mjs writes it)', () => {
        const file = join(__dirname, '..', '..', '..', 'docs', 'schemas', `${INTAKE_CHECK_SCHEMA}.schema.json`);
        expect(JSON.parse(readFileSync(file, 'utf-8'))).toEqual(z.toJSONSchema(intakeCheckReport));
    });
});

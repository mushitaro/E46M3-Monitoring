import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Ds2Error, Ds2Status, type Ds2Frame } from '@tsunagi/ds2-core';
import type { ErrorMemoryEntry } from '@tsunagi/ds2-mss54';
import { z } from 'zod';
import { EMPTY_LEDGER } from '../ledger.ts';
import { moduleProtocol } from '../moduleProtocol.ts';
import { M3_IDENTS, NON_M3_IDENTS, PRACTICE_PART_NUMBER, type PracticeIdent } from '../practiceCar.ts';
import { runScan, scanTargets, type ScanRun } from '../probe/scan.ts';
import type { TelegramTable } from '../telegrams.ts';
import { FIXTURE_MODULES, FIXTURE_RULES, identFrame } from '../testing/variantFixture.ts';
import { fittedFrom, type Fitted } from '../variants.ts';
import { buildIntakeCheck, decodeIdent, intakeFileName, sha256Hex, type IntakeInput } from './build.ts';
import { INTAKE_CHECK_SCHEMA, intakeCheckReport } from './intakeCheck.ts';

/**
 * The intake report end to end below the screen: a scan of the practice car's modules (the K-line a
 * fake, as in scan.test) and the report written from it. Handing it to MAINTENANCE is the screen's
 * (the SEND of E46M3 /// MONITORING, or GREN BLUE SUITE's own); this is the engine's half.
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

    it('takes the short VIN from the cluster’s own read (scan.vin), and nothing where the bytes disagree', async () => {
        const cluster = (vinShort: string | null) => ({ address: '0x80', moduleId: 'kombi46r', job: 'STATUS_AIF_FG_NR_LESEN', outcome: 'answered' as const, vinShort });
        const scan = await practiceScan();
        expect(buildIntakeCheck(input({ ...scan, vin: cluster('JR12345') })).report).toMatchObject({ vin: null, vinShort: 'JR12345' });
        // Read but unreadable: nothing to report, and nothing guessed.
        expect(buildIntakeCheck(input({ ...scan, vin: cluster(null) })).report).toMatchObject({ vin: null, vinShort: null });
        // The bytes spell the same VIN: both kept.
        const same = await practiceScan({ kombi: [0x01, ...ascii(VIN), 0x00] });
        expect(buildIntakeCheck(input({ ...same, vin: cluster('JR12345') })).report).toMatchObject({ vin: VIN, vinShort: 'JR12345' });
        // The bytes spell another car's: the report does not choose.
        expect(buildIntakeCheck(input({ ...same, vin: cluster('JR99999') })).report).toMatchObject({ vin: null, vinShort: null });
    });

    it('names the report by the SHA-256 of its exact text', async () => {
        const { json } = buildIntakeCheck(input(await practiceScan()));
        const sha = await sha256Hex(json);
        expect(sha).toMatch(/^[0-9a-f]{64}$/);
        expect(await sha256Hex(json)).toBe(sha);
        expect(await sha256Hex(`${json} `)).not.toBe(sha);
    });

    it('names the app that wrote it: E46M3 /// MONITORING unless another app says its own name', async () => {
        const scan = await practiceScan();
        expect(buildIntakeCheck(input(scan)).report.producer).toMatchObject({ app: 'E46M3 /// MONITORING', build: '150.abc1234' });
        const suite = buildIntakeCheck(input(scan, { producer: { app: 'GREN BLUE SUITE', version: '2026.11.11' } })).report;
        expect(suite.producer).toEqual({ app: 'GREN BLUE SUITE', build: '2026.11.11', sgbdSet: 'ecu-data@2026-11-10T01:00:37+00:00' });
        expect(buildIntakeCheck(input(scan, { producer: { app: 'GREN BLUE SUITE' } })).report.producer.build).toBe('150.abc1234');
        expect(buildIntakeCheck(input(scan, { build: undefined })).report.producer.build).toBe('dev');
    });

    it('says whose clock the time is on', async () => {
        expect(buildIntakeCheck(input(await practiceScan(), { clockSet: false })).report.clock).toBe('device');
    });
});

describe('the schema, one file for both tools', () => {
    it('imports nothing but zod, so MAINTENANCE can keep the same bytes', () => {
        const src = readFileSync(join(__dirname, 'intakeCheck.ts'), 'utf-8');
        expect([...src.matchAll(/^import .* from '([^']+)';$/gm)].map((m) => m[1])).toEqual(['zod']);
    });

    it('the JSON Schema in docs/schemas is the one zod gives (scripts/gen-intake-schema.mjs writes it)', () => {
        const file = join(__dirname, '..', '..', '..', '..', 'docs', 'schemas', `${INTAKE_CHECK_SCHEMA}.schema.json`);
        expect(JSON.parse(readFileSync(file, 'utf-8'))).toEqual(z.toJSONSchema(intakeCheckReport));
    });
});

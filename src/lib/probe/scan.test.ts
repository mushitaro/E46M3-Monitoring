import { describe, expect, it } from 'vitest';
import { Ds2Error, Ds2Status, type Ds2Frame } from '@tsunagi/ds2-core';
import { EMPTY_LEDGER, type Ledger } from '../ledger';
import { moduleProtocol } from '../moduleProtocol';
import type { TelegramTable } from '../telegrams';
import type { Motion } from '../vehicleState';
import { KWP_NOT_PARKED, runScan, scanTargets, type ScanDeps } from './scan';

/**
 * The all-module scan: which frames each address may be sent, and what it does when the car moves,
 * a module is absent or refuses, or the gate has withdrawn a read. The K-line is a fake here — the
 * frames that went out are the evidence, and the scan's promises are about them.
 */

const table = (module: string, address: number, fs: string[]): TelegramTable => ({
    module,
    sgbd: module.toUpperCase(),
    address,
    jobs: { FS_LESEN: fs.map((hex) => ({ hex, cmd: 4, cmdName: '', occurrences: 1, confidence: 'shared' as const })) },
});

/** DSC_MK60's FS_LESEN: $18 02 FF FF to KWP target 0x29, on wire address 0xB8. */
const MK60_FS = 'b8 29 f1 04 18 02 ff ff 7e';

const P = {
    mss54: moduleProtocol('mss54', 0x12, table('mss54', 0x12, ['12 05 04 00 13', '12 05 04 01 12'])),
    ascmk20: moduleProtocol('ascmk20', 0x56, table('ascmk20', 0x56, ['56 05 04 01 56'])),
    dsc: moduleProtocol('dsc_e46', 0x56, table('dsc_e46', 0x56, ['56 05 04 01 56'])),
    mfl: moduleProtocol('mfl', 0x50, table('mfl', 0x50, ['50 05 04 01 50'])),
    mfl2: moduleProtocol('mfl2', 0x50, null),
    kombi: moduleProtocol('kombi46', 0x80, table('kombi46', 0x80, ['80 05 04 01 80'])),
    mk60: moduleProtocol('dsc_mk60', 0xb8, { ...table('dsc_mk60', 0xb8, [MK60_FS]), framing: 'kwp-ds2' }),
};

const ok = (payload: number[]): Ds2Frame => ({ address: 0, length: 0, controlOrStatus: Ds2Status.ACKNOWLEDGE, payload: new Uint8Array(payload), checksum: 0 }) as Ds2Frame;
const no = (): Ds2Frame => ({ address: 0, length: 0, controlOrStatus: Ds2Status.REJECTED, payload: new Uint8Array(0), checksum: 0 }) as Ds2Frame;

function deps(opts: { answers?: Record<number, 'ok' | 'silent' | 'rejected'>; motions?: Motion[]; ledger?: Ledger; kwp?: 'ok' | 'silent' | 'rejected' | 'held' | 'odd' } = {}) {
    const sent: string[] = [];
    const motions = [...(opts.motions ?? [])];
    let measured = 0;
    const d: ScanDeps = {
        ledger: () => opts.ledger ?? EMPTY_LEDGER,
        measure: async () => {
            measured++;
            return motions.shift() ?? 'parked';
        },
        exchange: async (address, _m, _j, f) => {
            sent.push(f.hex);
            const a = opts.answers?.[address] ?? 'ok';
            if (a === 'silent') throw new Ds2Error('READ_TIMEOUT', 'no answer', { kind: 'timeout' });
            return a === 'rejected' ? no() : ok([0x01, 0x02]);
        },
        kwpExchange: async (_m, _j, f) => {
            sent.push(f.hex);
            if (opts.kwp === 'silent') throw new Ds2Error('READ_TIMEOUT', 'no answer', { kind: 'timeout' });
            if (opts.kwp === 'rejected') throw new Ds2Error('NEGATIVE_RESPONSE', 'refused service 0x18', { kind: 'refused' });
            if (opts.kwp === 'held') throw new Error('The car is not measured stationary; nothing is sent.');
            // $58, one code 0x5d90 with status 0x24 — or bytes that are not that shape.
            return { data: new Uint8Array(opts.kwp === 'odd' ? [0x58, 0x02, 0x5d] : [0x58, 0x01, 0x5d, 0x90, 0x24]) };
        },
        decode: (_t, frames) => ({ entries: frames.length }),
        stopped: () => false,
        pause: async () => {},
        now: () => 0,
    };
    return { d, sent, measuredCount: () => measured };
}

describe('scan targets', () => {
    it('sends a shared address only the frames every candidate carries', () => {
        const ts = scanTargets([P.kombi, P.ascmk20, P.dsc, P.mss54]);
        expect(ts[0].modules).toEqual(['mss54']); // the decoded one first
        expect(ts[0].decoder).toBe('mss54');
        const dsc = ts.find((t) => t.address === 0x56)!;
        expect(dsc.modules).toEqual(['ascmk20', 'dsc_e46']);
        expect(dsc.frames.map((f) => f.hex)).toEqual(['56 05 04 01 56']);
        expect(dsc.decoder).toBeNull();
    });

    it('asks nothing of an address whose candidates share no frame', () => {
        const [mfl] = scanTargets([P.mfl, P.mfl2]);
        expect(mfl.frames).toEqual([]);
    });
});

describe('scan run', () => {
    it('reads every address on a car measured stationary, and decodes only the MSS54', async () => {
        const { d, sent } = deps();
        const run = await runScan(scanTargets([P.mss54, P.dsc, P.kombi]), d);
        expect(run.end).toBe('done');
        expect(sent).toEqual(['12 05 04 00 13', '12 05 04 01 12', '56 05 04 01 56', '80 05 04 01 80']);
        expect(run.results.map((r) => r.outcome)).toEqual(['answered', 'answered', 'answered']);
        expect(run.results[0].decoded).toEqual({ entries: 2 });
        expect(run.results[1].decoded).toBeUndefined();
        expect(run.results[1].exchanges[0].response).toBe('01 02');
    });

    it('reads every module while the car moves too (operator, 2026-11-04)', async () => {
        const { d, sent } = deps({ motions: ['moving', 'unknown'] });
        const run = await runScan(scanTargets([P.mss54, P.kombi]), d);
        expect(sent).toEqual(['12 05 04 00 13', '12 05 04 01 12', '80 05 04 01 80']);
        expect(run.end).toBe('done');
    });

    it('records silence and refusal as the modules’ answers, without asking again', async () => {
        const { d, sent } = deps({ answers: { 0x56: 'silent', 0x80: 'rejected' } });
        const run = await runScan(scanTargets([P.dsc, P.kombi]), d);
        expect(sent).toEqual(['56 05 04 01 56', '80 05 04 01 80']);
        expect(run.results.map((r) => r.outcome)).toEqual(['silent', 'rejected']);
    });

    it('holds back a read the ledger has withdrawn, for any candidate of the address', async () => {
        const ledger: Ledger = { version: 1, records: { 'dsc_e46:FS_LESEN': { id: 'dsc_e46:FS_LESEN', status: 'revoked', reason: 'test' } as never } };
        const { d, sent } = deps({ ledger });
        const run = await runScan(scanTargets([P.ascmk20, P.dsc]), d);
        expect(sent).toEqual([]);
        expect(run.results[0]).toMatchObject({ outcome: 'refused', reason: 'run_block_revoked' });
    });

    it('says an address with no common frame was not asked', async () => {
        const { d, sent } = deps();
        const run = await runScan(scanTargets([P.mfl, P.mfl2]), d);
        expect(sent).toEqual([]);
        expect(run.results[0].outcome).toBe('refused');
        expect(run.results[0].reason).toMatch(/no fault-read frame is common/);
    });
});

describe('scan: the DSC MK60 (KWP-on-DS2), parked only', () => {
    it('lists it with its own frames, apart from DS2\'s', () => {
        const mk60 = scanTargets([P.mss54, P.mk60]).find((t) => t.address === 0xb8)!;
        expect(mk60.frames).toEqual([]);
        expect(mk60.kwp?.faults.map((f) => f.hex)).toEqual([MK60_FS]);
    });

    it('reads it on a car measured parked, and keeps the codes as an estimate beside the bytes', async () => {
        const { d, sent, measuredCount } = deps();
        const run = await runScan(scanTargets([P.mss54, P.mk60, P.kombi]), d);
        expect(sent).toEqual(['12 05 04 00 13', '12 05 04 01 12', '80 05 04 01 80', MK60_FS]);
        expect(measuredCount()).toBe(1);
        const r = run.results.find((x) => x.address === '0xB8')!;
        expect(r.outcome).toBe('answered');
        expect(r.exchanges).toEqual([{ request: MK60_FS, response: '58 01 5d 90 24' }]);
        expect(r.kwpDtcs).toEqual([{ code: '0x5d90', status: 0x24 }]);
        expect(r.decoded).toBeUndefined();
    });

    it.each(['moving', 'unknown'] as const)('sends it nothing on a car that is %s, says why, and goes on', async (motion) => {
        const { d, sent } = deps({ motions: [motion] });
        const run = await runScan(scanTargets([P.mk60, P.kombi]), d);
        expect(sent).toEqual(['80 05 04 01 80']);
        expect(run.results.find((x) => x.address === '0xB8')).toMatchObject({ outcome: 'refused', reason: KWP_NOT_PARKED, exchanges: [] });
        expect(run.end).toBe('done');
    });

    it('holds it back when the ledger has withdrawn its fault read, without measuring', async () => {
        const ledger: Ledger = { version: 1, records: { 'dsc_mk60:FS_LESEN': { id: 'dsc_mk60:FS_LESEN', status: 'revoked', reason: 'test' } as never } };
        const { d, sent, measuredCount } = deps({ ledger });
        const run = await runScan(scanTargets([P.mk60]), d);
        expect(sent).toEqual([]);
        expect(measuredCount()).toBe(0);
        expect(run.results[0]).toMatchObject({ outcome: 'refused', reason: 'run_block_revoked' });
    });

    it('records its silence, its refusal and the read\'s own hold as what they are', async () => {
        for (const [kwp, outcome] of [['silent', 'silent'], ['rejected', 'rejected'], ['held', 'refused']] as const) {
            const { d } = deps({ kwp });
            const run = await runScan(scanTargets([P.mk60]), d);
            expect(run.results[0].outcome).toBe(outcome);
            expect(run.results[0].exchanges).toEqual([{ request: MK60_FS, response: null }]);
        }
    });

    it('keeps bytes that are not the $58 shape as bytes, with no codes read into them', async () => {
        const { d } = deps({ kwp: 'odd' });
        const run = await runScan(scanTargets([P.mk60]), d);
        expect(run.results[0]).toMatchObject({ outcome: 'answered', exchanges: [{ request: MK60_FS, response: '58 02 5d' }] });
        expect(run.results[0].kwpDtcs).toBeUndefined();
    });

    it('is not asked where the link has no KWP exchange', async () => {
        const { d, sent } = deps();
        delete d.kwpExchange;
        const run = await runScan(scanTargets([P.mk60]), d);
        expect(sent).toEqual([]);
        expect(run.results[0].outcome).toBe('refused');
    });
});

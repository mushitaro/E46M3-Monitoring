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

/**
 * What the car said on 2026-11-12, as the frames went: the driver's door mirror (SPM46FT, 0x9B)
 * answered `04 00` with one byte `00` and refused `04 01` with 0xb1; the steering-angle sensor
 * (LWS5, 0x57) refused `04 01` with 0xb0 in a scan and answered the same frame on DIAGNOSIS, where
 * its IDENT had gone first.
 */
describe('scan: the identity first, and an answer kept', () => {
    const withIdent = (module: string, address: number, ident: string, fs: string[]): TelegramTable => ({
        ...table(module, address, fs),
        jobs: {
            IDENT: [{ hex: ident, cmd: 0, cmdName: '', occurrences: 1, confidence: 'shared' as const }],
            FS_LESEN: fs.map((hex) => ({ hex, cmd: 4, cmdName: '', occurrences: 1, confidence: 'shared' as const })),
        },
    });
    const lws5 = moduleProtocol('lws5', 0x57, withIdent('lws5', 0x57, '57 04 00 53', ['57 05 04 01 57']));
    const mrs3 = moduleProtocol('mrs3', 0xa4, withIdent('mrs3', 0xa4, 'a4 04 00 a0', ['a4 05 04 00 a5']));
    const mrs4 = moduleProtocol('mrs4', 0xa4, withIdent('mrs4', 0xa4, 'a4 04 00 a0', ['a4 05 04 00 a5']));
    const spm = moduleProtocol('spm46ft', 0x9b, table('spm46ft', 0x9b, ['9b 05 04 00 9a', '9b 05 04 01 9b']));
    const status = (s: number): Ds2Frame => ({ address: 0, length: 0, controlOrStatus: s, payload: new Uint8Array(0), checksum: 0 }) as Ds2Frame;

    /** Answers by the frame sent; anything not listed is silence. */
    function car(answers: Record<string, Ds2Frame>, ledger: Ledger = EMPTY_LEDGER) {
        const sent: Array<[string, string]> = [];
        const d: ScanDeps = {
            ledger: () => ledger,
            measure: async () => 'parked',
            exchange: async (_a, _m, job, f) => {
                sent.push([job, f.hex]);
                const a = answers[f.hex];
                if (!a) throw new Ds2Error('READ_TIMEOUT', 'no answer', { kind: 'timeout' });
                return a;
            },
            stopped: () => false,
            pause: async () => {},
            now: () => 0,
        };
        return { d, sent };
    }

    it('sends a module its own IDENT before its fault read, and keeps the identity out of the result', async () => {
        const { d, sent } = car({ '57 04 00 53': ok([0x11, 0x22, 0x33]), '57 05 04 01 57': ok(new Array(16).fill(0)) });
        const run = await runScan(scanTargets([lws5]), d);
        expect(sent).toEqual([
            ['IDENT', '57 04 00 53'],
            ['FS_LESEN', '57 05 04 01 57'],
        ]);
        expect(run.results[0]).toMatchObject({ outcome: 'answered', ident: { request: '57 04 00 53', outcome: 'answered', bytes: 3 } });
        expect(run.results[0].exchanges).toEqual([{ request: '57 05 04 01 57', response: new Array(16).fill('00').join(' ') }]);
        expect(JSON.stringify(run.results[0])).not.toContain('11 22 33');
    });

    it('sends a shared address the IDENT its candidates agree on, and none when they differ', async () => {
        expect(scanTargets([mrs3, mrs4])[0].ident?.hex).toBe('a4 04 00 a0');
        const other = moduleProtocol('mrs4', 0xa4, withIdent('mrs4', 0xa4, 'a4 05 00 01 a0', ['a4 05 04 00 a5']));
        expect(scanTargets([mrs3, other])[0].ident).toBeNull();
        expect(scanTargets([P.mfl, P.mfl2])[0].ident).toBeNull();
    });

    it('takes silence to the IDENT as the module’s absence, and does not wait a second time', async () => {
        const { d, sent } = car({});
        const run = await runScan(scanTargets([lws5]), d);
        expect(sent).toEqual([['IDENT', '57 04 00 53']]);
        expect(run.results[0]).toMatchObject({ outcome: 'silent', exchanges: [] });
    });

    it('still reads the faults of a module that refuses its IDENT', async () => {
        const { d, sent } = car({ '57 04 00 53': status(Ds2Status.REJECTED), '57 05 04 01 57': ok([0x00]) });
        const run = await runScan(scanTargets([lws5]), d);
        expect(sent.map((x) => x[0])).toEqual(['IDENT', 'FS_LESEN']);
        expect(run.results[0]).toMatchObject({ outcome: 'answered', ident: { outcome: 'rejected' } });
    });

    it('does not send an IDENT the ledger has withdrawn', async () => {
        const ledger: Ledger = { version: 1, records: { 'lws5:IDENT': { id: 'lws5:IDENT', status: 'revoked', reason: 'test' } as never } };
        const { d, sent } = car({ '57 05 04 01 57': ok([0x00]) }, ledger);
        const run = await runScan(scanTargets([lws5]), d);
        expect(sent).toEqual([['FS_LESEN', '57 05 04 01 57']]);
        expect(run.results[0].outcome).toBe('answered');
    });

    it('keeps the answer of a module that refuses a later frame (the door mirror, 2026-11-12)', async () => {
        const { d, sent } = car({ '9b 05 04 00 9a': ok([0x00]), '9b 05 04 01 9b': status(Ds2Status.FUNCTION_ERROR) });
        const run = await runScan(scanTargets([spm]), d);
        expect(sent.map((x) => x[1])).toEqual(['9b 05 04 00 9a', '9b 05 04 01 9b']);
        expect(run.results[0].outcome).toBe('answered');
        expect(run.results[0].exchanges).toEqual([
            { request: '9b 05 04 00 9a', response: '00' },
            { request: '9b 05 04 01 9b', response: null, refused: 'status 0xb1' },
        ]);
        expect(run.results[0].reason).toBe('answered 1 of 2 frames; 9b 05 04 01 9b refused (status 0xb1)');
    });

    it('calls a module that refuses its first fault-read frame rejected, as before', async () => {
        const { d } = car({ '9b 05 04 00 9a': status(Ds2Status.REJECTED) });
        const run = await runScan(scanTargets([spm]), d);
        expect(run.results[0]).toMatchObject({ outcome: 'rejected', reason: 'status 0xa2' });
    });

    it('does not decode the MSS54 from half an answer', async () => {
        const { d } = car({ '12 05 04 00 13': ok([0x02]) });
        const run = await runScan(scanTargets([P.mss54]), { ...d, decode: () => ({ entries: 1 }) });
        expect(run.results[0].outcome).toBe('answered');
        expect(run.results[0].reason).toMatch(/answered 1 of 2 frames; 12 05 04 01 12 got no answer/);
        expect(run.results[0].decoded).toBeUndefined();
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

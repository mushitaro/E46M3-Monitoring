import { describe, expect, it } from 'vitest';
import { Ds2Error, Ds2Status, type Ds2Frame } from '@tsunagi/ds2-core';
import { EMPTY_LEDGER, type Ledger } from '../ledger';
import { moduleProtocol } from '../moduleProtocol';
import type { TelegramTable } from '../telegrams';
import type { Motion } from '../vehicleState';
import { runScan, scanTargets, type ScanDeps } from './scan';

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

const P = {
    mss54: moduleProtocol('mss54', 0x12, table('mss54', 0x12, ['12 05 04 00 13', '12 05 04 01 12'])),
    ascmk20: moduleProtocol('ascmk20', 0x56, table('ascmk20', 0x56, ['56 05 04 01 56'])),
    dsc: moduleProtocol('dsc_e46', 0x56, table('dsc_e46', 0x56, ['56 05 04 01 56'])),
    mfl: moduleProtocol('mfl', 0x50, table('mfl', 0x50, ['50 05 04 01 50'])),
    mfl2: moduleProtocol('mfl2', 0x50, null),
    kombi: moduleProtocol('kombi46', 0x80, table('kombi46', 0x80, ['80 05 04 01 80'])),
};

const ok = (payload: number[]): Ds2Frame => ({ address: 0, length: 0, controlOrStatus: Ds2Status.ACKNOWLEDGE, payload: new Uint8Array(payload), checksum: 0 }) as Ds2Frame;
const no = (): Ds2Frame => ({ address: 0, length: 0, controlOrStatus: Ds2Status.REJECTED, payload: new Uint8Array(0), checksum: 0 }) as Ds2Frame;

function deps(opts: { answers?: Record<number, 'ok' | 'silent' | 'rejected'>; motions?: Motion[]; ledger?: Ledger } = {}) {
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

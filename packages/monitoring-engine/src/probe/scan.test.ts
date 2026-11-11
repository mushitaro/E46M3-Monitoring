import { describe, expect, it } from 'vitest';
import { Ds2Error, Ds2Status, type Ds2Frame } from '@tsunagi/ds2-core';
import { EMPTY_LEDGER, type Ledger } from '../ledger.ts';
import { moduleProtocol } from '../moduleProtocol.ts';
import { clusterVinAnswer, kombiIdentData, M3_IDENTS, NON_M3_IDENTS, PRACTICE_VIN_SHORT, type PracticeIdent } from '../practiceCar.ts';
import type { TelegramTable } from '../telegrams.ts';
import { FIXTURE_MODULES, FIXTURE_RULES, FIXTURE_RULES_KOMBI, identFrame } from '../testing/variantFixture.ts';
import { fittedFrom, type Fitted, type VariantRules } from '../variants.ts';
import { runScan, scanTargets, type ScanDeps } from './scan.ts';

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
    smg2: moduleProtocol('smg2', 0x32, table('smg2', 0x32, ['32 05 04 01 32'])),
};

const ok = (payload: number[]): Ds2Frame => ({ address: 0, length: 0, controlOrStatus: Ds2Status.ACKNOWLEDGE, payload: new Uint8Array(payload), checksum: 0 }) as Ds2Frame;
const no = (): Ds2Frame => ({ address: 0, length: 0, controlOrStatus: Ds2Status.REJECTED, payload: new Uint8Array(0), checksum: 0 }) as Ds2Frame;

/**
 * The car on the other end: what each address answers to its IDENT (an M3 by default) and to its
 * fault read. `sent` is every frame in order, the IDENTs included.
 */
function deps(
    opts: {
        answers?: Record<number, 'ok' | 'silent' | 'rejected'>;
        idents?: Record<number, PracticeIdent | 'silent'>;
        identOk?: number[];
        ledger?: Ledger;
        rules?: VariantRules;
        /** What the cluster answers its VIN read with. */
        vin?: 'ok' | 'rejected' | 'silent' | 'junk';
    } = {},
) {
    const sent: string[] = [];
    const fitment = new Map<number, Fitted>();
    const idents: Record<number, PracticeIdent | 'silent'> = opts.idents ?? { ...M3_IDENTS };
    let dmeAsked = 0;
    const d: ScanDeps = {
        ledger: () => opts.ledger ?? EMPTY_LEDGER,
        identity: {
            rules: opts.rules ?? FIXTURE_RULES,
            identOk: new Set(opts.identOk ?? [0x12, 0x32, 0x50, 0x56, 0x80]),
            fitment: () => fitment,
            identify: async (address) => {
                const known = fitment.get(address);
                if (known) return known;
                sent.push(`${address.toString(16).padStart(2, '0')} 04 00 ${(address ^ 4).toString(16).padStart(2, '0')}`);
                const i = idents[address] ?? { hw: '00', diag: '00' };
                const f = fittedFrom(opts.rules ?? FIXTURE_RULES, FIXTURE_MODULES, address, i === 'silent' || opts.answers?.[address] === 'silent' ? null : identFrame(address, i));
                if (f.answer !== null) fitment.set(address, f);
                return f;
            },
        },
        dmeAnswers: async () => {
            dmeAsked++;
            return true;
        },
        exchange: async (address, _m, _j, f) => {
            sent.push(f.hex);
            const a = opts.answers?.[address] ?? 'ok';
            if (a === 'silent') throw new Ds2Error('READ_TIMEOUT', 'no answer', { kind: 'timeout' });
            if (f.hex === '80 05 02 02 85') {
                const v = opts.vin ?? 'ok';
                if (v === 'silent') throw new Ds2Error('READ_TIMEOUT', 'no answer', { kind: 'timeout' });
                return v === 'rejected' ? no() : ok(v === 'junk' ? [0x02, 0x00, 0x00, 0x00, 0x00, 0x00] : clusterVinAnswer(PRACTICE_VIN_SHORT));
            }
            return a === 'rejected' ? no() : ok([0x01, 0x02]);
        },
        decode: (_t, frames) => ({ entries: frames.length }),
        stopped: () => false,
        pause: async () => {},
        now: () => 0,
    };
    return { d, sent, fitment, dmeAskedCount: () => dmeAsked };
}

/** Frames other than an IDENT: what a module is asked beyond who it is. */
const beyondIdent = (sent: string[]) => sent.filter((h) => !/^[0-9a-f]{2} 04 00 [0-9a-f]{2}$/.test(h));

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
        // The DME's IDENT first: it says the car is an M3, so the others keep the M3 fitment unasked.
        expect(sent).toEqual(['12 04 00 16', '12 05 04 00 13', '12 05 04 01 12', '56 05 04 01 56', '80 05 04 01 80']);
        expect(run.results[0].variant).toEqual({ sgbd: 'MSS54DS0', moduleId: 'mss54', basis: 'identified' });
        expect(run.results[2].variant).toEqual({ sgbd: null, moduleId: null, basis: 'm3-fitment' });
        expect(run.results.map((r) => r.outcome)).toEqual(['answered', 'answered', 'answered']);
        expect(run.results[0].decoded).toEqual({ entries: 2 });
        expect(run.results[1].decoded).toBeUndefined();
        expect(run.results[1].exchanges[0].response).toBe('01 02');
    });

    it('reads every module while the car moves too (operator, 2026-11-04): it never waits on the speed', async () => {
        const { d, sent, dmeAskedCount } = deps();
        const run = await runScan(scanTargets([P.mss54, P.kombi]), d);
        expect(sent).toEqual(['12 04 00 16', '12 05 04 00 13', '12 05 04 01 12', '80 05 04 01 80']);
        expect(run.end).toBe('done');
        expect(dmeAskedCount()).toBe(0);
    });

    it('records silence and refusal as the modules’ answers, without asking again', async () => {
        const { d, sent } = deps({ answers: { 0x56: 'silent', 0x80: 'rejected' } });
        const run = await runScan(scanTargets([P.mss54, P.dsc, P.kombi]), d);
        expect(beyondIdent(sent)).toEqual(['12 05 04 00 13', '12 05 04 01 12', '56 05 04 01 56', '80 05 04 01 80']);
        expect(run.results.map((r) => r.outcome)).toEqual(['answered', 'silent', 'rejected']);
    });

    it('holds back a read the ledger has withdrawn, for any candidate of the address', async () => {
        const ledger: Ledger = { version: 1, records: { 'dsc_e46:FS_LESEN': { id: 'dsc_e46:FS_LESEN', status: 'revoked', reason: 'test' } as never } };
        const { d, sent } = deps({ ledger });
        const run = await runScan(scanTargets([P.mss54, P.ascmk20, P.dsc]), d);
        expect(sent.filter((h) => h.startsWith('56'))).toEqual([]);
        expect(run.results[1]).toMatchObject({ outcome: 'refused', reason: 'run_block_revoked' });
    });

    it('says an address with no common frame was not asked', async () => {
        const { d, sent } = deps();
        const run = await runScan(scanTargets([P.mfl, P.mfl2]), d);
        expect(sent).toEqual([]);
        expect(run.results[0].outcome).toBe('refused');
        expect(run.results[0].reason).toMatch(/no fault-read frame is common/);
    });
});

/**
 * Phase 4-1: a non-M3 E46 is not sent the M3's frames. The DME and the gearbox answer their IDENT as
 * an MS43 and a GS20; nothing built for the MSS54 or the SMG II goes, and nothing is decoded as the
 * MSS54. Every other address is `?` and gets its IDENT only.
 */
describe('scan run on a car that is not an M3', () => {
    const all = () => scanTargets([P.mss54, P.smg2, P.dsc, P.ascmk20, P.kombi]);

    it('MS43 + GS20: only IDENTs go, to every address, and each says what it is', async () => {
        const { d, sent } = deps({ idents: { ...NON_M3_IDENTS } });
        const run = await runScan(all(), d);
        expect(sent).toEqual(['12 04 00 16', '32 04 00 36', '56 04 00 52', '80 04 00 84']);
        expect(beyondIdent(sent)).toEqual([]);
        expect(run.results.map((r) => [r.address, r.outcome, r.variant?.sgbd ?? null])).toEqual([
            ['0x12', 'identified', 'MS430DS0'],
            ['0x32', 'identified', 'GS20'],
            ['0x56', 'identified', null],
            ['0x80', 'identified', null],
        ]);
        expect(run.results.some((r) => r.decoded !== undefined)).toBe(false);
        expect(run.results[0].reason).toMatch(/does not carry/);
        expect(run.results[2].reason).toMatch(/\(\?\)/);
    });

    it('a DME that does not answer its IDENT is not an M3 either: still IDENTs only', async () => {
        const { d, sent } = deps({ idents: { 0x12: 'silent', 0x32: M3_IDENTS[0x32] } });
        const run = await runScan(all(), d);
        // The gearbox said SMG II, and SMG II is carried: its own fault read goes. Nothing else does.
        expect(beyondIdent(sent)).toEqual(['32 05 04 01 32']);
        expect(run.results.find((r) => r.address === '0x12')).toMatchObject({ outcome: 'silent' });
        expect(run.results.find((r) => r.address === '0x80')).toMatchObject({ outcome: 'identified' });
    });

    it('an address whose common IDENT is not its own is not even asked that', async () => {
        const { d, sent } = deps({ idents: { ...NON_M3_IDENTS }, identOk: [0x12, 0x32] });
        const run = await runScan(all(), d);
        expect(sent).toEqual(['12 04 00 16', '32 04 00 36']);
        expect(run.results.find((r) => r.address === '0x80')).toMatchObject({ outcome: 'refused', exchanges: [] });
    });
});

describe('scan run on an M3 whose 0x32 is not the SMG II', () => {
    it('a manual gearbox (0x32 silent): no SMG II frame goes', async () => {
        const { d, sent } = deps({ idents: { 0x12: M3_IDENTS[0x12], 0x32: 'silent' } });
        const run = await runScan(scanTargets([P.mss54, P.smg2, P.kombi]), d);
        expect(sent).toEqual(['12 04 00 16', '12 05 04 00 13', '12 05 04 01 12', '32 04 00 36', '80 05 04 01 80']);
        expect(run.results.find((r) => r.address === '0x32')).toMatchObject({ outcome: 'silent' });
    });

    it('a 0x32 the group does not know (its "XYZ"): `?`, IDENT only', async () => {
        const { d, sent } = deps({ idents: { 0x12: M3_IDENTS[0x12], 0x32: { hw: '99', diag: '00' } } });
        const run = await runScan(scanTargets([P.mss54, P.smg2]), d);
        expect(sent.filter((h) => h.startsWith('32'))).toEqual(['32 04 00 36']);
        expect(run.results.find((r) => r.address === '0x32')).toMatchObject({ outcome: 'identified', variant: { sgbd: null } });
    });
});

describe('the instrument cluster’s VIN, once (intake, operator 2026-11-10)', () => {
    /** The two E46 clusters with their own fault read and their own AIF block 2 read. */
    const cluster = (module: string, job: string) =>
        moduleProtocol(module, 0x80, {
            module,
            sgbd: module.toUpperCase(),
            address: 0x80,
            jobs: {
                FS_LESEN: [{ hex: '80 05 04 01 80', cmd: 4, cmdName: '', occurrences: 1, confidence: 'shared' as const }],
                [job]: [{ hex: '80 05 02 02 85', cmd: 2, cmdName: '', occurrences: 1, confidence: 'shared' as const }],
            },
        });
    const targets = () => scanTargets([P.mss54, cluster('kombi46', 'AIF_FG_NR_LESEN'), cluster('kombi46r', 'STATUS_AIF_FG_NR_LESEN')]);
    const VIN_FRAME = '80 05 02 02 85';
    const spells = (x: unknown) => {
        const text = JSON.stringify(x).toLowerCase();
        return text.includes(PRACTICE_VIN_SHORT.toLowerCase()) || text.includes('4a 52') || text.includes('4a52') || text.includes(VIN_FRAME);
    };

    it('an M3 whose cluster said KOMBI46R: its fault read, then its VIN read, once — and the answer is not among the results', async () => {
        const { d, sent } = deps({ rules: FIXTURE_RULES_KOMBI });
        const run = await runScan(targets(), d);
        expect(sent.filter((h) => h.startsWith('80'))).toEqual(['80 04 00 84', '80 05 04 01 80', VIN_FRAME]);
        expect(run.vin).toEqual({ address: '0x80', moduleId: 'kombi46r', job: 'STATUS_AIF_FG_NR_LESEN', outcome: 'answered', vinShort: PRACTICE_VIN_SHORT });
        // Not in what the screen shows as bytes, what the ledger records, what the assistant reads.
        expect(spells(run.results)).toBe(false);
        expect(run.results.find((r) => r.address === '0x80')).toMatchObject({ outcome: 'answered', variant: { sgbd: 'KOMBI46R', moduleId: 'kombi46r', basis: 'identified' } });
    });

    it('a car that is not an M3, with the E46’s KOMBI46: the cluster is identified, so its VIN is read too', async () => {
        const { d, sent } = deps({ rules: FIXTURE_RULES_KOMBI, idents: { ...NON_M3_IDENTS } });
        const run = await runScan(targets(), d);
        expect(sent.filter((h) => h.startsWith('80'))).toEqual(['80 04 00 84', '80 05 04 01 80', VIN_FRAME]);
        expect(run.vin).toMatchObject({ moduleId: 'kombi46', job: 'AIF_FG_NR_LESEN', vinShort: PRACTICE_VIN_SHORT });
        // Nothing beyond IDENT went to the DME or the gearbox of this car.
        expect(beyondIdent(sent).filter((h) => !h.startsWith('80'))).toEqual([]);
    });

    it('a cluster whose variant is not known — no rule (M3 fitment), `?`, or one the app does not carry — is not sent it', async () => {
        for (const opts of [
            { rules: FIXTURE_RULES }, // no D_0080: the M3 fitment reads its faults, not its identity
            { rules: FIXTURE_RULES_KOMBI, idents: { ...M3_IDENTS, 0x80: { data: kombiIdentData(0x99) } } }, // `?`
            { rules: FIXTURE_RULES_KOMBI, idents: { ...M3_IDENTS, 0x80: { data: kombiIdentData(0x31) } } }, // KOMBI39
        ]) {
            const { d, sent } = deps(opts);
            const run = await runScan(targets(), d);
            expect(sent).not.toContain(VIN_FRAME);
            expect(run.vin).toBeNull();
        }
    });

    it('not when its fault read went unanswered, and not when the read has been withdrawn', async () => {
        const silent = deps({ rules: FIXTURE_RULES_KOMBI, answers: { 0x80: 'silent' } });
        // Silent to its IDENT too: nothing beyond it went.
        expect((await runScan(targets(), silent.d)).vin).toBeNull();
        expect(silent.sent).not.toContain(VIN_FRAME);

        const ledger: Ledger = { version: 1, records: { 'kombi46r:STATUS_AIF_FG_NR_LESEN': { id: 'kombi46r:STATUS_AIF_FG_NR_LESEN', status: 'revoked', reason: 'test' } } };
        const withdrawn = deps({ rules: FIXTURE_RULES_KOMBI, ledger });
        const run = await runScan(targets(), withdrawn.d);
        expect(withdrawn.sent).not.toContain(VIN_FRAME);
        expect(run.vin).toMatchObject({ outcome: 'refused', vinShort: null, reason: 'run_block_revoked' });
    });

    it('a refusal, silence or an answer that holds no short VIN: null, said as such, never a guess', async () => {
        for (const [vin, outcome] of [['rejected', 'rejected'], ['silent', 'silent'], ['junk', 'answered']] as const) {
            const { d } = deps({ rules: FIXTURE_RULES_KOMBI, vin });
            const run = await runScan(targets(), d);
            expect(run.vin).toMatchObject({ outcome, vinShort: null });
            expect(run.vin?.reason).toBeTruthy();
        }
    });
});

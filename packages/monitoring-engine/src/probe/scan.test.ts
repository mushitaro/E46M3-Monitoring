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

/** DSC_MK60's FS_LESEN: $18 02 FF FF to KWP target 0x29, on wire address 0xB8. */
const MK60_FS = 'b8 29 f1 04 18 02 ff ff 7e';

const P = {
    mss54: moduleProtocol('mss54', 0x12, table('mss54', 0x12, ['12 05 04 00 13', '12 05 04 01 12'])),
    ascmk20: moduleProtocol('ascmk20', 0x56, table('ascmk20', 0x56, ['56 05 04 01 56'])),
    dsc: moduleProtocol('dsc_e46', 0x56, table('dsc_e46', 0x56, ['56 05 04 01 56'])),
    mfl: moduleProtocol('mfl', 0x50, table('mfl', 0x50, ['50 05 04 01 50'])),
    mfl2: moduleProtocol('mfl2', 0x50, null),
    kombi: moduleProtocol('kombi46', 0x80, table('kombi46', 0x80, ['80 05 04 01 80'])),
    smg2: moduleProtocol('smg2', 0x32, table('smg2', 0x32, ['32 05 04 01 32'])),
    mk60: moduleProtocol('dsc_mk60', 0xb8, { ...table('dsc_mk60', 0xb8, [MK60_FS]), framing: 'kwp-ds2' }),
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
        /** The modules the app carries, when not the fixture's. */
        modules?: ReadonlyArray<{ id: string; sgbd: string }>;
        /** What the DSC MK60 answers its KWP-on-DS2 fault read with. */
        kwp?: 'ok' | 'silent' | 'rejected' | 'held' | 'odd';
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
                const f = fittedFrom(opts.rules ?? FIXTURE_RULES, opts.modules ?? FIXTURE_MODULES, address, i === 'silent' || opts.answers?.[address] === 'silent' ? null : identFrame(address, i));
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

describe('an address two modules share with no common frame, which its IDENT tells apart (2026-11-11)', () => {
    // GS20 beside SMG II at 0x32, and the MS43 beside the MSS54 at 0x12: the non-M3 E46's modules.
    const gs20 = moduleProtocol('gs20', 0x32, table('gs20', 0x32, ['32 05 04 02 31']));
    const ms43 = moduleProtocol('ms430ds0', 0x12, table('ms430ds0', 0x12, ['12 05 04 00 13', '12 05 04 01 12']));
    const modules = [...FIXTURE_MODULES, { id: 'ms430ds0', sgbd: 'MS430DS0.prg' }, { id: 'gs20', sgbd: 'GS20.prg' }];

    it('asks the IDENT, then sends the chosen module its own frames — not refused for want of a common one', async () => {
        const { d, sent } = deps({ idents: { ...NON_M3_IDENTS }, modules });
        const run = await runScan(scanTargets([P.mss54, ms43, P.smg2, gs20]), d);
        const at32 = run.results.find((r) => r.address === '0x32')!;
        expect(at32.variant?.sgbd).toBe('GS20');
        expect(at32.outcome).toBe('answered');
        expect(beyondIdent(sent)).toContain('32 05 04 02 31');
        expect(beyondIdent(sent)).not.toContain('32 05 04 01 32');
    });

    it('still decodes an M3’s MSS54 when other DMEs share its address', async () => {
        const { d } = deps({ modules });
        const ts = scanTargets([P.mss54, ms43]);
        expect(ts[0].decoder).toBe('mss54');
        const run = await runScan(ts, d);
        expect(run.results[0].variant?.moduleId).toBe('mss54');
        expect(run.results[0].decoded).toEqual({ entries: 2 });
    });

    it('decodes nothing as an MSS54 when the IDENT says the DME is an MS43', async () => {
        const { d } = deps({ idents: { ...NON_M3_IDENTS }, modules });
        const run = await runScan(scanTargets([P.mss54, ms43]), d);
        expect(run.results[0].variant?.moduleId).toBe('ms430ds0');
        expect(run.results[0].decoded).toBeUndefined();
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

    it('after the cluster’s own job has read its faults, its VIN read still goes, once', async () => {
        const { d, sent } = deps({ rules: FIXTURE_RULES_KOMBI });
        const read = { faults: [], status: 'OKAY', stopped: null, provenance: 'sgbd-job' as const };
        const run = await runScan(targets(), {
            ...d,
            jobRead: async (t) =>
                t.address === 0x80 ? { module: t.modules[0], read: { outcome: 'answered', read, exchanges: [{ request: '80 05 04 01 80', response: '00' }], provenance: 'sgbd-job' } } : null,
        });
        expect(sent.filter((h) => h === VIN_FRAME)).toEqual([VIN_FRAME]);
        expect(run.vin).toMatchObject({ moduleId: 'kombi46r', outcome: 'answered', vinShort: PRACTICE_VIN_SHORT });
        expect(spells(run.results)).toBe(false);
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

/** An M3 as the scan finds it once its DME has answered its IDENT: the M3 fitment for every address without a rule. */
function m3Identity(): ScanDeps['identity'] {
    const fitment = new Map<number, Fitted>([[0x12, fittedFrom(FIXTURE_RULES, FIXTURE_MODULES, 0x12, identFrame(0x12, M3_IDENTS[0x12]))]]);
    return { rules: FIXTURE_RULES, identOk: new Set(), fitment: () => fitment, identify: async (a) => fitment.get(a)! };
}

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

    /** An M3 that answers by the frame sent; anything not listed is silence. */
    function car(answers: Record<string, Ds2Frame>, ledger: Ledger = EMPTY_LEDGER) {
        const sent: Array<[string, string]> = [];
        const d: ScanDeps = {
            ledger: () => ledger,
            identity: m3Identity(),
            dmeAnswers: async () => true,
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
        const { d } = deps();
        const half: ScanDeps = {
            ...d,
            exchange: async (address, m, j, f, o) => {
                if (f.hex === '12 05 04 01 12') throw new Ds2Error('READ_TIMEOUT', 'no answer', { kind: 'timeout' });
                return d.exchange(address, m, j, f, o);
            },
        };
        const run = await runScan(scanTargets([P.mss54]), half);
        expect(run.results[0].outcome).toBe('answered');
        expect(run.results[0].reason).toMatch(/answered 1 of 2 frames; 12 05 04 01 12 got no answer/);
        expect(run.results[0].decoded).toBeUndefined();
    });
});

describe('scan: another module read by its own SGBD', () => {
    const read = { faults: [{ code: 1, text: 'Wischer', kinds: ['sporadischer Fehler'], values: [] }], status: 'OKAY', stopped: null, provenance: 'sgbd-job' as const };

    it('hands every page with the frame sent to the module’s own reading, and keeps the bytes beside it', async () => {
        const { d } = deps();
        const seen: string[][] = [];
        const run = await runScan(scanTargets([P.mss54, P.kombi]), {
            ...d,
            decodeBySgbd: async (t, xs) => {
                seen.push(xs.map((x) => x.request));
                return { ...read, module: t.modules[0] };
            },
        });
        // The MSS54 has its own decoder; only the cluster goes this way.
        expect(seen).toEqual([['80 05 04 01 80']]);
        const kombi = run.results.find((r) => r.address === '0x80')!;
        expect(kombi.sgbdFaults).toEqual({ ...read, module: 'kombi46' });
        expect(kombi.exchanges[0].response).toBe('01 02');
        expect(run.results.find((r) => r.address === '0x12')!.sgbdFaults).toBeUndefined();
    });

    it('does not read an answer cut short, nor a refusal', async () => {
        const { d } = deps({ answers: { 0x80: 'rejected' } });
        let called = 0;
        const run = await runScan(scanTargets([P.mss54, P.kombi]), {
            ...d,
            decodeBySgbd: async () => {
                called++;
                return null;
            },
        });
        expect(called).toBe(0);
        expect(run.results.find((r) => r.address === '0x80')!.sgbdFaults).toBeUndefined();
    });

    it('says the reading failed rather than losing the answer', async () => {
        const { d } = deps();
        const run = await runScan(scanTargets([P.mss54, P.kombi]), {
            ...d,
            decodeBySgbd: async () => {
                throw new Error('no table');
            },
        });
        const kombi = run.results.find((r) => r.address === '0x80')!;
        expect(kombi.outcome).toBe('answered');
        expect(kombi.reason).toBe('SGBD reading: no table');
    });

    it('lets the module’s own job read it where its data carries the job, and sends nothing else', async () => {
        const { d, sent } = deps();
        const job = { outcome: 'answered' as const, read, exchanges: [{ request: '80 05 04 01 80', response: '01 02' }], provenance: 'sgbd-job' as const };
        const asked: string[][] = [];
        const run = await runScan(scanTargets([P.mss54, P.kombi]), {
            ...d,
            jobRead: async (t) => {
                asked.push(t.modules);
                return { module: t.modules[0], read: job };
            },
        });
        // Not the MSS54: its own decoder reads its frames.
        expect(asked).toEqual([['kombi46']]);
        expect(sent.filter((h) => h.startsWith('80'))).toEqual([]);
        expect(run.results.find((r) => r.address === '0x80')).toMatchObject({ outcome: 'answered', sgbdFaults: { ...read, module: 'kombi46' } });
    });

    it('does not run the job where a car not an M3 left the address unknown', async () => {
        const { d } = deps({ idents: { ...NON_M3_IDENTS } });
        let asked = 0;
        const run = await runScan(scanTargets([P.mss54, P.kombi]), {
            ...d,
            jobRead: async () => {
                asked++;
                return null;
            },
        });
        expect(asked).toBe(0);
        expect(run.results.find((r) => r.address === '0x80')!.outcome).toBe('identified');
    });
});

describe('scan: the DSC MK60 (KWP-on-DS2)', () => {
    it('lists it with its own frames, apart from DS2’s', () => {
        const mk60 = scanTargets([P.mss54, P.mk60]).find((t) => t.address === 0xb8)!;
        expect(mk60.frames).toEqual([]);
        expect(mk60.kwp?.faults.map((f) => f.hex)).toEqual([MK60_FS]);
    });

    it('reads it on an M3, and keeps the codes as an estimate beside the bytes', async () => {
        const { d, sent } = deps();
        const run = await runScan(scanTargets([P.mss54, P.mk60, P.kombi]), d);
        expect(beyondIdent(sent)).toEqual(['12 05 04 00 13', '12 05 04 01 12', '80 05 04 01 80', MK60_FS]);
        const r = run.results.find((x) => x.address === '0xB8')!;
        expect(r.outcome).toBe('answered');
        expect(r.exchanges).toEqual([{ request: MK60_FS, response: '58 01 5d 90 24' }]);
        expect(r.kwpDtcs).toEqual([{ code: '0x5d90', status: 0x24 }]);
        expect(r.decoded).toBeUndefined();
    });

    it('does not ask it on a car not identified as an M3', async () => {
        const { d, sent } = deps({ idents: { ...NON_M3_IDENTS } });
        const run = await runScan(scanTargets([P.mss54, P.mk60]), d);
        expect(sent).not.toContain(MK60_FS);
        expect(run.results.find((x) => x.address === '0xB8')).toMatchObject({ outcome: 'refused', exchanges: [] });
    });

    it('holds it back when the ledger has withdrawn its fault read', async () => {
        const ledger: Ledger = { version: 1, records: { 'dsc_mk60:FS_LESEN': { id: 'dsc_mk60:FS_LESEN', status: 'revoked', reason: 'test' } as never } };
        const { d, sent } = deps({ ledger });
        const run = await runScan(scanTargets([P.mss54, P.mk60]), d);
        expect(sent).not.toContain(MK60_FS);
        expect(run.results.find((x) => x.address === '0xB8')).toMatchObject({ outcome: 'refused', reason: 'run_block_revoked' });
    });

    it('records its silence, its refusal and the read’s own hold as what they are', async () => {
        for (const [kwp, outcome] of [['silent', 'silent'], ['rejected', 'rejected'], ['held', 'refused']] as const) {
            const { d } = deps({ kwp });
            const run = await runScan(scanTargets([P.mss54, P.mk60]), d);
            const r = run.results.find((x) => x.address === '0xB8')!;
            expect(r.outcome).toBe(outcome);
            expect(r.exchanges).toEqual([{ request: MK60_FS, response: null }]);
        }
    });

    it('keeps bytes that are not the $58 shape as bytes, with no codes read into them', async () => {
        const { d } = deps({ kwp: 'odd' });
        const run = await runScan(scanTargets([P.mss54, P.mk60]), d);
        const r = run.results.find((x) => x.address === '0xB8')!;
        expect(r).toMatchObject({ outcome: 'answered', exchanges: [{ request: MK60_FS, response: '58 02 5d' }] });
        expect(r.kwpDtcs).toBeUndefined();
    });

    it('is not asked where the link has no KWP exchange', async () => {
        const { d, sent } = deps();
        delete d.kwpExchange;
        const run = await runScan(scanTargets([P.mss54, P.mk60]), d);
        expect(sent).not.toContain(MK60_FS);
        expect(run.results.find((x) => x.address === '0xB8')!.outcome).toBe('refused');
    });
});

import { afterEach, describe, expect, it } from 'vitest';
import { Ds2Address, Ds2Link, WebSerialTransport, isDs2Error, simulatedPort, toHex } from '@tsunagi/ds2-core';
import { blockBySelection, liveBlockRequest } from '@tsunagi/ds2-mss54';
import type { EcuIndex } from './ecuCatalog.ts';
import { moduleProtocol } from './moduleProtocol.ts';
import { kombiIdentData, M3_IDENTS, NON_M3_IDENTS, practiceCar, resetPracticeCar, type PracticeIdent } from './practiceCar.ts';
import { practiceBus } from './practiceEcu.ts';
import type { TelegramTable } from './telegrams.ts';
import { HAVE_SHIPPED_DATA, readShipped } from './testing/shipped.ts';
import { FIXTURE_MODULES, FIXTURE_RULES, FIXTURE_RULES_KOMBI, identFrame } from './testing/variantFixture.ts';
import {
    commonIdent,
    fittedFrom,
    frameVerdict,
    groupChoice,
    identAddresses,
    isM3,
    mayModuleBeSent,
    variantOf,
    type Fitted,
    type GroupRule,
    type VariantRules,
} from './variants.ts';

/**
 * Which module is at an address, and what may be sent to it before and after it has said so.
 *
 * The rules here are a fixture shaped like the generated ones (testing/variantFixture), so the
 * mechanism is tested on any clone. The generated rules themselves are checked against EDIABAS's own
 * choices (`variants.oracle.json`) at the end, where the private data is present.
 */

const fit = (...fs: Fitted[]) => new Map(fs.map((f) => [f.address, f]));
const fitted = (address: number, ident: PracticeIdent | null) =>
    fittedFrom(FIXTURE_RULES, FIXTURE_MODULES, address, ident ? identFrame(address, ident) : null);
const rule = (address: number) => FIXTURE_RULES.groups.find((g) => g.address === address)!;

describe('the group rule', () => {
    it('reads the answer where the group file does, and takes the first table that knows the key', () => {
        expect(variantOf(rule(0x12), identFrame(0x12, M3_IDENTS[0x12]))).toBe('MSS54DS0');
        expect(variantOf(rule(0x12), identFrame(0x12, NON_M3_IDENTS[0x12]))).toBe('MS430DS0');
        expect(variantOf(rule(0x32), identFrame(0x32, M3_IDENTS[0x32]))).toBe('SMG2');
        expect(variantOf(rule(0x32), identFrame(0x32, NON_M3_IDENTS[0x32]))).toBe('GS20');
        // Case is not significant, as in EDIABAS's table seek.
        expect(variantOf(rule(0x32), identFrame(0x32, { hw: '2f', diag: '00' }))).toBe('SMG2');
        // A nested branch: D_0032's "22" looks at byte 14.
        expect(variantOf(rule(0x32), identFrame(0x32, { hw: '22', diag: '10' }))).toBe('GS836');
        expect(variantOf(rule(0x32), identFrame(0x32, { hw: '22', diag: '20' }))).toBe('GS832');
    });

    it('chooses nothing for a refusal, another address, or a key no table holds — and says XYZ is not an SGBD', () => {
        expect(variantOf(rule(0x12), identFrame(0x12, M3_IDENTS[0x12], 0xa2))).toBeNull();
        expect(variantOf(rule(0x12), identFrame(0x32, M3_IDENTS[0x12]))).toBeNull();
        expect(variantOf(rule(0x12), identFrame(0x12, { hw: '77', diag: '77' }))).toBeNull();
        expect(groupChoice(rule(0x32), identFrame(0x32, { hw: '99', diag: '00' }))).toBe('XYZ');
        expect(variantOf(rule(0x32), identFrame(0x32, { hw: '99', diag: '00' }))).toBeNull();
    });

    it('reads a short answer as far as it goes, and stops a key at a NUL', () => {
        expect(variantOf(rule(0x12), Uint8Array.from([0x12, 0x05, 0xa0, 0x31, 0xb6]))).toBeNull();
        const nul = identFrame(0x12, { hw: '1B', diag: '90' });
        nul[11] = 0x00; // HW "1\0": the key is "1" + "90"
        expect(variantOf(rule(0x12), nul)).toBeNull();
    });
});

describe('a rule that reads a byte as a number (D_0080, the instrument cluster)', () => {
    const kombi = FIXTURE_RULES_KOMBI.groups.find((g) => g.address === 0x80)!;
    const answer = (data: number[], status = 0xa0) => identFrame(0x80, { data }, status);

    it('reads the diagnosis index (byte 9) as the group does: high nibble times ten plus the low one', () => {
        expect(variantOf(kombi, answer(kombiIdentData(0x50)))).toBe('KOMBI46');
        expect(variantOf(kombi, answer(kombiIdentData(0x60)))).toBe('KOMBI46R');
        expect(variantOf(kombi, answer(kombiIdentData(0x31)))).toBe('KOMBI39');
        // A–F count as they are: 0x4E is 40 + 14 = 54, KOMBI46R; 0x2F is 20 + 15 = 35, no range here.
        expect(variantOf(kombi, answer(kombiIdentData(0x4e)))).toBe('KOMBI46R');
        expect(variantOf(kombi, answer(kombiIdentData(0x2f)))).toBeNull();
        expect(variantOf(kombi, answer(kombiIdentData(0x99)))).toBeNull();
    });

    it('takes the other branch when byte 3’s high nibble is D, and chooses nothing past the end or on a refusal', () => {
        const d = kombiIdentData(0x50);
        d[0] = 0xd9; // byte 3
        expect(variantOf(kombi, answer(d))).toBeNull();
        d[6] = 0x02;
        expect(variantOf(kombi, answer(d))).toBe('KOMBIR40');
        expect(variantOf(kombi, answer(kombiIdentData(0x50).slice(0, 6)))).toBeNull(); // byte 9 not there
        expect(variantOf(kombi, answer(kombiIdentData(0x50), 0xa2))).toBeNull();
    });

    it('chooses nothing at a step this build does not know (a newer rules file), rather than failing', () => {
        const odd = { ...kombi, choose: { byte: 9, read: 'packed', ranges: [[0, 255, 'KOMBI46']], else: null } } as unknown as GroupRule;
        expect(variantOf(odd, answer(kombiIdentData(0x50)))).toBeNull();
        const stranger = { ...kombi, choose: { lookup: 'x' } } as unknown as GroupRule;
        expect(variantOf(stranger, answer(kombiIdentData(0x50)))).toBeNull();
    });
});

describe('what may be sent where', () => {
    const m3 = fit(fitted(0x12, M3_IDENTS[0x12]), fitted(0x32, M3_IDENTS[0x32]));
    const nonM3 = fit(fitted(0x12, NON_M3_IDENTS[0x12]), fitted(0x32, NON_M3_IDENTS[0x32]));

    it('a car is an M3 when its DME has said it is the MSS54, and not before', () => {
        expect(isM3(m3)).toBe(true);
        expect(isM3(nonM3)).toBe(false);
        expect(isM3(new Map())).toBe(false);
        expect(isM3(fit(fitted(0x12, null)))).toBe(false);
    });

    it('an address with a rule takes only the module its IDENT chose', () => {
        expect(mayModuleBeSent(0x12, 'mss54', m3, FIXTURE_RULES)).toEqual({ ok: true, basis: 'identified' });
        expect(mayModuleBeSent(0x32, 'smg2', m3, FIXTURE_RULES)).toEqual({ ok: true, basis: 'identified' });
        // A non-M3: the DME is MS43, the gearbox GS20. Neither is carried, so neither M3 module goes.
        expect(mayModuleBeSent(0x12, 'mss54', nonM3, FIXTURE_RULES)).toMatchObject({ ok: false, reason: expect.stringMatching(/MS430DS0, whose SGBD this app does not carry/) });
        expect(mayModuleBeSent(0x32, 'smg2', nonM3, FIXTURE_RULES)).toMatchObject({ ok: false, reason: expect.stringMatching(/GS20/) });
        // Not asked yet is a refusal, not a pass.
        expect(mayModuleBeSent(0x12, 'mss54', new Map(), FIXTURE_RULES)).toMatchObject({ ok: false, reason: expect.stringMatching(/not identified yet/) });
    });

    it('an address without a rule keeps the M3 fitment on an M3, and is "?" on any other car', () => {
        expect(mayModuleBeSent(0x80, 'kombi46', m3, FIXTURE_RULES)).toEqual({ ok: true, basis: 'm3-fitment' });
        expect(mayModuleBeSent(0x80, 'kombi46', nonM3, FIXTURE_RULES)).toMatchObject({ ok: false, reason: expect.stringMatching(/\(\?\).*MS430DS0, not the M3's MSS54DS0/) });
        expect(mayModuleBeSent(0x80, 'kombi46', new Map(), FIXTURE_RULES)).toMatchObject({ ok: false, reason: expect.stringMatching(/DME has not been identified/) });
    });

    it('the link guard: the common IDENT where it is the address’s own, anything else only to a cleared address', () => {
        const identOk = new Set([0x12, 0x32, 0x80]);
        const speed = liveBlockRequest(19);
        const mssBlock = Uint8Array.from([0x12, 0x05, speed.control, ...speed.payload, 0x12 ^ 0x05 ^ speed.control ^ speed.payload[0]]);
        expect(frameVerdict(commonIdent(0x12), new Map(), FIXTURE_RULES, identOk)).toBeNull();
        expect(frameVerdict(commonIdent(0x44), new Map(), FIXTURE_RULES, identOk)).toMatch(/not this address's own/);
        expect(frameVerdict(mssBlock, new Map(), FIXTURE_RULES, identOk)).toMatch(/not identified/);
        expect(frameVerdict(mssBlock, nonM3, FIXTURE_RULES, identOk)).toMatch(/not identified as a module this app carries/);
        expect(frameVerdict(mssBlock, m3, FIXTURE_RULES, identOk)).toBeNull();
        const kombi = Uint8Array.from([0x80, 0x05, 0x04, 0x01, 0x80]);
        expect(frameVerdict(kombi, nonM3, FIXTURE_RULES, identOk)).toMatch(/has not identified itself as an M3/);
        expect(frameVerdict(kombi, m3, FIXTURE_RULES, identOk)).toBeNull();
    });

    it('the common IDENT may go where the group sends it, or where every candidate’s own table carries it', () => {
        const p = (id: string, address: number, ident: string | null) =>
            moduleProtocol(id, address, ident ? ({ module: id, sgbd: id, address, jobs: { IDENT: [{ hex: ident, cmd: 0, cmdName: '', occurrences: 1, confidence: 'single' }] } } as TelegramTable) : null);
        const ok = identAddresses([p('kombi46', 0x80, '80 04 00 84'), p('lsz', 0xd0, null), p('ihka46', 0x5b, '5b 04 00 5f'), p('ihka46_2', 0x5b, null)], FIXTURE_RULES);
        expect([...ok].sort((a, b) => a - b)).toEqual([0x12, 0x32, 0x80]);
    });
});

/**
 * The link itself, over the PRACTICE bus, with the guard the hook installs: on a non-M3 practice car
 * no frame built for the MSS54 or the SMG II reaches 0x12 or 0x32 — only their IDENTs do.
 */
describe('over the PRACTICE bus', () => {
    const opened: WebSerialTransport[] = [];
    afterEach(async () => {
        for (const t of opened) await t.close().catch(() => {});
        opened.length = 0;
        resetPracticeCar();
    });

    async function guarded(idents: Record<number, PracticeIdent>) {
        practiceCar.idents = { ...idents };
        const { port, requestPort } = simulatedPort(practiceBus([0x32]));
        const transport = new WebSerialTransport({ requestPort });
        opened.push(transport);
        const link = new Ds2Link(transport, { address: Ds2Address.DME, timings: { responseTimeoutMs: 80, retryDelayMs: 1 } });
        const fitment = new Map<number, Fitted>();
        link.setSendGuard((frame) => frameVerdict(frame, fitment, FIXTURE_RULES, new Set([0x12, 0x32])));
        await link.connect();
        const identify = async (address: number) => {
            const f = await link.to(address).exchangeWithRetry(0x00);
            const answer = Uint8Array.from([f.address, f.length, f.controlOrStatus, ...f.payload, f.checksum]);
            fitment.set(address, fittedFrom(FIXTURE_RULES, FIXTURE_MODULES, address, answer));
            return fitment.get(address)!;
        };
        return { link, bus: port.bus!, identify, fitment };
    }

    const speed = () => {
        const block = blockBySelection(19)!;
        return liveBlockRequest(block.selection);
    };

    it('a non-M3 (MS43, GS20): the IDENTs go, then nothing of the M3’s does', async () => {
        const { link, bus, identify } = await guarded({ ...NON_M3_IDENTS });
        expect((await identify(0x12)).sgbd).toBe('MS430DS0');
        expect((await identify(0x32)).sgbd).toBe('GS20');

        const req = speed();
        const dme = await link.to(0x12).exchangeWithRetry(req.control, req.payload).catch((e) => e);
        expect(isDs2Error(dme) && dme.code).toBe('NOT_SENT');
        const smg = await link.to(0x32).exchangeWithRetry(0x04, Uint8Array.from([0x01])).catch((e) => e);
        expect(isDs2Error(smg) && smg.code).toBe('NOT_SENT');

        // What reached the modules: their IDENT, once each, and nothing else.
        expect(bus.at(0x12)!.trace.map((t) => toHex(t.bytes))).toEqual(['12 04 00 16']);
        expect(bus.at(0x32)!.trace.map((t) => toHex(t.bytes))).toEqual(['32 04 00 36']);
    });

    it('an M3 (MSS54, SMG II): once identified, the MSS54’s speed block and SMG II’s frames go as before', async () => {
        const { link, bus, identify } = await guarded({ ...M3_IDENTS });
        expect((await identify(0x12)).moduleId).toBe('mss54');
        expect((await identify(0x32)).moduleId).toBe('smg2');
        const req = speed();
        await expect(link.to(0x12).exchangeWithRetry(req.control, req.payload)).resolves.toBeTruthy();
        expect(bus.at(0x12)!.trace).toHaveLength(2);
    });

    it('before anything is identified, even an M3’s DME gets nothing but its IDENT', async () => {
        const { link, bus } = await guarded({ ...M3_IDENTS });
        const req = speed();
        await expect(link.to(0x12).exchangeWithRetry(req.control, req.payload)).rejects.toMatchObject({ code: 'NOT_SENT' });
        expect(bus.at(0x12)!.trace).toHaveLength(0);
    });
});

describe.skipIf(!HAVE_SHIPPED_DATA)('the generated rules (variants.json) against EDIABAS', () => {
    const rules = HAVE_SHIPPED_DATA ? readShipped<VariantRules>('variants.json') : null;
    const oracle = HAVE_SHIPPED_DATA ? readShipped<{ groups: Record<string, Array<{ answer: string; variant: string | null }>> }>('variants.oracle.json') : null;
    const bytes = (hex: string) => Uint8Array.from(hex.split(' '), (h) => parseInt(h, 16));

    it('choose, for every answer EdiabasLib was given, what the group file itself chose', () => {
        let n = 0;
        for (const g of rules!.groups) {
            const said = oracle!.groups[g.group];
            expect(said?.length ?? 0).toBeGreaterThan(100);
            for (const { answer, variant } of said) {
                expect([g.group, answer, groupChoice(g as GroupRule, bytes(answer))]).toEqual([g.group, answer, variant]);
                n++;
            }
        }
        expect(n).toBeGreaterThan(1000);
    });

    it('know the practice cars: the M3 is MSS54DS0 + SMG2, the other is MS430DS0 + GS20', () => {
        const at = (a: number) => rules!.groups.find((g) => g.address === a)!;
        expect(variantOf(at(0x12), identFrame(0x12, M3_IDENTS[0x12]))).toBe('MSS54DS0');
        expect(variantOf(at(0x32), identFrame(0x32, M3_IDENTS[0x32]))).toBe('SMG2');
        expect(variantOf(at(0x12), identFrame(0x12, NON_M3_IDENTS[0x12]))).toBe('MS430DS0');
        expect(variantOf(at(0x32), identFrame(0x32, NON_M3_IDENTS[0x32]))).toBe('GS20');
    });

    it('know the practice clusters: the M3’s is KOMBI46R, the other car’s KOMBI46 — both carried', () => {
        const at = rules!.groups.find((g) => g.address === 0x80)!;
        expect(at.group).toBe('D_0080');
        expect(variantOf(at, identFrame(0x80, M3_IDENTS[0x80]))).toBe('KOMBI46R');
        expect(variantOf(at, identFrame(0x80, NON_M3_IDENTS[0x80]))).toBe('KOMBI46');
        const index = readShipped<EcuIndex>('index.json');
        const modules = index.modules.map((m) => ({ id: m.id, sgbd: m.sgbd }));
        expect(fittedFrom(rules!, modules, 0x80, identFrame(0x80, M3_IDENTS[0x80])).moduleId).toBe('kombi46r');
        expect(fittedFrom(rules!, modules, 0x80, identFrame(0x80, NON_M3_IDENTS[0x80])).moduleId).toBe('kombi46');
    });

    it('map the M3’s two SGBDs to the app’s modules, and let the common IDENT go to 0x12 and 0x32', () => {
        const index = readShipped<EcuIndex>('index.json');
        const modules = index.modules.map((m) => ({ id: m.id, sgbd: m.sgbd }));
        const f12 = fittedFrom(rules!, modules, 0x12, identFrame(0x12, M3_IDENTS[0x12]));
        const f32 = fittedFrom(rules!, modules, 0x32, identFrame(0x32, M3_IDENTS[0x32]));
        expect([f12.moduleId, f32.moduleId]).toEqual(['mss54', 'smg2']);
        const protocols = index.modules.map((m) => moduleProtocol(m.id, m.address, readShipped<TelegramTable>(`${m.id}.telegrams.json`)));
        const ok = identAddresses(protocols, rules!);
        expect(ok.has(0x12) && ok.has(0x32) && ok.has(0x80)).toBe(true);
        // MK60 speaks KWP-shaped frames: the DS2 IDENT is not its own.
        expect(ok.has(0xb8)).toBe(false);
    });
});

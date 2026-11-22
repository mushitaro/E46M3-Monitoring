import { afterEach, describe, expect, it } from 'vitest';
import { Ds2Address, Ds2Link, WebSerialTransport, simulatedPort } from '@tsunagi/ds2-core';
import { adaptationBlockBySelection, blockBySelection, decodeAdaptationBlock, decodeLiveBlock, liveBlockRequest } from '@tsunagi/ds2-mss54';
import { practiceCar, resetPracticeCar } from './practiceCar.ts';
import { practiceBus } from './practiceEcu.ts';

/**
 * A diagnosis practised end to end on PRACTICE (GREN BLUE SUITE's test plan §7.2): the symptom shows in
 * the datalog, the learned values say what the DME has been compensating, a repair is made — a part, or a
 * clear of the learned values — and the next datalog shows the fault gone or still there.
 */

const opened: WebSerialTransport[] = [];
afterEach(async () => {
    for (const t of opened) await t.close().catch(() => {});
    opened.length = 0;
    resetPracticeCar();
});

async function dme() {
    const { requestPort } = simulatedPort(practiceBus([]));
    const transport = new WebSerialTransport({ requestPort });
    opened.push(transport);
    const link = new Ds2Link(transport, { address: Ds2Address.DME, timings: { responseTimeoutMs: 80, retryDelayMs: 1 } });
    await link.connect();
    return link.to(0x12);
}

type Dme = Awaited<ReturnType<typeof dme>>;

async function live(link: Dme, selection: number): Promise<Record<string, number | null>> {
    const req = liveBlockRequest(selection);
    const frame = await link.exchangeWithRetry(req.control, req.payload);
    return Object.fromEntries(decodeLiveBlock(blockBySelection(selection)!, frame).map((v) => [v.symbol, v.value]));
}

async function learned(link: Dme, selection: number): Promise<Record<string, number | null>> {
    const frame = await link.exchangeWithRetry(0x0b, new Uint8Array([selection]));
    return Object.fromEntries(decodeAdaptationBlock(adaptationBlockBySelection(selection)!, frame.payload).map((v) => [v.symbol, v.value]));
}

const clearAll = (link: Dme) => link.exchangeWithRetry(0x43, new Uint8Array([0xff, 0x00]));

describe('the practice car’s symptoms', () => {
    it('reads healthy by default: lambda factors 1, every cylinder smooth, no learned value', async () => {
        const link = await dme();
        const b19 = await live(link, 19);
        expect(b19.la_f_regler1).toBeCloseTo(1, 3);
        expect(b19.la_f_regler2).toBeCloseTo(1, 3);
        const b21 = await live(link, 21);
        for (let c = 1; c <= 6; c++) expect(b21[`ll_abw${c}`]).toBeCloseTo(0, 2);
        const a6 = await learned(link, 6);
        expect(a6.laa_offset1).toBe(0);
        expect(a6['lu_adapt[0]']).toBe(0);
    });

    it('shows a lean bank, a rough cylinder and its misfires in the values the app decodes', async () => {
        practiceCar.symptoms = { lambdaFactor: [1.18, 1.01], roughness: [0, 0, 0, 4.5, 0, 0], misfires: [0, 0, 0, 37, 0, 0] };
        const link = await dme();
        const b19 = await live(link, 19);
        expect(b19.la_f_regler1).toBeCloseTo(1.18, 3);
        expect(b19.la_f_regler2).toBeCloseTo(1.01, 3);
        const b21 = await live(link, 21);
        expect(b21.ll_abw4).toBeCloseTo(4.5, 2);
        expect(b21.ll_abw3).toBeCloseTo(0, 2);
        const b179 = await live(link, 179);
        expect(b179['lu[3]']).toBeCloseTo(4.5, 1);
        const a22 = await learned(link, 22);
        expect(a22['auss_sum_dc[3]']).toBe(37);
        expect(a22['auss_sum_adap[3]']).toBe(37);
        expect(a22['auss_sum_dc[0]']).toBe(0);
    });

    it('carries a learned value below zero through its own scale', async () => {
        practiceCar.mss54Adapt = { laa_offset1: -0.25, 'lu_adapt[2]': -0.3, 'evan1_adap': -2 };
        const a6 = await learned(await dme(), 6);
        expect(a6.laa_offset1).toBeCloseTo(-0.25, 2);
        expect(a6['lu_adapt[2]']).toBeCloseTo(-0.3, 3);
        expect(a6.evan1_adap).toBe(-2);
    });

    it('swings the idle as far as the scenario says', async () => {
        practiceCar.symptoms = { idleRpmSwing: 200 };
        const link = await dme();
        const seen: number[] = [];
        for (let i = 0; i < 12; i++) {
            seen.push((await live(link, 3)).n!);
            await new Promise((r) => setTimeout(r, 120));
        }
        expect(Math.max(...seen) - Math.min(...seen)).toBeGreaterThan(60);
    });
});

describe('a repair, then the datalog again', () => {
    it('a clear of the learned values cures a symptom a learned value caused', async () => {
        practiceCar.symptoms = { lambdaFactor: [1.2, 1.2], curedByAdaptClear: true };
        practiceCar.mss54Adapt = { laa_offset1: 0.4, laa_offset2: 0.4 };
        const link = await dme();
        expect((await live(link, 19)).la_f_regler1).toBeCloseTo(1.2, 3);
        await clearAll(link);
        expect(practiceCar.mss54AdaptClears).toBe(1);
        expect((await learned(link, 6)).laa_offset1).toBe(0);
        expect((await live(link, 19)).la_f_regler1).toBeCloseTo(1, 3);
    });

    it('a clear does not cure a part: the rough cylinder is still rough until the part is changed', async () => {
        practiceCar.symptoms = { roughness: [0, 0, 0, 0, 6, 0], misfires: [0, 0, 0, 0, 12, 0] };
        const link = await dme();
        await clearAll(link);
        expect((await live(link, 21)).ll_abw5).toBeCloseTo(6, 2);
        // The part: a scenario changes the coil, and the engine runs clean.
        practiceCar.symptoms = null;
        expect((await live(link, 21)).ll_abw5).toBeCloseTo(0, 2);
        expect((await learned(link, 22))['auss_sum_dc[4]']).toBe(0);
    });

    it('clears nothing for a selective clear whose bits this app has no table for', async () => {
        practiceCar.symptoms = { lambdaFactor: [1.2, 1.2], curedByAdaptClear: true };
        practiceCar.mss54Adapt = { laa_offset1: 0.4 };
        const link = await dme();
        await link.exchangeWithRetry(0x43, new Uint8Array([0x01, 0x00]));
        expect(practiceCar.mss54AdaptClears).toBe(0);
        expect((await learned(link, 6)).laa_offset1).toBeCloseTo(0.4, 2);
    });
});

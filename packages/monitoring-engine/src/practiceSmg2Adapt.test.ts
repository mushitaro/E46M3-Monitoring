import { afterEach, describe, expect, it } from 'vitest';
import { Ds2Address, Ds2Link, WebSerialTransport, simulatedPort } from '@tsunagi/ds2-core';
import { SMG2_ADAPT_BYTES, SMG2_CLUTCH_DEFAULT_BYTES, practiceCar, resetPracticeCar } from './practiceCar.ts';
import { practiceBus } from './practiceEcu.ts';
import { answerFrame, foldResults, type SgbdResultsTable } from './sgbd/results.ts';
import { runSgbdJob, type SgbdTables } from './sgbd/vm.ts';
import { HAVE_SHIPPED_DATA, readShipped } from './testing/shipped.ts';

/**
 * SMG II's learned values on PRACTICE (GREN BLUE SUITE's test plan §7.2): what the gearbox holds, read by
 * its own ADAPTIONSWERTE_LESEN code; a clear that puts the clutch back to its defaults; a test program
 * that, finished, leaves what the scenario says it teaches — so "a calibration fixed it" can be practised
 * with a before and an after.
 */

const opened: WebSerialTransport[] = [];
afterEach(async () => {
    for (const t of opened) await t.close().catch(() => {});
    opened.length = 0;
    resetPracticeCar();
});

async function smg() {
    const { requestPort } = simulatedPort(practiceBus([0x32]));
    const transport = new WebSerialTransport({ requestPort });
    opened.push(transport);
    const link = new Ds2Link(transport, { address: Ds2Address.DME, timings: { responseTimeoutMs: 80, retryDelayMs: 1 } });
    await link.connect();
    return link.to(0x32);
}

type Smg = Awaited<ReturnType<typeof smg>>;

const raw = async (link: Smg, group: number) => (await link.exchangeWithRetry(0x40, new Uint8Array([group]))).payload;

describe('the practice car’s SMG II learned values, as bytes', () => {
    it('answers each group with what it holds, zero elsewhere', async () => {
        practiceCar.smg2Adapt[0] = { 0: 140, 6: 3 };
        const link = await smg();
        const a = await raw(link, 0);
        expect(a[0]).toBe(140);
        expect(a[6]).toBe(3);
        expect(a[1]).toBe(0);
        expect((await raw(link, 1)).every((b) => b === 0)).toBe(true);
    });

    it('clears as its SGBD says: the clutch to its defaults (0), the gearbox data to zero (1), the gearbox adaptations kept', async () => {
        practiceCar.smg2Adapt = { 0: { 0: 140, 6: 3 }, 1: { 3: 9 }, 2: { 0: 12 } };
        const link = await smg();
        await link.exchangeWithRetry(0x43, new Uint8Array([0x00]));
        expect(practiceCar.smg2Adapt[0]).toEqual(SMG2_CLUTCH_DEFAULT_BYTES);
        await link.exchangeWithRetry(0x43, new Uint8Array([0x01]));
        expect(practiceCar.smg2Adapt[2]).toEqual({});
        expect(practiceCar.smg2Adapt[1]).toEqual({ 3: 9 });
        expect(practiceCar.smg2AdaptClears).toEqual([0, 1]);
    });

    it('learns what the scenario says when a test program runs to its end, and nothing for another', async () => {
        practiceCar.smg2Adapt[0] = { 0: 160 };
        practiceCar.smg2Relearn = { 0x02: { 0: { 0: 99 } } };
        const link = await smg();
        const run = async (program: number) => {
            await link.exchangeWithRetry(0x33, new Uint8Array(0));
            for (let i = 0; i < 10; i++) {
                const a = await link.exchangeWithRetry(0x32, new Uint8Array([program, 0x00]));
                if (a.payload[0] === 0x02) return;
            }
            throw new Error('the program did not finish');
        };
        await run(0x03);
        expect(practiceCar.smg2Adapt[0]).toEqual({ 0: 160 });
        await run(0x02);
        expect((await raw(link, 0))[0]).toBe(99);
        expect(practiceCar.smg2ProgramsFinished).toEqual([0x03, 0x02]);
    });

    it('leaves the DME’s learned values alone', async () => {
        practiceCar.mss54Adapt = { laa_offset1: 2 };
        const link = await smg();
        await link.exchangeWithRetry(0x43, new Uint8Array([0x00]));
        expect(practiceCar.mss54Adapt).toEqual({ laa_offset1: 2 });
        expect(practiceCar.mss54AdaptClears).toBe(0);
    });
});

describe.skipIf(!HAVE_SHIPPED_DATA)('the practice car’s SMG II learned values, read by its own SGBD code', () => {
    const table = HAVE_SHIPPED_DATA ? readShipped<SgbdResultsTable>('smg2.results.json') : null;

    /** ADAPTIONSWERTE_LESEN run as the app runs it: the job builds the frame, the car answers it, the job reads it. */
    async function read(link: Smg, group: number): Promise<Record<string, number | string>> {
        const job = table!.jobs.ADAPTIONSWERTE_LESEN;
        const code = { code: Uint8Array.from(Buffer.from(job.code, 'base64')), base: job.base };
        const tables = table!.tables as SgbdTables;
        const dry = runSgbdJob(code, { args: [String(group)], tables });
        const req = dry.request!;
        expect(req[2]).toBe(0x40);
        const frame = await link.exchangeWithRetry(req[2], req.slice(3));
        const sent = new Uint8Array([...req, req.reduce((a, b) => a ^ b, 0)]);
        const run = runSgbdJob(code, { args: [String(group)], tables, sent, answer: answerFrame(0x32, 0xa0, frame.payload) });
        const { values, status } = foldResults(run.results);
        expect(status).toBe('OKAY');
        return Object.fromEntries(values.map((v) => [v.name, v.value]));
    }

    it('reads the clutch’s defaults after ADAPTIONSWERTE_LOESCHEN(0), as the SGBD’s own comments give them', async () => {
        practiceCar.smg2Adapt[0] = { [SMG2_ADAPT_BYTES.touchPoint.offset]: 150, [SMG2_ADAPT_BYTES.overloads.offset]: 4 };
        const link = await smg();
        const before = await read(link, 0);
        expect(before.KUPPL_SCHLEIF_PKT_INK_WERT).toBe(228);
        expect(before.ZAHL_KUPPL_UEBERLAST_WERT).toBe(4);
        await link.exchangeWithRetry(0x43, new Uint8Array([0x00]));
        const after = await read(link, 0);
        expect(after.KUPPL_SCHLEIF_PKT_INK_WERT).toBe(97);
        expect(after.I_NULL_VENT_KUPPL_WERT).toBe(1002);
        expect(after.UEBERDECKUNG_VENT_KUPPL_WERT).toBe(0);
        expect(after.POS_EINKUP_WERT).toBe(830);
        expect(after.POS_AUSKUP_WERT).toBe(400);
        expect(after.ZAHL_KUPPL_UEBERLAST_WERT).toBe(0);
    });

    it('reads the bytes `SMG2_ADAPT_BYTES` names as the values it says', async () => {
        practiceCar.smg2Adapt = {
            0: { [SMG2_ADAPT_BYTES.valveZeroCurrent.offset]: 5, [SMG2_ADAPT_BYTES.engagedPosition.offset]: 10, [SMG2_ADAPT_BYTES.disengagedPosition.offset]: 0 },
            1: { [SMG2_ADAPT_BYTES.selectCurrentOffset.offset + 1]: 42, [SMG2_ADAPT_BYTES.shiftNeutral.offset]: 1, [SMG2_ADAPT_BYTES.shiftNeutral.offset + 1]: 2 },
            2: { [SMG2_ADAPT_BYTES.raceStarts.offset]: 7 },
        };
        const link = await smg();
        const clutch = await read(link, 0);
        expect(clutch.I_NULL_VENT_KUPPL_WERT).toBe(1012);
        expect(clutch.POS_EINKUP_WERT).toBe(850);
        const gearbox = await read(link, 1);
        expect(gearbox.OFF_I_WW_WERT).toBe(42);
        expect(gearbox.POS_SW_N_WERT).toBe(258);
        expect((await read(link, 2)).ANZ_RENNSTART_WERT).toBe(7);
    });
});

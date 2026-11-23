import { afterEach, describe, expect, it } from 'vitest';
import { Ds2Address, Ds2Link, WebSerialTransport, simulatedPort } from '@tsunagi/ds2-core';
import { decodeByLayout, type FaultLayouts } from './faultLayouts.ts';
import { BMS46_IDENTS, NON_M3_IDENTS, PRACTICE_DME_RECORDS, practiceCar, practiceDmeOf, resetPracticeCar, type PracticeIdent } from './practiceCar.ts';
import { practiceBus } from './practiceEcu.ts';
import { HAVE_SHIPPED_DATA, readShipped } from './testing/shipped.ts';
import { identFrame } from './testing/variantFixture.ts';
import { groupChoice, ruleFor, type VariantRules } from './variants.ts';

/**
 * PRACTICE playing a DME that is not the MSS54 (GREN BLUE SUITE's test plan §7.2: "練習の車が BMS46（M43 の
 * 318i）も演じられるように"). The IDENT selects the DME as D_0012 does, and the fault memory is answered
 * where that DME's own FS_LESEN reads it — so what is checked here is the shipped layout and the shipped
 * rule reading the practice car's bytes, not the practice car agreeing with itself.
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

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join(' ');
const withCs = (bytes: number[]) => hex(Uint8Array.from([...bytes, bytes.reduce((a, b) => a ^ b, 0)]));

/** The quick test and the entries read, as the app's fault read sends them, with their payloads. */
async function faultReads() {
    const link = await dme();
    const quick = await link.exchangeWithRetry(0x04, new Uint8Array([0x00]));
    const entries = await link.exchangeWithRetry(0x04, new Uint8Array([0x01]));
    return [
        { request: withCs([0x12, 0x05, 0x04, 0x00]), response: hex(quick.payload) },
        { request: withCs([0x12, 0x05, 0x04, 0x01]), response: hex(entries.payload) },
    ];
}

describe('which DME the practice IDENT selects', () => {
    it('names the MS43 and the BMS46 by their hardware number, the DS1 by its diagnosis index', () => {
        expect(practiceDmeOf(NON_M3_IDENTS[0x12])).toBe('ms430ds0');
        expect(practiceDmeOf(BMS46_IDENTS[0x12])).toBe('bms46ds0');
        expect(practiceDmeOf({ hw: '61', diag: 'A7' })).toBe('bms46ds1');
        expect(practiceDmeOf({ hw: '1B', diag: '90' })).toBeNull();
        expect(practiceDmeOf(undefined)).toBeNull();
    });
});

describe.skipIf(!HAVE_SHIPPED_DATA)('the practice DMEs against the shipped data', () => {
    const rules = HAVE_SHIPPED_DATA ? readShipped<VariantRules>('variants.json') : null;
    const layouts = HAVE_SHIPPED_DATA ? readShipped<FaultLayouts>('fault-layouts.json') : null;

    it('D_0012’s own rule chooses the DME practiceDmeOf names, from the same IDENT answer', () => {
        const rule = ruleFor(rules!, 0x12)!;
        const cases: PracticeIdent[] = [NON_M3_IDENTS[0x12], BMS46_IDENTS[0x12], { hw: '61', diag: 'A7' }];
        for (const ident of cases) {
            expect(groupChoice(rule, identFrame(0x12, ident))?.toLowerCase()).toBe(practiceDmeOf(ident));
        }
    });

    it('each record shape is the one its SGBD’s FS_LESEN reads (fault-layouts.json)', () => {
        for (const [id, shape] of Object.entries(PRACTICE_DME_RECORDS)) {
            const l = layouts!.modules[id];
            expect(l, id).toBeDefined();
            expect({ id, count: l.count, start: l.start, length: l.length, code: l.code, frequency: l.frequency, present: l.present, inverted: !!l.frequencyInverted }).toEqual({
                id,
                count: 'quick',
                start: 1,
                length: shape.length,
                code: shape.code,
                frequency: shape.frequency,
                present: shape.present,
                inverted: false,
            });
        }
    });

    it('a 318i’s BMS46: its faults read through BMS46DS0’s layout, with count and "present now"', async () => {
        Object.assign(practiceCar, {
            idents: { ...BMS46_IDENTS },
            nonM3DmeFaults: [
                { code: 0x2a, present: true, count: 4 },
                { code: 0x05, present: false, count: 1 },
            ],
        });
        const faults = decodeByLayout(layouts!.modules.bms46ds0, await faultReads());
        expect(faults).toEqual([
            { code: '0x2A', count: 4, present: true },
            { code: '0x05', count: 1, present: false },
        ]);
    });

    it('the BMS46’s DS1 keeps its frequency a byte later, and is read there', async () => {
        Object.assign(practiceCar, { idents: { 0x12: { hw: '61', diag: 'A7' } }, nonM3DmeFaults: [{ code: 0x11, present: true, count: 7 }] });
        expect(decodeByLayout(layouts!.modules.bms46ds1, await faultReads())).toEqual([{ code: '0x11', count: 7, present: true }]);
    });

    it('the MS43 under its old name (ms43Faults) still answers in its own layout', async () => {
        Object.assign(practiceCar, { idents: { ...NON_M3_IDENTS }, ms43Faults: [{ code: 0x01, present: true, count: 3 }] });
        expect(decodeByLayout(layouts!.modules.ms430ds0, await faultReads())).toEqual([{ code: '0x01', count: 3, present: true }]);
    });

    it('a clear empties the BMS46’s memory', async () => {
        Object.assign(practiceCar, { idents: { ...BMS46_IDENTS }, nonM3DmeFaults: [{ code: 0x2a, present: true, count: 4 }] });
        const link = await dme();
        await link.exchangeWithRetry(0x05, new Uint8Array(0));
        expect(practiceCar.nonM3DmeFaults).toEqual([]);
        expect(decodeByLayout(layouts!.modules.bms46ds0, await faultReads())).toEqual([]);
    });
});

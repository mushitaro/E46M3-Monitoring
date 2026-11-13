import { describe, expect, it } from 'vitest';
import { HAVE_SHIPPED_DATA, readShipped } from '../testing/shipped.ts';
import { decodeFaultRead, type SgbdResultsTable } from './results.ts';

/**
 * The DSC MK60's fault memory, read by its own FS_LESEN (DSC_MK60.prg) replayed on the answer: the
 * app sends its table's one frame, the job reads what came back. The answer is the one the owner's car
 * gave in the all-module scan of 2026-11-13: `58 04` and four entries of three bytes.
 */
const frame = (data: number[]) => {
    const body = [0xb8, 0xf1, 0x29, data.length, ...data];
    return Uint8Array.from([...body, body.reduce((x, b) => x ^ b, 0)]);
};
const REQUEST = 'b8 29 f1 04 18 02 ff ff 7e';
const CAR = [0x58, 0x04, 0x5e, 0x40, 0xa0, 0x5e, 0x19, 0xa0, 0x5e, 0x15, 0x20, 0x5e, 0x14, 0xa0];

describe.skipIf(!HAVE_SHIPPED_DATA)('DSC MK60 faults by its own SGBD', () => {
    const table = HAVE_SHIPPED_DATA ? readShipped<SgbdResultsTable>('dsc_mk60.results.json') : null;

    it('reads the car’s answer to its end: four locations with the SGBD’s texts and kinds', () => {
        const read = decodeFaultRead(table, [{ request: REQUEST, answer: frame(CAR) }])!;
        expect(read.stopped).toBeNull();
        expect(read.status).toBe('OKAY');
        expect(read.faults.map((f) => [f.code, f.text])).toEqual([
            [0x5e40, 'Lenkwinkel Sensor Signal unplausibel,Offset'],
            [0x5e19, 'CAN DME/DDE, Motormoment nicht einstellbar'],
            [0x5e15, 'CAN Timeout EGS'],
            [0x5e14, 'CAN Timeout DME/DDE'],
        ]);
        for (const f of read.faults) expect(f.kinds).toContain('Fehler momentan nicht vorhanden, aber bereits gespeichert');
        expect(read.faults.map((f) => f.kinds.some((k) => k.includes('kein Aufleuchten')))).toEqual([false, false, true, false]);
    });

    it('reads an empty memory as no entries, and a refusal as no verdict of OKAY', () => {
        const none = decodeFaultRead(table, [{ request: REQUEST, answer: frame([0x58, 0x00]) }])!;
        expect(none.faults).toEqual([]);
        expect(none.status).toBe('OKAY');
        const refused = decodeFaultRead(table, [{ request: REQUEST, answer: frame([0x7f, 0x18, 0x12]) }])!;
        expect(refused.faults).toEqual([]);
        expect(refused.status).not.toBe('OKAY');
    });
});

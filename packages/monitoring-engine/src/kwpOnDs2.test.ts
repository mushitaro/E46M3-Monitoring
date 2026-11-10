import { describe, expect, it } from 'vitest';
import { Ds2Error, toHex, type Ds2ByteTransport } from '@tsunagi/ds2-core';
import { kwpExchange, kwpFrameOf, kwpRequest, parseDtcsByStatus, xorOf } from './kwpOnDs2';
import { moduleProtocol } from './moduleProtocol';
import { practiceKwpAnswer } from './practiceEcu';
import { practiceCar, resetPracticeCar } from './practiceCar';
import type { TelegramTable } from './telegrams';

/**
 * DSC MK60's frames (lib/kwpOnDs2). The bytes on the wire are pinned to the SGBD's own execution
 * trace (E46M3-Monitoring-data, sgbd-dumps/DSC_MK60.telegrams.json, 2026-11-10).
 */

const IDENT = 'b8 29 f1 02 1a 80 f8';
const FS_LESEN = 'b8 29 f1 04 18 02 ff ff 7e';

/** A transport whose wire answers through `answer`, byte-exact, with readExact's contract. */
function wire(answer: (request: Uint8Array) => Uint8Array[]): Ds2ByteTransport & { sent: string[] } {
    let buffer: number[] = [];
    const sent: string[] = [];
    return {
        sent,
        open: async () => {},
        close: async () => {},
        write: async (bytes) => {
            sent.push(toHex(bytes));
            for (const out of answer(bytes)) buffer.push(...out);
        },
        readExact: async (n) => {
            if (buffer.length < n) throw new Ds2Error('READ_TIMEOUT', `Timed out waiting for ${n} byte(s) (received ${buffer.length})`, { kind: 'timeout' });
            const out = Uint8Array.from(buffer.slice(0, n));
            buffer = buffer.slice(n);
            return out;
        },
        purge: () => void (buffer = []),
        bufferedLength: () => buffer.length,
        hasReadError: () => false,
        peekReadError: () => null,
        recoverRead: async () => {},
    };
}

describe('the frames', () => {
    it('are the SGBD trace’s bytes, checksum included', () => {
        expect(toHex(kwpRequest(0x29, Uint8Array.from([0x1a, 0x80])))).toBe(IDENT.replace(/ /g, ' '));
        expect(toHex(kwpRequest(0x29, Uint8Array.from([0x18, 0x02, 0xff, 0xff])))).toBe(FS_LESEN);
        expect(xorOf([0xb8, 0x29, 0xf1, 0x01, 0x3e])).toBe(0x5f);
    });

    it('are taken from a table only when shape, length and checksum all hold', () => {
        expect(kwpFrameOf(FS_LESEN, 's')).toMatchObject({ target: 0x29, hex: FS_LESEN });
        expect(kwpFrameOf('b8 29 f1 04 18 02 ff ff 7f', 's')).toBeNull(); // checksum
        expect(kwpFrameOf('b8 29 f1 05 18 02 ff ff 7e', 's')).toBeNull(); // length
        expect(kwpFrameOf('56 04 00 52', 's')).toBeNull(); // DS2
    });

    it('give a KWP module its identity and fault read and no DS2 frame at all', () => {
        const table: TelegramTable = {
            module: 'dsc_mk60',
            sgbd: 'DSC_MK60.prg',
            address: 0xb8,
            framing: 'kwp-ds2',
            jobs: {
                IDENT: [{ hex: IDENT, cmd: 0x1a, cmdName: '', occurrences: 1, confidence: 'single' }],
                FS_LESEN: [{ hex: FS_LESEN, cmd: 0x18, cmdName: '', occurrences: 1, confidence: 'single' }],
            },
        };
        const p = moduleProtocol('dsc_mk60', 0xb8, table);
        expect(p.kwp?.ident?.hex).toBe(IDENT);
        expect(p.kwp?.faults.map((f) => f.hex)).toEqual([FS_LESEN]);
        expect([p.ident, p.clear, p.keepAlive, p.endSession, p.faults.length]).toEqual([null, null, null, null, 0]);
        // A DS2 table never grows a KWP branch.
        expect(moduleProtocol('dsc_e46', 0x56, null).kwp).toBeNull();
    });
});

describe('an exchange', () => {
    it('reads the answer by its own length byte and checks it', async () => {
        const t = wire((req) => {
            const data = [0x58, 0x01, 0x5d, 0xe4, 0x24];
            const head = [0xb8, 0xf1, 0x29, data.length, ...data];
            return [req, Uint8Array.from([...head, xorOf(head)])];
        });
        const a = await kwpExchange(t, kwpFrameOf(FS_LESEN, 's')!);
        expect(t.sent).toEqual([FS_LESEN]);
        expect(toHex(a.data)).toBe('58 01 5d e4 24');
        expect(parseDtcsByStatus(a.data)).toEqual([{ code: '0x5de4', status: 0x24 }]);
    });

    it('keeps the bytes of an answer that does not fit, in the error', async () => {
        const out = await kwpExchange(wire((req) => [req, Uint8Array.from([0x12, 0x05, 0x00, 0x00, 0x17])]), kwpFrameOf(IDENT, 's')!).catch((e) => e);
        expect(out).toBeInstanceOf(Ds2Error);
        expect((out as Ds2Error).code).toBe('ADDRESS_MISMATCH');
        expect((out as Ds2Error).message).toMatch(/12 05 00 00/);
    });

    it('takes a refusal as an answer, and a silent module as a timeout', async () => {
        const refused = await kwpExchange(
            wire((req) => {
                const head = [0xb8, 0xf1, 0x29, 3, 0x7f, 0x18, 0x11];
                return [req, Uint8Array.from([...head, xorOf(head)])];
            }),
            kwpFrameOf(FS_LESEN, 's')!,
        ).catch((e) => e);
        expect((refused as Ds2Error).code).toBe('NEGATIVE_RESPONSE');
        const silent = await kwpExchange(wire((req) => [req]), kwpFrameOf(FS_LESEN, 's')!).catch((e) => e);
        expect((silent as Ds2Error).code).toBe('READ_TIMEOUT');
    });

    it('does not read a $58 answer of the wrong length as codes', () => {
        expect(parseDtcsByStatus(Uint8Array.from([0x58, 0x02, 0x5d, 0xe4, 0x24]))).toBeNull();
        expect(parseDtcsByStatus(Uint8Array.from([0x58, 0x00]))).toEqual([]);
    });
});

describe('PRACTICE’s MK60', () => {
    it('answers its own frames and leaves every DS2 frame to the bus', () => {
        resetPracticeCar();
        const req = (hex: string) => Uint8Array.from(hex.split(' ').map((b) => parseInt(b, 16)));
        const a = practiceKwpAnswer(req(FS_LESEN))!;
        expect(a.map(toHex)).toEqual([FS_LESEN, toHex(Uint8Array.from([0xb8, 0xf1, 0x29, 5, 0x58, 1, 0x5d, 0x90, 0x24, xorOf([0xb8, 0xf1, 0x29, 5, 0x58, 1, 0x5d, 0x90, 0x24])]))]);
        expect(practiceKwpAnswer(req('56 04 00 52'))).toBeNull();
        practiceCar.lineDown = true;
        expect(practiceKwpAnswer(req(FS_LESEN))).toEqual([]);
        resetPracticeCar();
    });
});

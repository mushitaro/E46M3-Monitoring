import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildArgFrame, checksum, encodingBlocker, parseByte } from './argFrame';
import type { CatalogJob, EcuProfile } from './ecuCatalog';
import type { Telegram, TelegramTable } from './telegrams';

const DATA = path.resolve(import.meta.dirname, '..', '..', 'public', 'ecu-data');
const read = <T,>(f: string) => JSON.parse(readFileSync(path.join(DATA, f), 'utf-8')) as T;

const tel = (hex: string, over: Partial<Telegram> = {}): Telegram => ({
    hex,
    cmd: Number.parseInt(hex.split(' ')[2], 16),
    cmdName: 'x',
    occurrences: 1,
    confidence: 'single',
    ...over,
});
const argsOf = (...names: string[]) =>
    ({ args: names.map((name) => ({ name, type: 'int', kind: 'enum' as const })) });

describe('checksum', () => {
    it('is the XOR the extractor computed — the SMG II template proves it', () => {
        // `32 06 32 00 00 06`: the last byte is the XOR of the first five, and
        // it came out of the .prg scrape independently of this function.
        expect(checksum([0x32, 0x06, 0x32, 0x00, 0x00])).toBe(0x06);
        expect(checksum([0x32, 0x04, 0x33])).toBe(0x05);
    });
});

describe('parseByte', () => {
    it('reads decimal, because the SGBD says "dezimal eingeben"', () => {
        expect(parseByte('10')).toBe(10);
        expect(parseByte(' 7 ')).toBe(7);
    });

    it('reads 0x-prefixed hex, because the procedure table writes 0x0A', () => {
        expect(parseByte('0x0A')).toBe(10);
        expect(parseByte('0xff')).toBe(255);
    });

    it('refuses rather than masking — 256 is not 0', () => {
        // `& 0xff` on an out-of-range number is how a value silently becomes a
        // different value on the wire.
        expect(parseByte('256')).toBeNull();
        expect(parseByte('-1')).toBeNull();
        expect(parseByte('1.5')).toBeNull();
        expect(parseByte('0a')).toBeNull();
        expect(parseByte('')).toBeNull();
        expect(parseByte('ein')).toBeNull();
    });
});

describe('building a frame from arguments', () => {
    it('fills the placeholders and re-checksums — TESTPRG_STARTEN, gear 3', () => {
        // Test program 0x0A is "engage an arbitrary gear"; AUSWAHLBYTE 3 is
        // third gear, per the SGBD's own argument comment.
        const r = buildArgFrame(argsOf('TESTPRG_NR', 'AUSWAHLBYTE'), tel('32 06 32 00 00 06'), {
            TESTPRG_NR: '0x0A',
            AUSWAHLBYTE: '3',
        });
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.hex).toBe('32 06 32 0a 03 0f');
        expect(r.control).toBe(0x32);
        expect(checksum(r.bytes.subarray(0, 5))).toBe(r.bytes[5]);
    });

    it('leaves a zero-argument frame exactly as the scrape found it', () => {
        const r = buildArgFrame(argsOf(), tel('32 04 33 05'), {});
        expect(r.ok && r.hex).toBe('32 04 33 05');
    });

    it('refuses a template that is not certain', () => {
        for (const c of ['multiple', 'shared'] as const) {
            const r = buildArgFrame(argsOf('A'), tel('32 05 32 00 05', { confidence: c }), { A: '1' });
            expect(r.ok).toBe(false);
            if (!r.ok) expect(r.reason).toBe('argframe_noTemplate');
        }
        const none = buildArgFrame(argsOf('A'), null, { A: '1' });
        expect(none.ok === false && none.reason).toBe('argframe_noTemplate');
    });

    it('refuses when the payload and the declared arguments disagree', () => {
        // The independent corroboration. Two declared arguments and one payload
        // byte means we do not know what that byte is.
        const r = buildArgFrame(argsOf('A', 'B'), tel('32 05 32 00 05'), { A: '1', B: '2' });
        expect(r.ok === false && r.reason).toBe('argframe_arity');
    });

    it('refuses a template holding a value rather than a placeholder', () => {
        // Not because the byte is necessarily wrong — because we cannot say
        // which bytes are ours to fill, and "probably that one" is not a thing
        // to send to a car.
        const r = buildArgFrame(argsOf('A', 'B'), tel('32 06 32 0f 00 09'), { A: '1', B: '2' });
        expect(r.ok).toBe(false);
        if (!r.ok) {
            expect(r.reason).toBe('argframe_notPlaceholder');
            expect(r.detail).toContain('0x0f');
        }
    });

    it('refuses an argument that is not a single integer', () => {
        // STEUERN_STELLGLIED's STELLGL names a row of the STELLGLIEDER table.
        // Mapping a name to its byte is a separate piece of work with its own
        // evidence; guessing an ordinal here would be inventing the wire.
        const job = { args: [{ name: 'STELLGL', type: 'string', kind: 'enum' as const }] };
        const r = buildArgFrame(job, tel('32 05 0c 00 3b'), { STELLGL: 'HYDROPUMPE' });
        expect(r.ok).toBe(false);
        if (!r.ok) {
            expect(r.reason).toBe('argframe_argType');
            expect(r.detail).toContain('STELLGL');
        }
    });

    it('refuses a missing value, and names which one', () => {
        const r = buildArgFrame(argsOf('TESTPRG_NR', 'AUSWAHLBYTE'), tel('32 06 32 00 00 06'), {
            TESTPRG_NR: '1',
        });
        expect(r.ok === false && r.reason).toBe('argframe_missingValue');
        expect(r.ok === false && r.detail).toBe('AUSWAHLBYTE');
    });

    it('refuses a value that will not fit in its byte', () => {
        const r = buildArgFrame(argsOf('TESTPRG_NR', 'AUSWAHLBYTE'), tel('32 06 32 00 00 06'), {
            TESTPRG_NR: '1',
            AUSWAHLBYTE: '300',
        });
        expect(r.ok === false && r.reason).toBe('argframe_range');
    });

    it('never changes the address, the length or the control byte', () => {
        const r = buildArgFrame(argsOf('A', 'B'), tel('32 06 32 00 00 06'), { A: '255', B: '255' });
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect([...r.bytes.subarray(0, 3)]).toEqual([0x32, 0x06, 0x32]);
    });
});

describe('encodingBlocker — the answer a view needs before it has any values', () => {
    it('finds no obstacle for TESTPRG_STARTEN, without being handed numbers', () => {
        expect(encodingBlocker(argsOf('TESTPRG_NR', 'AUSWAHLBYTE'), tel('32 06 32 00 00 06'))).toBeNull();
    });

    it('finds none for a zero-argument job either — there is nothing to fill', () => {
        expect(encodingBlocker(argsOf(), tel('32 04 33 05'))).toBeNull();
    });

    it('gives the refusal when there is one', () => {
        expect(encodingBlocker(argsOf('A', 'B'), tel('32 05 32 00 05'))?.reason).toBe('argframe_arity');
    });
});

describe('against the shipped SMG II data', () => {
    const profile = read<EcuProfile>('smg2.jobs.json');
    const table = read<TelegramTable>('smg2.telegrams.json');
    const job = (id: string) => profile.jobs.find((j) => j.id === id) as CatalogJob;
    const first = (id: string) => (table.jobs[id] ?? [])[0] ?? null;

    it('the test-program pair is encodable exactly as shipped', () => {
        // The whole reason the wizard is buildable. If the extractor ever loses
        // these frames again, this is where it shows.
        expect(encodingBlocker(job('TESTPRG_STARTEN'), first('TESTPRG_STARTEN'))).toBeNull();
        expect(encodingBlocker(job('TESTPRG_STOP'), first('TESTPRG_STOP'))).toBeNull();
    });

    it('starts the SGBD-numbered procedure, not a neighbour', () => {
        // 0x01 is "Entlueftung Kuppl.-Nehmerzyl./Hydraulikleit." in the TESTPRG
        // table, which is where smg2-workflows.json takes its ids from.
        const r = buildArgFrame(job('TESTPRG_STARTEN'), first('TESTPRG_STARTEN'), {
            TESTPRG_NR: '0x01',
            AUSWAHLBYTE: '0',
        });
        expect(r.ok && r.hex).toBe('32 06 32 01 00 07');
    });

    it('two different procedures do not produce the same frame', () => {
        const one = buildArgFrame(job('TESTPRG_STARTEN'), first('TESTPRG_STARTEN'), { TESTPRG_NR: '1', AUSWAHLBYTE: '0' });
        const two = buildArgFrame(job('TESTPRG_STARTEN'), first('TESTPRG_STARTEN'), { TESTPRG_NR: '2', AUSWAHLBYTE: '0' });
        expect(one.ok && two.ok && one.hex).not.toBe(two.ok && two.hex);
    });

    it('refuses STEUERN_STELLGLIED, whose first argument is a table name', () => {
        expect(encodingBlocker(job('STEUERN_STELLGLIED'), first('STEUERN_STELLGLIED'))?.reason).toBe(
            'argframe_argType',
        );
    });
});

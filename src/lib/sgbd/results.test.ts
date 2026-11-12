import { describe, expect, it } from 'vitest';
import type { EcuProfile } from '../ecuCatalog';
import { PRACTICE_MODULE_BLOCK } from '../practiceEcu';
import type { TelegramTable } from '../telegrams';
import { HAVE_SHIPPED_DATA, readShipped } from '../testing/shipped';
import { answerFrame, decodeRead, foldResults, type SgbdResultsTable } from './results';

describe('folding results into values', () => {
    it('puts a unit beside its value and leaves the bookkeeping out', () => {
        const folded = foldResults([
            { name: '_TEL_ANTWORT', value: { kind: 'bytes', value: new Uint8Array([1]) } },
            { name: 'JOB_STATUS', value: { kind: 'text', value: 'OKAY' } },
            { name: 'STAT_X_WERT', value: { kind: 'int', value: 86 } },
            { name: 'STAT_X_EINH', value: { kind: 'text', value: 'Grad C' } },
            { name: 'STAT_Y_EIN', value: { kind: 'int', value: 1 } },
        ]);
        expect(folded.status).toBe('OKAY');
        expect(folded.values).toEqual([
            { name: 'STAT_X_WERT', value: 86, unit: 'Grad C' },
            { name: 'STAT_Y_EIN', value: 1, unit: null },
        ]);
    });

    it('rebuilds the line’s answer from what the link keeps', () => {
        expect(Array.from(answerFrame(0x32, 0xa0, Uint8Array.from([0x0b, 0xb8])))).toEqual([0x32, 0x06, 0xa0, 0x0b, 0xb8, 0x32 ^ 0x06 ^ 0xa0 ^ 0x0b ^ 0xb8]);
    });
});

describe.skipIf(!HAVE_SHIPPED_DATA)('SMG II’s reads, by its own SGBD code', () => {
    const table = HAVE_SHIPPED_DATA ? readShipped<SgbdResultsTable>('smg2.results.json') : null;
    const telegrams = HAVE_SHIPPED_DATA ? readShipped<TelegramTable>('smg2.telegrams.json') : null;
    const profile = HAVE_SHIPPED_DATA ? readShipped<EcuProfile>('smg2.jobs.json') : null;
    const noArgs = table ? Object.keys(table.jobs).filter((j) => j !== 'ADAPTIONSWERTE_LESEN') : [];

    it.each(noArgs)('%s reads PRACTICE’s answer to its end, every value one its catalogue declares', (job) => {
        const hex = telegrams!.jobs[job][0].hex;
        const d = decodeRead(table, job, hex, answerFrame(0x32, 0xa0, new Uint8Array(PRACTICE_MODULE_BLOCK)))!;
        expect(d.stopped).toBeNull();
        expect(d.status).toBe('OKAY');
        const declared = new Set(profile!.jobs.find((j) => j.id === job)!.results.map((r) => r.name));
        expect(d.values.filter((v) => !declared.has(v.name))).toEqual([]);
    });

    it('reads the engine speed STATUS_IO_LESEN reports from its first two bytes, in 1/min', () => {
        const payload = new Uint8Array(PRACTICE_MODULE_BLOCK);
        payload[0] = 0x0b;
        payload[1] = 0xb8;
        const d = decodeRead(table, 'STATUS_IO_LESEN', '32 05 0b 03 3f', answerFrame(0x32, 0xa0, payload))!;
        expect(d.values.find((v) => v.name === 'STAT_MOTORDREHZAHL_WERT')).toEqual({ name: 'STAT_MOTORDREHZAHL_WERT', value: 3000, unit: '1/min' });
    });

    it('says where it stopped on an answer too short, and keeps what it read', () => {
        const d = decodeRead(table, 'STATUS_IO_LESEN', '32 05 0b 03 3f', answerFrame(0x32, 0xa0, new Uint8Array(8)))!;
        expect(d.stopped?.reason).toBe('read past the end of a string');
        expect(d.values.length).toBeGreaterThan(0);
    });

    it('reads nothing for a job whose code does not ship', () => {
        expect(decodeRead(table, 'FS_LESEN', '32 05 04 01 32', answerFrame(0x32, 0xa0, new Uint8Array(4)))).toBeNull();
    });
});

import { describe, expect, it } from 'vitest';
import type { EcuProfile } from '../ecuCatalog.ts';
import { PRACTICE_MODULE_BLOCK } from '../practiceEcu.ts';
import type { TelegramTable } from '../telegrams.ts';
import { HAVE_SHIPPED_DATA, readShipped } from '../testing/shipped.ts';
import { readdirSync } from 'node:fs';
import { moduleProtocol } from '../moduleProtocol.ts';
import { SHIPPED_DATA } from '../testing/shipped.ts';
import { answerFrame, decodeFaultRead, decodeRead, foldResults, type SgbdResultsTable } from './results.ts';

describe('folding results into values', () => {
    it('puts a unit beside its value and leaves the bookkeeping out', () => {
        const folded = foldResults([
            { name: '_TEL_ANTWORT', value: { kind: 'bytes', value: new Uint8Array([1]) }, set: 0 },
            { name: 'JOB_STATUS', value: { kind: 'text', value: 'OKAY' }, set: 0 },
            { name: 'STAT_X_WERT', value: { kind: 'int', value: 86 }, set: 0 },
            { name: 'STAT_X_EINH', value: { kind: 'text', value: 'Grad C' }, set: 0 },
            { name: 'STAT_Y_EIN', value: { kind: 'int', value: 1 }, set: 0 },
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
    // FS_LESEN ships for the read its job conducts (lib/sgbd/faultRead), not for one recorded answer.
    // The SMG II reads chosen by hand (tools/gen_sgbd_results.py RESULT_JOBS). The other status reads every
    // module now carries are offered to DATALOG only where their code reads one answer cleanly (logChannels).
    const noArgs = ['STATUS_IO_LESEN', 'STATUS_IO_STATI_LESEN', 'STATUS_HARDWARE_STATI_LESEN', 'STATUS_FAHRZEUGTESTER_LESEN', 'GETRIEBEDATEN_LESEN'].filter((j) => table?.jobs[j]);

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
        expect(decodeRead(table, 'IDENT', '32 04 00 36', answerFrame(0x32, 0xa0, new Uint8Array(4)))).toBeNull();
    });
});

describe.skipIf(!HAVE_SHIPPED_DATA)('fault reads, by each module’s own FS_LESEN', () => {
    const shipped = HAVE_SHIPPED_DATA ? readdirSync(SHIPPED_DATA).filter((f) => f.endsWith('.results.json')) : [];
    const shippedWith = shipped
        .map((f) => readShipped<SgbdResultsTable>(f))
        .filter((t) => t.jobs.FS_LESEN)
        .map((t) => t.module);
    // The modules whose job sends exactly the pages the app's own frames are (#56). Every other module's
    // FS_LESEN conducts its read itself (lib/sgbd/faultRead), and is pinned in faultRead.test.ts.
    const SAME_PAGES = [
        'rdc', 'ueb2', 'ews3', 'ews3d', 'zke5', 'zke5_s12', 'kombi46', 'kombi46r', 'lsz', 'lsz_2', 'mfl', 'aic', 'rls_ds2',
        'xenon_l', 'xenon_r', 'cvm_ii', 'ihka46', 'ihka46_2', 'ihka46_3', 'pdce38', 'pdcact', 'shd46', 'shd46_2', 'radio',
        'bmbt46rn', 'bmbt46tn', 'bmbt_mir', 'bm46wide', 'navmk3', 'navmk4', 'navmk4_2', 'nav_jap', 'ses', 'videomod',
    ];
    const withFaultRead = SAME_PAGES.filter((id) => shippedWith.includes(id));
    const index = HAVE_SHIPPED_DATA ? readShipped<{ modules: { id: string; address: number }[] }>('index.json') : null;
    const pages = (id: string) => {
        const address = index!.modules.find((m) => m.id === id)!.address;
        return { address, frames: moduleProtocol(id, address, readShipped<TelegramTable>(`${id}.telegrams.json`)).faults };
    };
    const read = (id: string, payload: number[]) => {
        const { address, frames } = pages(id);
        return decodeFaultRead(
            readShipped<SgbdResultsTable>(`${id}.results.json`),
            frames.map((f) => ({ request: f.hex, answer: answerFrame(address, 0xa0, Uint8Array.from(payload)) })),
        )!;
    };

    it('ships the body, cluster, immobiliser, climate and sunroof among them (the scan of 2026-11-13 kept these as bytes)', () => {
        expect(withFaultRead.length).toBeGreaterThanOrEqual(34);
        for (const id of ['zke5', 'shd46', 'ews3', 'ihka46_2', 'kombi46']) expect(withFaultRead).toContain(id);
        // And the ones whose job sends something else first, which the job now conducts itself.
        for (const id of ['lws5', 'mrs3', 'mrs4', 'sm46c_5', 'spm46ft', 'szm46', 'alc_ds2', 'cdc_46']) expect(shippedWith).toContain(id);
    });

    it.each(withFaultRead)('%s: every page the app sends is a page its job sends, and an empty memory reads as none', (id) => {
        const d = read(id, new Array(PRACTICE_MODULE_BLOCK).fill(0));
        expect(d.stopped).toBeNull();
        expect(d.status).toBe('OKAY');
        expect(d.faults).toEqual([]);
    });

    it('reads one ZKE5 entry: its location number, the SGBD’s text for it, and its kind', () => {
        const d = read('zke5', [1, 0x10, 0x20, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0, 0, 0, 0, 0]);
        expect(d.stopped).toBeNull();
        expect(d.faults).toHaveLength(1);
        expect(d.faults[0]).toMatchObject({ code: 1, text: 'Wischer: Sicherung fuer Pumpe, Innenlicht, Verbraucherabschaltung', kinds: ['sporadischer Fehler'] });
    });

    it('says where it stopped on an answer the job cannot read to its end', () => {
        const d = read('zke5', [0]);
        expect(d.stopped).not.toBeNull();
    });
});

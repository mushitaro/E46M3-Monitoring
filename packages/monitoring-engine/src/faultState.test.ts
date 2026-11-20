import { afterEach, describe, expect, it } from 'vitest';
import { hexCode, mss54Present, presentFromKinds, savedScanFaults, toSavedScan } from './faultState.ts';
import { kwpRequest } from './kwpOnDs2.ts';
import { practiceKwpAnswer } from './practiceEcu.ts';
import { cleanAnswer, practiceCar, resetPracticeCar } from './practiceCar.ts';
import { readCutShort, scanSummary, type ScanResult, type ScanRun } from './probe/scan.ts';
import { readFaultsByJob } from './sgbd/faultRead.ts';
import { answerFrame, type SgbdResultsTable } from './sgbd/results.ts';
import { sessionFaultCount } from './sync/session.ts';
import { HAVE_SHIPPED_DATA, readShipped } from './testing/shipped.ts';

/**
 * Present now or stored, a scan's count, and a scan as a saved session keeps it (SC01, SC02, IJ16).
 */
describe('present now, in each module’s own terms', () => {
    it('reads the SGBD’s own kind words, and nothing else', () => {
        expect(presentFromKinds(['Fehler momentan vorhanden'])).toBe(true);
        expect(presentFromKinds(['Fehler momentan nicht vorhanden, aber bereits gespeichert', 'Fehler wuerde kein Aufleuchten einer Warnlampe verursachen'])).toBe(false);
        expect(presentFromKinds(['Fehler zur Zeit aktiv'])).toBe(true);
        expect(presentFromKinds(['Fehler zur Zeit nicht aktiv'])).toBe(false);
        expect(presentFromKinds(['sporadischer Fehler'])).toBeNull();
        expect(presentFromKinds([])).toBeNull();
    });

    it('MSS54: bit 6 of the type byte (FARTMATRIX A7)', () => {
        expect(mss54Present(0x08)).toBe(false);
        expect(mss54Present(0x48)).toBe(true);
    });

    it('spells codes as the catalogues do', () => {
        expect(hexCode(0x2a)).toBe('0x2A');
        expect(hexCode(0x5d8c)).toBe('0x5D8C');
    });
});

const result = (over: Partial<ScanResult>): ScanResult => ({ address: '0x00', modules: ['x'], outcome: 'answered', exchanges: [], ...over });
const sgbd = (faults: number, stopped: boolean) => ({
    module: 'rdc',
    faults: Array.from({ length: faults }, (_, i) => ({ code: 0x10 + i, text: null, kinds: ['Fehler momentan vorhanden'], values: [] })),
    status: stopped ? null : 'OKAY',
    stopped: stopped ? { at: 1, reason: 'read past the end of a string' } : null,
    provenance: 'sgbd-job' as const,
});

describe('a scan in one line, and a read cut short', () => {
    const results: ScanResult[] = [
        result({ address: '0x12', modules: ['mss54'], decoded: [{ errorCode: 0x2a, errorType: 0x08 }], variant: { sgbd: 'MSS54DS0', moduleId: 'mss54', basis: 'identified' } }),
        result({ address: '0xB8', modules: ['dsc_mk60'], sgbdFaults: { ...sgbd(2, false), module: 'dsc_mk60' } }),
        result({ address: '0x70', modules: ['rdc'], sgbdFaults: sgbd(1, true) }),
        result({ address: '0x57', modules: ['lws5'], sgbdFaults: { ...sgbd(0, false), module: 'lws5' } }),
        result({ address: '0x08', modules: ['shd46'], outcome: 'silent' }),
    ];

    it('counts the modules that answered and every fault they read, part-way reads included', () => {
        expect(scanSummary(results)).toEqual({ modules: 4, faults: 4, cutShort: 1 });
        expect(readCutShort(results[2])).toBe(true);
        expect(readCutShort(results[1])).toBe(false);
        expect(readCutShort(result({ reason: 'answered 1 of 2 frames; 70 05 04 01 got no answer' }))).toBe(true);
    });

    it('keeps every module’s codes in a saved session, and counts them over the module’s own read', () => {
        const run: ScanRun = { startedAt: 100, endedAt: 200, end: 'done', results, vin: { address: '0x80', moduleId: 'kombi46', job: 'X', outcome: 'answered', vinShort: 'JR12345' } };
        const saved = toSavedScan(run);
        expect(JSON.stringify(saved)).not.toContain('JR12345');
        expect(saved.modules.find((m) => m.address === '0x12')?.faults).toEqual([{ code: '0x2A', present: false }]);
        expect(saved.modules.find((m) => m.address === '0x70')?.cutShort).toBe(true);
        expect(saved.modules.find((m) => m.address === '0x08')?.faults).toBeNull();
        expect(savedScanFaults(saved)).toBe(4);
        // The DME's own read after the scan stands for its share: one cleared, the DSC's two stay.
        expect(sessionFaultCount({ faults: [], faultsAt: 300, scan: saved })).toBe(3);
        expect(sessionFaultCount({ faults: [], faultsAt: 50, scan: saved })).toBe(4);
        expect(sessionFaultCount({ faults: null, scan: null })).toBeNull();
    });
});

describe('the practice car: clean modules read clean by their own jobs, and the MK60 clears', () => {
    afterEach(() => resetPracticeCar());

    it.skipIf(!HAVE_SHIPPED_DATA)('ZKE5 and the 0x56 SGBDs read the clean answer as no entry, to their end', async () => {
        for (const [id, addr] of [['zke5', 0x00], ['ascmk20', 0x56], ['dsc_e46', 0x56]] as const) {
            const table = readShipped<SgbdResultsTable>(`${id}.results.json`);
            const exchange = async (control: number) =>
                control === 0x00 ? answerFrame(addr, 0xa0, new Uint8Array(20).fill(0x30)) : answerFrame(addr, 0xa0, Uint8Array.from(cleanAnswer(addr)));
            const r = await readFaultsByJob(table, id, addr, exchange, () => false);
            expect(r.read).toMatchObject({ status: 'OKAY', stopped: null, faults: [] });
        }
    });

    it('KWP 14 empties the MK60’s memory, and the next read says so', () => {
        practiceCar.dscMk60 = [{ code: 0x5d8c, status: 0x24 }];
        const frame = (data: number[]) => kwpRequest(0x29, Uint8Array.from(data));
        const clear = practiceKwpAnswer(frame([0x14, 0xff, 0xff]));
        expect(clear?.[1]?.[4]).toBe(0x54);
        expect(practiceCar.dscMk60).toEqual([]);
        const read = practiceKwpAnswer(frame([0x18, 0x02, 0xff, 0xff]));
        expect(Array.from(read?.[1]?.slice(4, 6) ?? [])).toEqual([0x58, 0x00]);
    });
});

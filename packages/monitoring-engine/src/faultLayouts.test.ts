import { describe, expect, it } from 'vitest';
import { decodeFaultRead, type FaultLayout } from './faultLayouts.ts';

/** Layouts as tools/sgbd/gen_fault_layouts.py wrote them (each agreed with EdiabasLib running the SGBD). */
const KOMBI: FaultLayout = { sgbd: 'KOMBI46', count: 'entries', start: 1, length: 3, code: 0, frequency: 2, present: { at: 1, mask: 64 }, quick: null, entries: '80 05 04 01', checked: 10 };
const MS43: FaultLayout = { sgbd: 'MS430DS0', count: 'quick', start: 1, length: 10, code: 0, frequency: 2, present: { at: 1, mask: 64 }, quick: '12 05 04 00', entries: '12 05 04 01', checked: 10 };
const DSC: FaultLayout = { sgbd: 'DSC_E46', count: 'fill', start: 0, length: 3, code: 0, frequency: 1, frequencyInverted: true, emptyIfZero: [0, 1], present: null, quick: null, entries: '56 05 04 01', checked: 10 };

describe('a fault read, where the module’s own SGBD reads it', () => {
    it('KOMBI: a count, then code, type bits, frequency', () => {
        expect(decodeFaultRead(KOMBI, [{ request: '80 05 04 01 80', response: '02 2a 40 03 11 00 01' }])).toEqual([
            { code: '0x2A', count: 3, present: true },
            { code: '0x11', count: 1, present: false },
        ]);
        expect(decodeFaultRead(KOMBI, [{ request: '80 05 04 01 80', response: '00' }])).toEqual([]);
    });
    it('MS43: the count from the quick test; nothing from a partial read', () => {
        const entries = { request: '12 05 04 01 12', response: `00 2a 40 05 ${'00 '.repeat(7)}`.trim() };
        expect(decodeFaultRead(MS43, [{ request: '12 05 04 00 13', response: '01' }, entries])).toEqual([{ code: '0x2A', count: 5, present: true }]);
        expect(decodeFaultRead(MS43, [entries])).toBeNull();
    });
    it('DSC: records fill the answer, an empty slot is skipped, the frequency is kept as its complement', () => {
        expect(decodeFaultRead(DSC, [{ request: '56 05 04 01 56', response: '2a 01 00 2b 00 00 00 11 22' }])).toEqual([{ code: '0x2A', count: 254, present: null }]);
    });
});

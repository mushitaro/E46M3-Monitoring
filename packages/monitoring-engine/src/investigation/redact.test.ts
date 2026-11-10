import { describe, expect, it } from 'vitest';
import { isIdentification, redactDeep, redactHex, redactResponse, redactRun, redactText } from './redact';

/** The VIN, taken out of what the desk reads — in bytes, in words, and whole for an identity read. */

const VIN = 'TESTV93061JR12345';
const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join(' ');

describe('an answer in bytes', () => {
    it('masks a full VIN spelled in ASCII, and leaves the bytes around it', () => {
        const r = redactHex(`a0 01 ${ascii(VIN)} 00 ff`);
        expect(r.masked).toBe(true);
        expect(r.hex).toBe(`a0 01 ${Array(17).fill('2a').join(' ')} 00 ff`);
    });

    it('masks the seven-character short form a module keeps', () => {
        const r = redactHex(`a0 ${ascii('JR12345')} 00`);
        expect(r).toEqual({ hex: `a0 ${Array(7).fill('2a').join(' ')} 00`, masked: true });
    });

    it('leaves an answer with no VIN as it was, spaced or compact', () => {
        expect(redactHex('a0 00 13 0f 7f')).toEqual({ hex: 'a0 00 13 0f 7f', masked: false });
        expect(redactHex('a000130f')).toEqual({ hex: 'a000130f', masked: false });
        expect(redactHex('not hex')).toEqual({ hex: 'not hex', masked: false });
    });

    it('withholds an identification whole, and says how long it was', () => {
        expect(isIdentification('IDENT')).toBe(true);
        expect(isIdentification('AIF_LESEN')).toBe(true);
        expect(isIdentification('C_FG_LESEN')).toBe(true);
        expect(isIdentification('FS_LESEN')).toBe(false);
        expect(isIdentification('STATUS_LESEN')).toBe(false);
        expect(redactResponse('IDENT', 'a0 01 02 03')).toEqual({ response: null, note: 'withheld: identification (4 bytes)' });
        expect(redactResponse('FS_LESEN', `a0 ${ascii(VIN)}`).note).toBe('VIN masked');
        expect(redactResponse('FS_LESEN', null)).toEqual({ response: null, note: null });
    });
});

describe('words', () => {
    it('replaces a VIN said aloud, full or short', () => {
        expect(redactText(`車台番号は ${VIN} です`)).toBe('車台番号は [VIN] です');
        expect(redactText('末尾は JR12345')).toBe('末尾は [VIN]');
    });

    it('leaves fault codes, part numbers and channels alone', () => {
        const s = 'コード 2A3F、部品 7831234、19:v と ram:FFD1A2';
        expect(redactText(s)).toBe(s);
    });

    it('reaches every string in an entry, and changes nothing else', () => {
        const body = { kind: 'note', run: 2, t: 31.5, text: `VIN ${VIN}`, via: 'voice' };
        expect(redactDeep(body)).toEqual({ ...body, text: 'VIN [VIN]' });
    });

    it('treats a run’s exchanges as reads', () => {
        const run = { n: 1, exchanges: [{ what: 'IDENT', response: 'a0 01' }, { what: 'FS_LESEN', response: 'a0 00' }] };
        expect(redactRun(run).exchanges).toEqual([
            { what: 'IDENT', response: null, redacted: 'withheld: identification (2 bytes)' },
            { what: 'FS_LESEN', response: 'a0 00' },
        ]);
    });
});

import { describe, expect, it } from 'vitest';
import { runSgbdJob } from './vm.ts';

/**
 * The instructions the car's trace does not cover (vm.test.ts covers the rest), on hand-assembled
 * code: opcode, addressing byte (high nibble the first operand), operands — the encodings the trace
 * shows. L0 = 0x18, L1 = 0x19, I0 = 0x10, B0 = 0x00, S1 = 0x1d, S2 = 0x1e, F0 = 0x24, F1 = 0x25.
 */
const L0 = 0x18, L1 = 0x19, I0 = 0x10, S1 = 0x1d, S2 = 0x1e, F0 = 0x24, F1 = 0x25;
const u32 = (v: number) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
const str = (b: number[]) => [b.length & 0xff, b.length >> 8, ...b];
const name = (s: string) => str([...Array.from(s, (c) => c.charCodeAt(0)), 0]);
const movL = (r: number, v: number) => [0x00, 0x47, r, ...u32(v)];
const op = (o: number, a: number, b: number) => [o, 0x44, a, b];
const ergi = (n: string, r: number) => [0x37, 0x83, ...name(n), r];
const ergd = (n: string, r: number) => [0x36, 0x84, ...name(n), r];
const ergr = (n: string, f: number) => [0x38, 0x81, ...name(n), f];
const eoj = [0x1d, 0x00];
const run = (code: number[], opts: Partial<Parameters<typeof runSgbdJob>[1]> = {}) => runSgbdJob({ code: Uint8Array.from(code), base: 0 }, { ...opts });
const value = (r: ReturnType<typeof run>, n: string) => (r.results.find((x) => x.name === n)!.value as { value: number }).value;

describe('integer arithmetic on the job’s own registers', () => {
    it('multiplies and divides signed, truncating toward zero', () => {
        const r = run([
            ...movL(L0, -7 >>> 0), ...movL(L1, 2), ...op(0x06, L0, L1), ...ergd('DIV', L0),
            ...movL(L0, -7 >>> 0), ...movL(L1, 3), ...op(0x05, L0, L1), ...ergd('MUL', L0),
            ...eoj,
        ]);
        expect(r.stopped).toBeNull();
        expect(value(r, 'DIV') | 0).toBe(-3);
        expect(value(r, 'MUL') | 0).toBe(-21);
    });

    it('shifts left and right, logically and arithmetically', () => {
        const r = run([
            ...movL(L0, 0x12), ...movL(L1, 8), ...op(0x1b, L0, L1), ...ergd('ASL', L0),
            ...movL(L0, 0x8000_0000), ...movL(L1, 4), ...op(0x1a, L0, L1), ...ergd('LSR', L0),
            ...movL(L0, 0x8000_0000), ...movL(L1, 4), ...op(0x18, L0, L1), ...ergd('ASR', L0),
            ...eoj,
        ]);
        expect(value(r, 'ASL')).toBe(0x1200);
        expect(value(r, 'LSR')).toBe(0x0800_0000);
        expect(value(r, 'ASR')).toBe(0xf800_0000);
    });

    it('reports an int result as signed 16-bit', () => {
        const r = run([...movL(L0, 0xfffe), ...ergi('INT', I0), ...eoj]);
        expect(value(r, 'INT')).toBe(-2);
    });
});

describe('floats', () => {
    it('converts, divides and reports a real', () => {
        const r = run([...movL(L0, 13325), [0x68, 0x34, F0, L0], ...movL(L0, 1000), [0x68, 0x34, F1, L0], [0x3e, 0x11, F0, F1], ...ergr('UBAT', F0), ...eoj].flat());
        expect(value(r, 'UBAT')).toBeCloseTo(13.325, 6);
    });

    it('stops, keeping what it had, on a division by zero', () => {
        const r = run([...ergi('BEFORE', I0), ...movL(L0, 0), [0x68, 0x34, F1, L0], [0x3e, 0x11, F0, F1], ...ergr('X', F0), ...eoj].flat());
        expect(r.results.map((x) => x.name)).toEqual(['BEFORE']);
        expect(r.stopped?.reason).toBe('division by zero');
    });
});

describe('arguments and the send', () => {
    // parl L0, #1 ; jz error ; move S1, {32 05 40 00} ; move S1[#3], B0 ; xsend S2, S1 ; eoj
    const job = (tail: number[] = []) => [
        0x57, 0x47, L0, ...u32(1),
        0x10, 0x70, ...u32(9 + 6 + 4 + tail.length + 2),
        0x00, 0x18, S1, ...str([0x32, 0x05, 0x40, 0x00]),
        0x00, 0x92, S1, 3, 0, 0x00,
        0x2a, 0x11, S2, S1,
        ...tail,
        ...eoj,
        ...ergi('NO_ARGUMENT', I0), ...eoj,
    ];

    it('builds the frame from its argument in a dry run, and stops at the send', () => {
        const r = run(job(), { args: ['1'] });
        expect(Array.from(r.request ?? [])).toEqual([0x32, 0x05, 0x40, 0x01]);
        expect(r.stopped).toBeNull();
    });

    it('takes the job’s own error path when the argument is missing', () => {
        const r = run(job(), {});
        expect(r.request).toBeNull();
        expect(r.results.map((x) => x.name)).toEqual(['NO_ARGUMENT']);
    });

    it('refuses an answer to a frame the job would not have sent', () => {
        const r = run(job(), { args: ['2'], sent: Uint8Array.from([0x32, 0x05, 0x40, 0x01, 0x76]), answer: Uint8Array.from([0x32, 0x04, 0xa0, 0x96]) });
        expect(r.stopped?.reason).toBe('the job would send 32 05 40 02, not 32 05 40 01');
    });

    it('hands the job the answer when the frame is its own', () => {
        const answer = Uint8Array.from([0x32, 0x05, 0xa0, 0x2a, 0xbd]);
        // move B0, S2[#3] ; ergi "BYTE", I0 — read the answer's first data byte
        const r = run(job([0x01, 0x40, L0, 0x00, 0x29, 0x00, S2, 3, 0, ...ergi('BYTE', I0)]), { args: ['2'], sent: Uint8Array.from([0x32, 0x05, 0x40, 0x02, 0x75]), answer });
        expect(r.stopped).toBeNull();
        expect(value(r, 'BYTE')).toBe(0x2a);
    });
});

describe('a job that asks page by page, one result set per entry', () => {
    // move S1, {32 05 04 0p} ; xsend S2, S1 ; clear L0 ; move B0, S2[#3] ; ergi NAME, I0
    const page = (p: number, n: string) => [
        0x00, 0x18, S1, ...str([0x32, 0x05, 0x04, p]),
        0x2a, 0x11, S2, S1,
        0x01, 0x40, L0, 0x00, 0x29, 0x00, S2, 3, 0, ...ergi(n, I0),
    ];
    const enewset = [0x40, 0x00];
    const job = [...page(0, 'FIRST'), ...enewset, ...page(1, 'SECOND'), ...eoj];
    const frame = (b: number[]) => Uint8Array.from([...b, b.reduce((x, y) => x ^ y, 0)]);
    const sent0 = frame([0x32, 0x05, 0x04, 0x00]);
    const sent1 = frame([0x32, 0x05, 0x04, 0x01]);
    const answer = (d: number) => frame([0x32, 0x05, 0xa0, d]);

    it('gives each send the answer the app got for it, in order, and opens a new set at enewset', () => {
        const r = run(job, { exchanges: [{ sent: sent0, answer: answer(0x11) }, { sent: sent1, answer: answer(0x22) }] });
        expect(r.stopped).toBeNull();
        expect(r.results.map((x) => [x.name, (x.value as { value: number }).value, x.set])).toEqual([
            ['FIRST', 0x11, 0],
            ['SECOND', 0x22, 1],
        ]);
    });

    it('stops at a send the app did not make, keeping what came before', () => {
        const r = run(job, { exchanges: [{ sent: sent0, answer: answer(0x11) }] });
        expect(r.results.map((x) => x.name)).toEqual(['FIRST']);
        expect(r.stopped?.reason).toBe('a second send');
    });

    it('stops when a later page is not the one the app sent', () => {
        const r = run(job, { exchanges: [{ sent: sent0, answer: answer(0x11) }, { sent: sent0, answer: answer(0x22) }] });
        expect(r.stopped?.reason).toBe('the job would send 32 05 04 01, not 32 05 04 00');
    });
});

describe('the upper register file and the trap mask (DSC_MK60’s FS_LESEN)', () => {
    const L4 = 0x98, L6 = 0x9a, I8 = 0x90;

    it('keeps L4..L7 apart from L0..L3, with I8.. over the same bytes as L4', () => {
        const r = run([...movL(L0, 1), ...movL(L4, 0x1122_3344), ...movL(L6, 7), ...ergd('L0', L0), ...ergd('L4', L4), ...ergd('L6', L6), ...ergi('I8', I8), ...eoj]);
        expect(r.stopped).toBeNull();
        expect(value(r, 'L0')).toBe(1);
        expect(value(r, 'L4')).toBe(0x1122_3344);
        expect(value(r, 'L6')).toBe(7);
        expect(value(r, 'I8')).toBe(0x3344);
    });

    it('sets and reads back the trap mask; with no trap marked, jt does not jump', () => {
        const settmr = [0x44, 0x70, ...u32(0x400)];
        const gettmr = [0x43, 0x40, L6];
        const clrt = [0x46, 0x00];
        const skip = ergi('SKIPPED', I0);
        const jt = [0x47, 0x77, ...u32(skip.length), ...u32(10)];
        const r = run([...settmr, ...gettmr, ...ergd('MASK', L6), ...clrt, ...jt, ...skip, ...eoj]);
        expect(r.stopped).toBeNull();
        expect(value(r, 'MASK')).toBe(0x400);
        expect(r.results.map((x) => x.name)).toContain('SKIPPED');
    });
});

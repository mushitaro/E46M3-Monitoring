/**
 * Reading a module's answer the way its own SGBD reads it.
 *
 * The SGBD job that sends a request also turns the answer into named results (`STAT_…_WERT`,
 * `…_EINH`). That code is BEST/2 bytecode in the `.prg`; nowhere else says which byte is which
 * value, with what scale. Rather than copy those offsets out by hand — the error-prone step this
 * repo keeps refusing — this runs the job's own code on the bytes the module sent, and keeps what it
 * reports.
 *
 * ## What it is, and what it is not
 *
 * A small interpreter for the subset of BEST/2 that read jobs use to build results: moves between
 * registers, strings and the stack; integer and float arithmetic; the flag-driven jumps the compiler
 * emits for signs and conditions; result output; the result-status table lookup. It runs the job
 * from its first instruction. At the send it checks that the frame the job would send is the frame
 * the app sent — if not, it stops: the answer is not this job's — and hands the job the answer.
 *
 * It has no connection, no file access and no way to send anything: the send is the one instruction
 * it answers itself, with bytes the app already holds — once per exchange the app made, each checked
 * against the frame the job builds. Anything outside the subset (a send the app did not make, a call,
 * an instruction it does not model) stops the run, and the results reported until
 * then are kept with the reason it stopped. A result the job did not reach is not invented.
 *
 * ## Where the semantics come from
 *
 * The register file, the stack, the operand encodings and the flags are checked instruction by
 * instruction against a real EdiabasLib trace of MSS54DS0's IDENT on the car (the private data
 * repository's `evidence/ifh.trc`; `vm.test.ts`): every address visited and every result value. That
 * trace covers the moves, the stack, `comp`, `adds`, `and`, `or`, `asr`, the string operations and
 * the table lookup. Multiplication, division, the other shifts and the float operations are not in
 * it; they follow EDIABAS's documented meaning and are tested on their own.
 */

export type ResultValue =
    | { kind: 'int' | 'word' | 'byte' | 'dword' | 'long'; value: number }
    | { kind: 'real'; value: number }
    | { kind: 'text'; value: string }
    | { kind: 'bytes'; value: Uint8Array };

export interface SgbdResult {
    name: string;
    value: ResultValue;
    /**
     * Which result set it went into: 0 until the job's first `enewset`, then one more for each. A
     * fault read opens a set per entry, so the entries' names repeat and the set tells them apart.
     */
    set: number;
}

export interface SgbdJobCode {
    /** The job's bytecode, already de-scrambled (XOR 0xF7 removed). */
    code: Uint8Array;
    /** The PRG address of `code[0]` — jumps are relative, but reports name addresses. */
    base: number;
}

export interface SgbdRun {
    results: SgbdResult[];
    /**
     * The frame the job built for its send, without the checksum the interface appends. In a dry run
     * (no `sent`) the run ends there: that frame is what the job would send with these arguments.
     */
    request: Uint8Array | null;
    /** Why the run ended before `eoj`, or null when it reached it. */
    stopped: { at: number; reason: string } | null;
}

export type SgbdTables = Readonly<Record<string, readonly (readonly string[])[]>>;

const MAX_STEPS = 200_000;
const OP = {
    move: 0x00, clear: 0x01, comp: 0x02, subb: 0x03, adds: 0x04, mult: 0x05, divs: 0x06, and: 0x07, or: 0x08, xor: 0x09,
    not: 0x0a, jump: 0x0b, jc: 0x0e, jae: 0x0f, jz: 0x10, jnz: 0x11, jmi: 0x14, jpl: 0x15, clrc: 0x16, setc: 0x17,
    asr: 0x18, lsl: 0x19, lsr: 0x1a, asl: 0x1b, nop: 0x1c, eoj: 0x1d, push: 0x1e, pop: 0x1f, scat: 0x21, slen: 0x23,
    serase: 0x25, xsend: 0x2a, ergb: 0x34, ergw: 0x35, ergd: 0x36, ergi: 0x37, ergr: 0x38, ergs: 0x39, a2flt: 0x3a,
    fadd: 0x3b, fsub: 0x3c, fmul: 0x3d, fdiv: 0x3e, ergy: 0x3f, enewset: 0x40, etag: 0x41, atsp: 0x50, jg: 0x5a, jge: 0x5b, jl: 0x5c,
    jle: 0x5d, ja: 0x5e, jbe: 0x5f, parb: 0x55, parw: 0x56, parl: 0x57, pars: 0x58, a2fix: 0x67, fix2flt: 0x68, fix2hex: 0x79, fix2dez: 0x7a, tabset: 0x7b,
    tabseek: 0x7c, tabget: 0x7d, strcat: 0x7e, ergl: 0x82, strcmp: 0x8f,
    scmp: 0x20, gettmr: 0x43, settmr: 0x44, clrt: 0x46, jt: 0x47, wait: 0x6b,
} as const;

type Reg =
    | { t: 'num'; at: number; width: 1 | 2 | 4 }
    | { t: 'str'; n: number }
    | { t: 'flt'; n: number };

function regOf(code: number): Reg | null {
    if (code <= 0x0f) return { t: 'num', at: code, width: 1 };
    if (code <= 0x17) return { t: 'num', at: (code - 0x10) * 2, width: 2 };
    if (code <= 0x1b) return { t: 'num', at: (code - 0x18) * 4, width: 4 };
    if (code <= 0x23) return { t: 'str', n: code - 0x1c };
    if (code <= 0x2b) return { t: 'flt', n: code - 0x24 };
    if (code <= 0x33) return { t: 'str', n: 8 + (code - 0x2c) };
    // The upper half of the register file (EdiabasLib's EdiabasNet register table): A0..AF are bytes
    // 16..31, I8..IF and L4..L7 overlay them. DSC_MK60's FS_LESEN keeps a count in L6.
    if (code >= 0x80 && code <= 0x8f) return { t: 'num', at: 16 + (code - 0x80), width: 1 };
    if (code >= 0x90 && code <= 0x97) return { t: 'num', at: 16 + (code - 0x90) * 2, width: 2 };
    if (code >= 0x98 && code <= 0x9b) return { t: 'num', at: 16 + (code - 0x98) * 4, width: 4 };
    return null;
}

/** An operand as decoded: where its value lives, or the value itself. */
type Operand =
    | { m: 'none' }
    | { m: 'reg'; r: Reg }
    | { m: 'imm'; v: number; width: 1 | 2 | 4 }
    | { m: 'str'; v: Uint8Array }
    | { m: 'idx'; s: number; index: () => number; len?: () => number };

class Stop extends Error {}

const u = (v: number, width: number) => (width === 4 ? v >>> 0 : v & (width === 2 ? 0xffff : 0xff));
const signed = (v: number, width: number) => {
    const x = u(v, width);
    const top = 2 ** (width * 8 - 1);
    return x >= top ? x - 2 * top : x;
};
const latin1 = (b: Uint8Array) => {
    let s = '';
    for (const c of b) {
        if (c === 0) break;
        s += String.fromCharCode(c);
    }
    return s;
};
const fromLatin1 = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff);

export interface SgbdRunOptions {
    /**
     * The frame the app sent, checksum included. Absent: a dry run, which stops at the send and
     * reports the frame the job built (`request`) — how an argument-taking job's frame is made by the
     * job itself rather than by filling a template here.
     */
    sent?: Uint8Array;
    /** The module's answer as it came off the line: address, length, status, data, checksum. Required with `sent`. */
    answer?: Uint8Array;
    /**
     * Every exchange the app made for the job, in order, when it sends more than once (a fault read
     * asks page by page). Each send of the job is checked against the next one and gets its answer.
     * Given, it stands in for `sent` and `answer`.
     */
    exchanges?: readonly { sent: Uint8Array; answer: Uint8Array }[];
    tables?: SgbdTables;
    /** The job's arguments, as EDIABAS takes them: strings, first argument first. */
    args?: readonly string[];
    /** Each instruction's PRG address before it runs — for checking against a trace. */
    onStep?: (address: number) => void;
}

/**
 * The interpreter, as a generator: each send yields the frame the job built (no checksum) and takes
 * back the module's answer as it came off the line, or null to end a dry run there. `runSgbdJob`
 * drives it for one recorded exchange; `runSgbdJobLive` for a read the job itself conducts.
 */
function* jobSteps(job: SgbdJobCode, opts: SgbdRunOptions): Generator<Uint8Array, SgbdRun, Uint8Array | null> {
    const { code, base } = job;
    const tables = opts.tables ?? {};
    let trapMask = 0;
    let trap = 0;
    const bytes = new Uint8Array(32); // B0..BF and A0..AF; I0..IF and L0..L7 overlay these, little-endian
    const strings: Uint8Array[] = Array.from({ length: 16 }, () => new Uint8Array(0));
    const floats = new Float64Array(8);
    const stack: number[] = [];
    const results: SgbdResult[] = [];
    const flags = { z: false, s: false, c: false, v: false };
    let table: readonly (readonly string[])[] | null = null;
    let row = -1;
    let request: Uint8Array | null = null;
    let set = 0;
    let pc = 0;

    const getNum = (r: Extract<Reg, { t: 'num' }>) => {
        let v = 0;
        for (let i = r.width - 1; i >= 0; i--) v = v * 256 + bytes[r.at + i];
        return v;
    };
    const setNum = (r: Extract<Reg, { t: 'num' }>, v: number) => {
        const x = u(v, r.width);
        for (let i = 0; i < r.width; i++) bytes[r.at + i] = Math.floor(x / 256 ** i) & 0xff;
    };
    const setFlags = (v: number, width: number) => {
        flags.z = u(v, width) === 0;
        flags.s = signed(v, width) < 0;
    };

    const fail = (reason: string): never => {
        throw new Stop(reason);
    };

    function operand(mode: number): Operand {
        const rd8 = () => {
            if (pc >= code.length) fail('ran off the job');
            return code[pc++];
        };
        const rd16 = () => rd8() | (rd8() << 8);
        const rd32 = () => (rd16() | (rd16() << 16)) >>> 0;
        const reg = () => {
            const c = rd8();
            const r = regOf(c);
            if (!r) fail(`register 0x${c.toString(16)}`);
            return r!;
        };
        const strReg = () => {
            const r = reg();
            if (r.t !== 'str') fail('an index into a non-string');
            return (r as Extract<Reg, { t: 'str' }>).n;
        };
        const numValue = (r: Reg) => (r.t === 'num' ? () => getNum(r) : fail('an index register that is not a number'));
        switch (mode) {
            case 0:
                return { m: 'none' };
            case 1:
            case 2:
            case 3:
            case 4:
                return { m: 'reg', r: reg() };
            case 5:
                return { m: 'imm', v: rd8(), width: 1 };
            case 6:
                return { m: 'imm', v: rd16(), width: 2 };
            case 7:
                return { m: 'imm', v: rd32(), width: 4 };
            case 8: {
                const n = rd16();
                const v = code.slice(pc, pc + n);
                pc += n;
                return { m: 'str', v };
            }
            case 9: {
                const s = strReg();
                const i = rd16();
                return { m: 'idx', s, index: () => i };
            }
            case 10: {
                const s = strReg();
                const ir = numValue(reg());
                return { m: 'idx', s, index: ir };
            }
            case 11: {
                const s = strReg();
                const ir = numValue(reg());
                const i = rd16();
                return { m: 'idx', s, index: () => ir() + i };
            }
            case 12: {
                const s = strReg();
                const i = rd16();
                const l = rd16();
                return { m: 'idx', s, index: () => i, len: () => l };
            }
            case 13: {
                const s = strReg();
                const i = rd16();
                const lr = numValue(reg());
                return { m: 'idx', s, index: () => i, len: lr };
            }
            case 14: {
                const s = strReg();
                const ir = numValue(reg());
                const l = rd16();
                return { m: 'idx', s, index: ir, len: () => l };
            }
            case 15: {
                const s = strReg();
                const ir = numValue(reg());
                const lr = numValue(reg());
                return { m: 'idx', s, index: ir, len: lr };
            }
        }
        return fail(`addressing mode ${mode}`);
    }

    /** The width an operand has as a number, if it has one of its own. */
    const widthOf = (o: Operand): number | null => (o.m === 'reg' && o.r.t === 'num' ? o.r.width : o.m === 'imm' ? o.width : null);

    function readNum(o: Operand, width: number): number {
        if (o.m === 'reg' && o.r.t === 'num') return getNum(o.r);
        if (o.m === 'imm') return o.v;
        if (o.m === 'idx' && !o.len) {
            const s = strings[o.s];
            const i = o.index();
            let v = 0;
            for (let k = width - 1; k >= 0; k--) v = v * 256 + (s[i + k] ?? 0);
            if (i + width > s.length) fail('read past the end of a string');
            return v;
        }
        return fail('a number from a non-number');
    }
    function readStr(o: Operand): Uint8Array {
        if (o.m === 'str') return o.v;
        if (o.m === 'reg' && o.r.t === 'str') return strings[o.r.n];
        if (o.m === 'idx') {
            const s = strings[o.s];
            const i = o.index();
            const l = o.len ? o.len() : 1;
            if (i + l > s.length) fail('read past the end of a string');
            return s.slice(i, i + l);
        }
        return fail('a string from a non-string');
    }
    function writeNum(o: Operand, v: number, width: number) {
        if (o.m === 'reg' && o.r.t === 'num') return setNum(o.r, v);
        if (o.m === 'idx' && !o.len) {
            const i = o.index();
            const s = strings[o.s];
            const out = new Uint8Array(Math.max(s.length, i + width));
            out.set(s);
            const x = u(v, width);
            for (let k = 0; k < width; k++) out[i + k] = Math.floor(x / 256 ** k) & 0xff;
            strings[o.s] = out;
            return;
        }
        fail('a number into a non-number');
    }

    const numOrFail = (o: Operand) => (o.m === 'reg' && o.r.t === 'num' ? o.r : fail('arithmetic on a non-number'));
    const fltOrFail = (o: Operand) => (o.m === 'reg' && o.r.t === 'flt' ? o.r.n : fail('float arithmetic on a non-float'));
    const resultName = (o: Operand) => latin1(readStr(o));
    const jumpTo = (o: Operand) => {
        if (o.m !== 'imm' || o.width !== 4) fail('a jump without a target');
        const t = pc + ((o as { v: number }).v | 0);
        if (t < 0 || t >= code.length) fail('a jump out of the job');
        pc = t;
    };

    try {
        for (let steps = 0; steps < MAX_STEPS; steps++) {
            const at = pc;
            if (pc + 2 > code.length) fail('ran off the job');
            const op = code[pc];
            const mode = code[pc + 1];
            pc += 2;
            opts.onStep?.(base + at);
            const a = operand(mode >> 4);
            const b = operand(mode & 0x0f);

            switch (op) {
                case OP.nop:
                case OP.clrc:
                case OP.setc:
                // A pause between sends: the app keeps the line's own timing, a replay has none to keep.
                case OP.wait:
                    break;
                // The trap mask (EDIABAS's `tmr`): a bit set lets the error of that number mark a trap and
                // go on, where it would end the job. Here no error goes on — the run stops with its
                // reason — so no trap is ever marked and `jt` (jump on trap n) never jumps. DSC_MK60's
                // FS_LESEN guards its table lookups this way (settmr 0x400; jt …, 10).
                case OP.gettmr: {
                    const r = numOrFail(a);
                    setNum(r, trapMask);
                    break;
                }
                case OP.settmr:
                    trapMask = u(readNum(a, 4), 4);
                    break;
                case OP.clrt:
                    trap = 0;
                    break;
                case OP.jt:
                    if (trap !== 0 && trap === readNum(b, 4)) jumpTo(a);
                    break;
                case OP.scmp: {
                    // Z on equal strings. Not measured on a trace: its one use in the shipped jobs only
                    // decides whether the raw answer (`_TEL_ANTWORT`) is reported.
                    flags.z = latin1(readStr(a)) === latin1(readStr(b));
                    break;
                }
                case OP.eoj:
                    return { results, request, stopped: null };

                case OP.move: {
                    if (a.m === 'reg' && a.r.t === 'str') {
                        strings[a.r.n] = readStr(b).slice();
                    } else if (a.m === 'reg' && a.r.t === 'flt') {
                        floats[a.r.n] = b.m === 'reg' && b.r.t === 'flt' ? floats[b.r.n] : fail('a float from a non-float');
                    } else if (a.m === 'idx' && a.len) {
                        // A substring written into a string.
                        const src = readStr(b);
                        const i = a.index();
                        const s = strings[a.s];
                        const out = new Uint8Array(Math.max(s.length, i + src.length));
                        out.set(s);
                        out.set(src, i);
                        strings[a.s] = out;
                    } else {
                        const width = widthOf(a) ?? widthOf(b) ?? fail('a move with no width');
                        const v = readNum(b, width);
                        writeNum(a, v, width);
                        setFlags(v, width);
                    }
                    break;
                }
                case OP.clear: {
                    if (a.m === 'reg' && a.r.t === 'str') strings[a.r.n] = new Uint8Array(0);
                    else if (a.m === 'reg' && a.r.t === 'flt') floats[a.r.n] = 0;
                    else if (a.m === 'reg' && a.r.t === 'num') setNum(a.r, 0);
                    else fail('clear of a non-register');
                    break;
                }
                case OP.push: {
                    const width = widthOf(a) ?? fail('push with no width');
                    const v = u(readNum(a, width), width);
                    for (let k = width - 1; k >= 0; k--) stack.push(Math.floor(v / 256 ** k) & 0xff);
                    break;
                }
                case OP.pop: {
                    const r = numOrFail(a);
                    if (stack.length < r.width) fail('pop from an empty stack');
                    let v = 0;
                    for (let k = 0; k < r.width; k++) v += stack.pop()! * 256 ** k;
                    setNum(r, v);
                    setFlags(v, r.width);
                    break;
                }
                case OP.atsp: {
                    // dest <- the item `offset` bytes below the top of the stack.
                    const r = numOrFail(a);
                    const off = readNum(b, 4);
                    const start = stack.length - off;
                    if (start < 0 || start + r.width > stack.length) fail('atsp outside the stack');
                    let v = 0;
                    for (let k = 0; k < r.width; k++) v = v * 256 + stack[start + k];
                    setNum(r, v);
                    setFlags(v, r.width);
                    break;
                }

                case OP.comp:
                case OP.subb:
                case OP.adds:
                case OP.mult:
                case OP.divs:
                case OP.and:
                case OP.or:
                case OP.xor:
                case OP.asr:
                case OP.asl:
                case OP.lsl:
                case OP.lsr: {
                    // `comp` only reads its first operand, so it may be a byte of a string (DSC_MK60's
                    // FS_LESEN: `comp S3[2], 0x7f`, a negative answer), as wide as the second operand.
                    const indexed = op === OP.comp && a.m === 'idx';
                    const r = indexed ? null : numOrFail(a);
                    const w = r ? r.width : (widthOf(b) ?? 1);
                    const x = r ? getNum(r) : u(readNum(a, w), w);
                    const y = u(readNum(b, w), w);
                    const sx = signed(x, w);
                    const sy = signed(y, w);
                    let v: number;
                    switch (op) {
                        case OP.comp:
                        case OP.subb: {
                            v = x - y;
                            flags.c = y > x;
                            const sv = sx - sy;
                            flags.v = sv !== signed(v, w);
                            break;
                        }
                        case OP.adds: {
                            v = x + y;
                            flags.c = v > u(-1, w);
                            flags.v = sx + sy !== signed(v, w);
                            break;
                        }
                        case OP.mult:
                            v = Number(BigInt.asIntN(64, BigInt(sx) * BigInt(sy)) & BigInt(2 ** (w * 8) - 1));
                            break;
                        case OP.divs:
                            if (sy === 0) fail('division by zero');
                            v = Math.trunc(sx / sy);
                            break;
                        case OP.and:
                            v = Number(BigInt(x) & BigInt(y));
                            break;
                        case OP.or:
                            v = Number(BigInt(x) | BigInt(y));
                            break;
                        case OP.xor:
                            v = Number(BigInt(x) ^ BigInt(y));
                            break;
                        case OP.asr:
                            v = y >= w * 8 ? (sx < 0 ? -1 : 0) : Math.floor(sx / 2 ** y);
                            break;
                        case OP.lsr:
                            v = y >= w * 8 ? 0 : Math.floor(x / 2 ** y);
                            break;
                        default: // asl, lsl
                            v = y >= w * 8 ? 0 : x * 2 ** y;
                    }
                    setFlags(v, w);
                    if (r && op !== OP.comp) setNum(r, v);
                    break;
                }
                case OP.not: {
                    const r = numOrFail(a);
                    const v = ~getNum(r);
                    setNum(r, v);
                    setFlags(v, r.width);
                    break;
                }

                case OP.jump:
                    jumpTo(a);
                    break;
                case OP.jz:
                case OP.jnz:
                case OP.jc:
                case OP.jae:
                case OP.jmi:
                case OP.jpl:
                case OP.jg:
                case OP.jge:
                case OP.jl:
                case OP.jle:
                case OP.ja:
                case OP.jbe: {
                    const lt = flags.s !== flags.v;
                    const take = {
                        [OP.jz]: flags.z,
                        [OP.jnz]: !flags.z,
                        [OP.jc]: flags.c,
                        [OP.jae]: !flags.c,
                        [OP.jmi]: flags.s,
                        [OP.jpl]: !flags.s,
                        [OP.jg]: !flags.z && !lt,
                        [OP.jge]: !lt,
                        [OP.jl]: lt,
                        [OP.jle]: flags.z || lt,
                        [OP.ja]: !flags.c && !flags.z,
                        [OP.jbe]: flags.c || flags.z,
                    }[op];
                    if (take) jumpTo(a);
                    break;
                }

                case OP.xsend: {
                    const req = readStr(b);
                    if (request === null) request = req.slice();
                    if (a.m !== 'reg' || a.r.t !== 'str') fail('a send into a non-string');
                    const answer: Uint8Array | null = yield req.slice();
                    if (answer === null) return { results, request, stopped: null };
                    strings[(a as { r: { n: number } }).r.n] = answer.slice();
                    break;
                }
                case OP.enewset:
                    // The results from here on are the next set (EDIABAS: one set per fault entry).
                    set++;
                    break;
                case OP.strcat: {
                    // Text joined as text: the first string up to its terminator, then the second, terminated.
                    if (a.m !== 'reg' || a.r.t !== 'str') fail('strcat into a non-string');
                    const n = (a as { r: { n: number } }).r.n;
                    strings[n] = fromLatin1(latin1(strings[n]) + latin1(readStr(b)) + '\0');
                    break;
                }

                case OP.parb:
                case OP.parw:
                case OP.parl: {
                    // Argument n (from 1) as a number. Absent or not a number: Z set, as the jobs read it
                    // (`parl L0, #1` then `jz` to their parameter error).
                    const r = numOrFail(a);
                    const n = readNum(b, 4);
                    const text = (opts.args ?? [])[n - 1]?.trim() ?? '';
                    const v = /^0x[0-9a-f]+$/i.test(text) ? parseInt(text, 16) : /^[+-]?\d+$/.test(text) ? parseInt(text, 10) : null;
                    if (v === null) {
                        flags.z = true;
                    } else {
                        setNum(r, v);
                        flags.z = false;
                        flags.s = signed(v, r.width) < 0;
                    }
                    break;
                }
                case OP.pars: {
                    if (a.m !== 'reg' || a.r.t !== 'str') fail('pars into a non-string');
                    const n = readNum(b, 4);
                    const text = (opts.args ?? [])[n - 1];
                    strings[(a as { r: { n: number } }).r.n] = fromLatin1(text ?? '');
                    flags.z = text === undefined;
                    break;
                }
                case OP.etag:
                    // Every result is asked for: a tag never skips its block.
                    break;
                case OP.ergb:
                case OP.ergw:
                case OP.ergd:
                case OP.ergi:
                case OP.ergl: {
                    const kind = ({ [OP.ergb]: 'byte', [OP.ergw]: 'word', [OP.ergd]: 'dword', [OP.ergi]: 'int', [OP.ergl]: 'long' } as const)[op];
                    const width = { byte: 1, word: 2, dword: 4, int: 2, long: 4 }[kind];
                    const raw = readNum(b, widthOf(b) ?? width);
                    const value = kind === 'int' || kind === 'long' ? signed(raw, width) : u(raw, width);
                    results.push({ name: resultName(a), value: { kind, value }, set });
                    break;
                }
                case OP.ergr:
                    results.push({ name: resultName(a), value: { kind: 'real', value: floats[fltOrFail(b)] }, set });
                    break;
                case OP.ergs:
                    results.push({ name: resultName(a), value: { kind: 'text', value: latin1(readStr(b)) }, set });
                    break;
                case OP.ergy:
                    results.push({ name: resultName(a), value: { kind: 'bytes', value: readStr(b).slice() }, set });
                    break;

                case OP.fix2flt: {
                    const r = b.m === 'reg' && b.r.t === 'num' ? b.r : fail('fix2flt from a non-number');
                    floats[fltOrFail(a)] = signed(getNum(r), r.width);
                    break;
                }
                case OP.a2flt: {
                    const n = Number(latin1(readStr(b)).trim());
                    floats[fltOrFail(a)] = Number.isFinite(n) ? n : 0;
                    break;
                }
                case OP.fadd:
                case OP.fsub:
                case OP.fmul:
                case OP.fdiv: {
                    const x = fltOrFail(a);
                    const y = floats[fltOrFail(b)];
                    if (op === OP.fdiv && y === 0) fail('division by zero');
                    floats[x] = op === OP.fadd ? floats[x] + y : op === OP.fsub ? floats[x] - y : op === OP.fmul ? floats[x] * y : floats[x] / y;
                    break;
                }
                case OP.a2fix: {
                    const r = numOrFail(a);
                    // The whole string or nothing: on the car's trace, "1B" became 0, not 1.
                    const s = latin1(readStr(b)).trim();
                    const n = /^0x[0-9a-f]+$/i.test(s) ? parseInt(s, 16) : /^[+-]?\d+$/.test(s) ? parseInt(s, 10) : 0;
                    setNum(r, n);
                    setFlags(n, r.width);
                    break;
                }
                case OP.fix2hex:
                case OP.fix2dez: {
                    if (a.m !== 'reg' || a.r.t !== 'str') fail('fix2hex into a non-string');
                    const width = widthOf(b) ?? fail('fix2hex with no width');
                    const v = readNum(b, width);
                    const text =
                        op === OP.fix2hex ? `0x${u(v, width).toString(16).toUpperCase().padStart(width * 2, '0')}` : String(signed(v, width));
                    strings[(a as { r: { n: number } }).r.n] = fromLatin1(text);
                    break;
                }
                case OP.slen: {
                    const r = numOrFail(a);
                    const n = readStr(b).length;
                    setNum(r, n);
                    setFlags(n, r.width);
                    break;
                }
                case OP.scat: {
                    if (a.m !== 'reg' || a.r.t !== 'str') fail('scat into a non-string');
                    const n = (a as { r: { n: number } }).r.n;
                    const add = readStr(b);
                    const out = new Uint8Array(strings[n].length + add.length);
                    out.set(strings[n]);
                    out.set(add, strings[n].length);
                    strings[n] = out;
                    break;
                }
                case OP.serase: {
                    // S[i],len (or S[i]: one byte) removed from the string.
                    if (a.m !== 'idx') fail('serase of a non-index');
                    const o = a as Extract<Operand, { m: 'idx' }>;
                    const i = o.index();
                    const l = o.len ? o.len() : 1;
                    const s = strings[o.s];
                    strings[o.s] = Uint8Array.from([...s.slice(0, i), ...s.slice(i + l)]);
                    break;
                }
                case OP.strcmp: {
                    // Measured on the car's trace: equal strings leave Z clear.
                    const x = latin1(readStr(a));
                    const y = latin1(readStr(b));
                    flags.z = x !== y;
                    break;
                }
                case OP.tabset: {
                    const name = latin1(readStr(a)).toUpperCase();
                    const key = Object.keys(tables).find((k) => k.toUpperCase() === name);
                    table = key ? tables[key] : fail(`table ${name} is not shipped`);
                    row = -1;
                    break;
                }
                case OP.tabseek: {
                    // Measured on the car's trace: a row found leaves Z clear. Not found, EDIABAS
                    // stands on the table's last row (its default) and sets Z.
                    if (!table) fail('tabseek with no table');
                    const t = table!;
                    const col = t[0].findIndex((c) => c.toUpperCase() === latin1(readStr(a)).toUpperCase());
                    if (col < 0) fail('tabseek on a missing column');
                    const want = latin1(readStr(b)).toUpperCase();
                    const hit = t.findIndex((r, i) => i > 0 && (r[col] ?? '').toUpperCase() === want);
                    row = hit > 0 ? hit : t.length - 1;
                    flags.z = hit <= 0;
                    break;
                }
                case OP.tabget: {
                    if (!table || row < 1) fail('tabget with no row');
                    if (a.m !== 'reg' || a.r.t !== 'str') fail('tabget into a non-string');
                    const t = table!;
                    const col = t[0].findIndex((c) => c.toUpperCase() === latin1(readStr(b)).toUpperCase());
                    if (col < 0) fail('tabget on a missing column');
                    strings[(a as { r: { n: number } }).r.n] = fromLatin1(t[row][col] ?? '');
                    break;
                }
                default:
                    fail(`instruction 0x${op.toString(16)}`);
            }
        }
        fail('too many steps');
    } catch (e) {
        if (e instanceof Stop) return { results, request, stopped: { at: base + pc, reason: e.message } };
        throw e;
    }
    return { results, request, stopped: null };
}


/**
 * One recorded exchange: the job is run from its first instruction, its send checked against the frame
 * the app sent and answered with the module's answer. Without `sent`, a dry run: it stops at the first
 * send and reports the frame the job built.
 */
export function runSgbdJob(job: SgbdJobCode, opts: SgbdRunOptions): SgbdRun {
    const g = jobSteps(job, opts);
    // The exchanges the app made, in order: one (`sent`, `answer`) or several (a fault read page by page).
    const exchanges = opts.exchanges ?? (opts.sent ? [{ sent: opts.sent, answer: opts.answer! }] : []);
    let r = g.next();
    let sends = 0;
    while (!r.done) {
        const req = r.value;
        if (exchanges.length === 0) {
            // A dry run: the frame the job built is the answer.
            r = g.next(null);
            continue;
        }
        const x = exchanges[sends];
        if (!x) {
            r = g.throw(new Stop(sends === 1 ? 'a second send' : `send ${sends + 1}, which the app did not make`));
            continue;
        }
        // The interface appends the checksum; the job's string carries none.
        const mine = x.sent.slice(0, x.sent.length - 1);
        if (req.length !== mine.length || req.some((v, i) => v !== mine[i])) r = g.throw(new Stop(`the job would send ${hex(req)}, not ${hex(mine)}`));
        else if (!x.answer) r = g.throw(new Stop('a send with no answer'));
        else {
            sends++;
            r = g.next(x.answer);
        }
    }
    return r.value;
}

export interface SgbdLiveOptions extends Omit<SgbdRunOptions, 'sent' | 'answer'> {
    /**
     * Send one frame the job built (no checksum) and give back the module's answer as it came off the
     * line. The caller is the gate: it refuses a frame that may not be sent by throwing, and the run
     * ends there with that reason. A silent module throws too: EDIABAS ends the job on it.
     */
    exchange(request: Uint8Array): Promise<Uint8Array>;
    /** At most this many sends; the run ends past it. FS_LESEN sends a handful. */
    maxSends?: number;
}

/**
 * A read the job conducts itself: every send goes out through `exchange`, and the job reads each
 * answer and decides what to send next, as EDIABAS would run it — the fault count first, then the
 * entries it says there are. The results are the job's own, set by set.
 */
export async function runSgbdJobLive(job: SgbdJobCode, opts: SgbdLiveOptions): Promise<SgbdRun & { exchanges: { request: Uint8Array; answer: Uint8Array | null }[] }> {
    const g = jobSteps(job, opts);
    const exchanges: { request: Uint8Array; answer: Uint8Array | null }[] = [];
    const max = opts.maxSends ?? 16;
    let r = g.next();
    while (!r.done) {
        const req = r.value;
        if (exchanges.length >= max) {
            r = g.throw(new Stop(`more than ${max} sends`));
            continue;
        }
        try {
            const answer = await opts.exchange(req);
            exchanges.push({ request: req, answer });
            r = g.next(answer);
        } catch (e) {
            exchanges.push({ request: req, answer: null });
            r = g.throw(new Stop(e instanceof Error ? e.message : String(e)));
        }
    }
    return { ...r.value, exchanges };
}

function hex(b: Uint8Array): string {
    return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join(' ');
}

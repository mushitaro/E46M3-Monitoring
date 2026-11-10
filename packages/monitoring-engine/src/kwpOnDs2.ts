/**
 * DS2's line, KWP2000's shape: how the DSC MK60 is spoken to (2026-11-10).
 *
 * The owner's car carries a Conti/Teves MK60 (DSC III), which never answered at DS2's 0x56. Its own
 * SGBD (DSC_MK60.prg, in the private data repository with an execution trace of it) chooses EDIABAS's
 * DS2 transport — the same 9600 baud, 8E1, no initialisation, XOR checksum as the MSS54 — and carries
 * KWP2000-shaped frames in it:
 *
 *     B8  <target 29>  <source F1>  <LL = data bytes>  <SID> <data…>  <XOR of all before it>
 *
 * Only the framing differs from DS2's: the length is in the fourth byte and counts the data alone, so
 * an answer is `byte[3] + 5` bytes long; the first answer byte may take 1000 ms; the next request
 * waits 25 ms after an answer (the SGBD's own timings). The link's DS2 exchange reads the length from
 * the second byte, so this one is its own, run under the link's gate so one frame is in flight at a time.
 *
 * Nothing here is observed yet: no answer from a MK60 has been read. What an answer must look like
 * is ISO 14230's convention (format B8, target the tester F1, source the module, positive SID + 0x40,
 * negative 7F <SID> <code>) and is checked only as far as it decides where a frame ends. An answer
 * that does not fit is kept with its bytes in the error, because those bytes are the finding.
 */
import { Ds2Error, toHex, type Ds2ByteTransport } from '@tsunagi/ds2-core';

/** The first byte of every frame: on the K-line it is where DS2 keeps its address, so 0xB8 is the module's wire address. */
export const KWP_FORMAT = 0xb8;
export const KWP_TESTER = 0xf1;
/** DSC_MK60's INITIALISIERUNG: first answer byte within 1000 ms, 25 ms after an answer before the next request. */
export const KWP_TIMEOUT_MS = 1000;
export const KWP_REGEN_MS = 25;
/**
 * The quiet the line is given before a request. ISO 14230 has a module take a new request only after
 * the bus has been idle for P3 (55 ms at least); the DME's speed read goes just before every MK60 read,
 * and the first try on the car (2026-11-10) sent straight after its answer and met silence.
 */
export const KWP_IDLE_MS = 150;

/** One frame the app may send, from the module's own telegram table. */
export interface KwpFrame {
    /** The frame as it goes on the wire, checksum included, lowercase hex. */
    hex: string;
    target: number;
    /** SID and its data, without the header or the checksum. */
    data: Uint8Array;
    source: string;
}

export const xorOf = (bytes: ArrayLike<number>): number => {
    let x = 0;
    for (let i = 0; i < bytes.length; i++) x ^= bytes[i];
    return x;
};

/** The wire frame for `data` to `target`. */
export function kwpRequest(target: number, data: Uint8Array): Uint8Array {
    const head = [KWP_FORMAT, target, KWP_TESTER, data.length];
    const body = [...head, ...data];
    return Uint8Array.from([...body, xorOf(body)]);
}

/** A telegram as KWP-on-DS2 — the right shape, length and checksum — or null. */
export function kwpFrameOf(hex: string, source: string): KwpFrame | null {
    const parts = hex.trim().split(/\s+/);
    if (!parts.every((p) => /^[0-9a-fA-F]{2}$/.test(p))) return null;
    const b = parts.map((p) => parseInt(p, 16));
    if (b.length < 6 || b[0] !== KWP_FORMAT || b[2] !== KWP_TESTER || b[3] !== b.length - 5) return null;
    if (xorOf(b.slice(0, -1)) !== b[b.length - 1]) return null;
    return { hex: b.map((x) => x.toString(16).padStart(2, '0')).join(' '), target: b[1], data: Uint8Array.from(b.slice(4, -1)), source };
}

export interface KwpAnswer {
    /** The answer's data: SID and what follows it. */
    data: Uint8Array;
    /** The whole answer frame as it came. */
    bytes: Uint8Array;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Send one frame and read its answer. Throws a Ds2Error — the link's own vocabulary, so the screen and
 * the read records classify it as they classify a DS2 failure — with the bytes read in its message.
 */
export async function kwpExchange(transport: Ds2ByteTransport, frame: KwpFrame, timeoutMs = KWP_TIMEOUT_MS): Promise<KwpAnswer> {
    const request = kwpRequest(frame.target, frame.data);
    await sleep(KWP_IDLE_MS);
    // Whatever the line carried in the quiet (a module talking to itself) is not this answer.
    transport.purge();
    await transport.write(request);
    // The K-line is half-duplex: the request comes back first.
    const echo = await transport.readExact(request.length, timeoutMs);
    if (toHex(echo) !== toHex(request)) {
        throw new Ds2Error('ECHO_MISMATCH', `Unexpected K-line echo (sent ${toHex(request)}, got ${toHex(echo)})`, {
            kind: 'desync',
            detail: { sent: toHex(request), got: toHex(echo) },
        });
    }
    const head = await transport.readExact(4, timeoutMs);
    if (head[0] !== KWP_FORMAT || head[1] !== KWP_TESTER || head[2] !== frame.target) {
        throw new Ds2Error('ADDRESS_MISMATCH', `KWP answer out of frame: expected b8 f1 ${frame.target.toString(16)}, got ${toHex(head)}`, {
            kind: 'desync',
            detail: { got: toHex(head) },
        });
    }
    const rest = await transport.readExact(head[3] + 1, timeoutMs);
    const bytes = new Uint8Array(4 + rest.length);
    bytes.set(head, 0);
    bytes.set(rest, 4);
    if (xorOf(bytes.subarray(0, bytes.length - 1)) !== bytes[bytes.length - 1]) {
        throw new Ds2Error('CHECKSUM_MISMATCH', `KWP answer checksum does not add up: ${toHex(bytes)}`, { kind: 'desync', detail: { got: toHex(bytes) } });
    }
    const data = bytes.slice(4, 4 + head[3]);
    // The SGBD's next request waits this long after an answer.
    await sleep(KWP_REGEN_MS);
    if (data[0] === 0x7f) {
        throw new Ds2Error('NEGATIVE_RESPONSE', `The module refused service 0x${(data[1] ?? 0).toString(16)} (code 0x${(data[2] ?? 0).toString(16)}): ${toHex(bytes)}`, {
            kind: 'refused',
            detail: { got: toHex(bytes), service: data[1] ?? null, code: data[2] ?? null },
        });
    }
    return { data, bytes };
}

export interface KwpDtc {
    /** Two bytes, as the SGBD's FS_LESEN_DETAIL takes them: `0x5de4`. */
    code: string;
    status: number;
}

/**
 * A `$18` answer read as ISO 14230 lays it out — `58 <n> (<hi> <lo> <status>)×n` — or null when the
 * bytes are not that shape. Not observed on a MK60 yet: the screen says so, and keeps the bytes.
 */
export function parseDtcsByStatus(data: Uint8Array): KwpDtc[] | null {
    if (data.length < 2 || data[0] !== 0x58) return null;
    const n = data[1];
    if (data.length !== 2 + 3 * n) return null;
    const out: KwpDtc[] = [];
    for (let i = 0; i < n; i++) {
        const o = 2 + 3 * i;
        out.push({ code: `0x${((data[o] << 8) | data[o + 1]).toString(16).padStart(4, '0')}`, status: data[o + 2] });
    }
    return out;
}

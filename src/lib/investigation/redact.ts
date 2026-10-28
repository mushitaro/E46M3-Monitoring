/**
 * The VIN, taken out of what the desk reads.
 *
 * The policy's promise is that the VIN never reaches an AI conversation. The tab keeps it out of
 * the assistant's answers (hooks/useMonitoringFacade); this keeps it out of the desk's, which reads
 * the same records the owner's account holds — and those can carry it: an identity read answers
 * with it, a module's AIF holds it, and an owner may say it aloud into a note.
 *
 * Three layers, because none is enough alone:
 *
 *   1. A read whose job is an identification (IDENT, AIF, FG, ZCS, FA …) is withheld whole: the
 *      desk is told it answered and how long, not what it said.
 *   2. Any other answer is scanned for a VIN in ASCII — the 17 characters, or the 7-character short
 *      form modules keep (two letters, five digits) — and those bytes become `*`.
 *   3. Every string in an entry or a run is scanned for the same, and the match becomes `[VIN]`.
 *
 * What is left is the shape a reader needs (length, which bytes changed) without the value nobody
 * at the desk has a reason to see. Pure.
 */

/** Jobs whose answer is the car's identity. Matched on the job id, case-insensitively. */
const IDENTIFICATION = /(^|_)(IDENT|AIF|FG|C_FG|ZCS|FA|VIN|FGNR)(_|$)/i;

const VIN_CHAR = /[A-HJ-NPR-Z0-9]/;
const VIN_17 = /\b(?=[A-HJ-NPR-Z0-9]*\d)(?=[A-HJ-NPR-Z0-9]*[A-HJ-NPR-Z])[A-HJ-NPR-Z0-9]{17}\b/g;
const VIN_7 = /\b[A-HJ-NPR-Z]{2}\d{5}\b/g;

export const WITHHELD = 'withheld: identification';

export function isIdentification(job: string): boolean {
    return IDENTIFICATION.test(job);
}

/** A string with any VIN, full or short, replaced by `[VIN]`. */
export function redactText(s: string): string {
    return s.replace(VIN_17, '[VIN]').replace(VIN_7, '[VIN]');
}

const isAscii = (b: number, re: RegExp) => b >= 0x20 && b < 0x7f && re.test(String.fromCharCode(b));
const isAlnum = (b: number | undefined) => b !== undefined && isAscii(b, /[A-Za-z0-9]/);

/**
 * Bytes as `toHex` writes them (`12 05 0b`), with any VIN they spell in ASCII masked to `*`.
 * Accepts the hex with or without spaces; anything that is not hex comes back as it was.
 */
export function redactHex(hex: string): { hex: string; masked: boolean } {
    const compact = hex.replace(/\s+/g, '');
    if (compact.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(compact)) return { hex, masked: false };
    const bytes = Array.from({ length: compact.length / 2 }, (_, i) => parseInt(compact.slice(i * 2, i * 2 + 2), 16));
    let masked = false;
    const mask = (from: number, n: number) => {
        for (let k = from; k < from + n; k++) bytes[k] = 0x2a;
        masked = true;
    };
    for (let i = 0; i < bytes.length; i++) {
        const run17 = bytes.slice(i, i + 17);
        if (run17.length === 17 && run17.every((b) => isAscii(b, VIN_CHAR)) && run17.some((b) => b >= 0x30 && b <= 0x39) && run17.some((b) => b >= 0x41)) {
            mask(i, 17);
            i += 16;
            continue;
        }
        const run7 = bytes.slice(i, i + 7);
        if (
            run7.length === 7 &&
            run7.slice(0, 2).every((b) => isAscii(b, /[A-HJ-NPR-Z]/)) &&
            run7.slice(2).every((b) => b >= 0x30 && b <= 0x39) &&
            !isAlnum(bytes[i - 1]) &&
            !isAlnum(bytes[i + 7])
        ) {
            mask(i, 7);
            i += 6;
        }
    }
    const out = bytes.map((b) => b.toString(16).padStart(2, '0'));
    return { hex: hex.includes(' ') || compact.length === 0 ? out.join(' ') : out.join(''), masked };
}

/** One answer for the desk: withheld when it is an identity, masked otherwise. */
export function redactResponse(job: string, response: string | null): { response: string | null; note: string | null } {
    if (response === null) return { response: null, note: null };
    if (isIdentification(job)) return { response: null, note: `${WITHHELD} (${response.replace(/\s+/g, '').length / 2} bytes)` };
    const r = redactHex(response);
    return { response: r.hex, note: r.masked ? 'VIN masked' : null };
}

/** Every string in a value — an entry's body, a run — with any VIN replaced. Structure unchanged. */
export function redactDeep<T>(value: T): T {
    if (typeof value === 'string') return redactText(value) as T;
    if (Array.isArray(value)) return value.map(redactDeep) as T;
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, redactDeep(v)])) as T;
    }
    return value;
}

/** A run's exchanges with their answers redacted as reads are, and its strings scanned. */
export function redactRun<R extends { exchanges?: { what: string; response: string | null }[] }>(run: R): R {
    const exchanges = run.exchanges?.map((x) => {
        const r = redactResponse(x.what, x.response);
        return { ...x, response: r.response, ...(r.note ? { redacted: r.note } : {}) };
    });
    return redactDeep({ ...run, ...(exchanges ? { exchanges } : {}) });
}

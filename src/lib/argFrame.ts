/**
 * A DS2 frame built from a job's arguments — the encoder this repo did not have.
 *
 * `actuationGate` used to refuse every argument-taking job outright, and its
 * reason was correct at the time: a scraped frame embeds whatever values the
 * SGBD's bytecode happened to hold, so sending it while the dialog showed the
 * operator's numbers would disclose a call that is not the call. That is worse
 * than refusing, because it looks like it worked.
 *
 * This answers that objection rather than deleting it. The template is only
 * usable when we can tell an ARGUMENT SLOT from a CONSTANT, and the two pieces
 * of evidence that let us are independent of each other:
 *
 *   1. the SGBD declares how many arguments the job takes, and the extractor
 *      records how many payload bytes the template has (`argsAgree`);
 *   2. every one of those payload bytes is `0x00` in the file.
 *
 * A template holding a non-zero literal is refused — not because the byte is
 * necessarily wrong, but because we cannot say which bytes are ours to fill, and
 * "probably that one" is not a thing to send to a car.
 *
 * ## What it deliberately cannot do
 *
 * One argument, one byte, in declared order, integer only. `STEUERN_STELLGLIED`
 * takes a STRING naming a row of the `STELLGLIEDER` table; mapping a name to its
 * byte is a second piece of work with its own evidence, and until that exists
 * this refuses rather than guessing an ordinal. Multi-byte arguments, endianness
 * and scaling are all outside it too. Every one of those is a refusal with its
 * own reason, never a best effort.
 *
 * ## Where this may be used
 *
 * PRACTICE only. `runGate.mayRun` — the one place that decides what reaches a
 * car — is untouched and still refuses every job with arguments. That is not an
 * oversight: a frame this module builds has never been sent to an ECU by anyone,
 * and the ledger is how something earns the vehicle path.
 */
import type { CatalogArg, CatalogJob } from './ecuCatalog';
import { telegramBytes } from './runGate';
import type { Telegram } from './telegrams';

export type ArgFrameBlockKey =
    | 'argframe_noTemplate'
    | 'argframe_arity'
    | 'argframe_notPlaceholder'
    | 'argframe_argType'
    | 'argframe_missingValue'
    | 'argframe_range';

export type ArgFrameResult =
    | { ok: true; hex: string; bytes: Uint8Array; control: number }
    | { ok: false; reason: ArgFrameBlockKey; detail?: string };

/** DS2's frame checksum: XOR of every byte before it. */
export function checksum(bytes: ArrayLike<number>): number {
    let x = 0;
    for (let i = 0; i < bytes.length; i++) x ^= bytes[i];
    return x;
}

/**
 * What stops this job's frame being built, whatever the values are — or `null`
 * when nothing does.
 *
 * A refusal, or nothing. Split out from the build so a view can grey a row, and
 * a test can assert the shape of the catalogue, without inventing values to ask
 * with. It answers only the value-independent half: a job that clears this can
 * still be refused for a value that will not fit in its byte.
 */
export function encodingBlocker(
    job: Pick<CatalogJob, 'args'>,
    telegram: Telegram | null,
): (ArgFrameResult & { ok: false }) | null {
    const r = build(job, telegram, null);
    return r && !r.ok ? r : null;
}

/**
 * Build the frame. `values` is keyed by argument NAME, and every declared
 * argument must have one.
 */
export function buildArgFrame(
    job: Pick<CatalogJob, 'args'>,
    telegram: Telegram | null,
    values: Readonly<Record<string, string>>,
): ArgFrameResult {
    const r = build(job, telegram, values);
    // `build` returns null only for the values-less probe, which is not this.
    return r ?? { ok: false, reason: 'argframe_missingValue' };
}

function build(
    job: Pick<CatalogJob, 'args'>,
    telegram: Telegram | null,
    values: Readonly<Record<string, string>> | null,
): ArgFrameResult | null {
    // One certain frame, or nothing. `multiple` means the scrape saw the job
    // build more than one telegram and cannot say which; `shared` means the
    // frame is a template belonging to no job in particular.
    if (!telegram || telegram.confidence !== 'single') {
        return { ok: false, reason: 'argframe_noTemplate' };
    }
    const bytes = telegramBytes(telegram.hex);
    if (!bytes) return { ok: false, reason: 'argframe_noTemplate' };

    // addr, length, control, …payload…, checksum
    const payload = bytes.slice(3, bytes.length - 1);
    if (payload.length !== job.args.length) {
        return {
            ok: false,
            reason: 'argframe_arity',
            detail: `${payload.length} payload byte(s), ${job.args.length} declared argument(s)`,
        };
    }
    // Nothing to fill: a zero-argument job's frame is already the frame, and
    // this module has no business rewriting it.
    if (payload.length === 0) {
        return { ok: true, hex: telegram.hex, bytes, control: bytes[2] };
    }
    const held = [...payload].findIndex((b) => b !== 0x00);
    if (held !== -1) {
        return {
            ok: false,
            reason: 'argframe_notPlaceholder',
            detail: `payload byte ${held} is 0x${payload[held].toString(16).padStart(2, '0')}, not a placeholder`,
        };
    }
    const wrongType = job.args.find((a) => !isByteArg(a));
    if (wrongType) {
        return { ok: false, reason: 'argframe_argType', detail: `${wrongType.name} is ${wrongType.type}` };
    }
    if (values === null) return null;   // the probe got as far as it can

    const out = new Uint8Array(bytes);
    for (let i = 0; i < job.args.length; i++) {
        const arg = job.args[i];
        const raw = values[arg.name];
        if (raw === undefined || raw.trim() === '') {
            return { ok: false, reason: 'argframe_missingValue', detail: arg.name };
        }
        const n = parseByte(raw);
        if (n === null) return { ok: false, reason: 'argframe_range', detail: `${arg.name} = ${raw}` };
        out[3 + i] = n;
    }
    out[out.length - 1] = checksum(out.subarray(0, out.length - 1));
    return {
        ok: true,
        hex: [...out].map((b) => b.toString(16).padStart(2, '0')).join(' '),
        bytes: out,
        control: out[2],
    };
}

/** One byte, one argument. Anything else is a refusal, never a truncation. */
function isByteArg(a: CatalogArg): boolean {
    return a.type === 'int';
}

/**
 * `"3"`, `"0x0A"`, `"10"` — a single unsigned byte, or null.
 *
 * Decimal unless it says otherwise, because the SGBD's own argument comments
 * say so in as many words: "dezimal eingeben". A value that does not fit in a
 * byte is refused rather than masked — `& 0xff` on an out-of-range number is
 * how a 6 becomes something else on the wire.
 */
export function parseByte(raw: string): number | null {
    const s = raw.trim();
    if (!s) return null;
    const n = /^0[xX][0-9a-fA-F]+$/.test(s) ? Number.parseInt(s, 16)
        : /^\d+$/.test(s) ? Number.parseInt(s, 10)
        : NaN;
    if (!Number.isInteger(n) || n < 0 || n > 0xff) return null;
    return n;
}

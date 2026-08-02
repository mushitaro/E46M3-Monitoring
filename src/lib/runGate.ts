'use client';

/**
 * May this reach a real car?
 *
 * One question, one answer, one place. The panel, the hub and the link all ask
 * here, so a control that is enabled and a control that fires cannot disagree.
 *
 * ## The layers, and why the last one is the bytes
 *
 * Our classification of a job (`class: 'read'`) is a judgement made by a regex
 * over an SGBD comment. The final check is therefore made against the CONTROL
 * BYTE OF THE FRAME THAT WOULD ACTUALLY GO OUT, which does not depend on our
 * opinion of the job at all. If the classifier were ever wrong, this is the
 * check that stops the car being touched.
 *
 * How much that has actually been checked, precisely — an earlier version of
 * this comment said "right about all 323 today", which was inflation:
 *
 *   150 jobs are classified `read`.
 *     8 of those have a `single`-graded telegram, so we know their bytes.
 *     5 of those take no arguments and reach the control-byte check.
 *     0 of those carry a control byte outside the allowlist.
 *
 * So the backstop is UNEXERCISED, not demonstrated redundant. For the other 142
 * reads the bytes are simply unknown — 84 MSS54 reads have no telegram entry at
 * all — and a check that five jobs happen to pass is not a check that a hundred
 * and fifty made unnecessary. It is here for the case that has not arrived.
 *
 * ## What is allowed out of the box
 *
 * Reads, and only reads. A DS2 read command cannot change the ECU: it names a
 * block and the ECU answers. Everything that CAN change the car — actuator
 * tests, calibration writes, coding, programming, the SMG II procedures, the
 * DSC hydraulics — is refused twice over: the shipped ledger vouches for none of
 * them, and even with a ledger entry this app has no code that executes one. The
 * two refusals are separate sentences on purpose.
 *
 * Fault-memory clearing is the exception and it is handled separately — see
 * `clearFaultsCommand`.
 */

import { Ds2Control } from '@tsunagi/ds2-core';
import type { CatalogJob } from './ecuCatalog';
import { mayRunOnVehicle, type Ledger } from './ledger';
import { telegramIsCertain, type Telegram } from './telegrams';

/**
 * Control bytes that read and do not write.
 *
 * Deliberately an allowlist, not a denylist of the dangerous ones: an
 * unrecognised control byte must be refused, and a denylist would wave it
 * through. Every entry is a command whose whole effect is that the ECU answers.
 *
 * `0x0c` (IO control / actuator) and `0x05` (clear fault memory) are absent on
 * purpose, and so is everything else that mutates.
 */
export const READ_ONLY_CONTROLS: ReadonlySet<number> = new Set([
    0x00, // identification
    Ds2Control.READ_ERROR_MEMORY, // 0x04
    Ds2Control.READ_MEMORY, // 0x06
    Ds2Control.QUERY_ENCODING_CHECKSUM, // 0x0a
    Ds2Control.READ_IO_STATUS, // 0x0b
    Ds2Control.READ_SYSTEM_ADDRESSES, // 0x0d
    Ds2Control.READ_SHADOW_ERROR_MEMORY, // 0x14
    0x1a, // read ident
    0x53, // manufacturer data
    0x6d, // EWS status
]);

export type RunBlockKey =
    | 'run_block_programming'
    | 'run_block_noTelegram'
    | 'run_block_needsArgs'
    | 'run_block_notRead'
    | 'run_block_controlWrites'
    | 'run_block_notVerified';

export type RunVerdict =
    | { allowed: true; telegram: Telegram; control: number }
    | { allowed: false; reason: RunBlockKey };

/**
 * Parses the extractor's hex into bytes.
 *
 * `"12 05 0b 04 18"` → address, length, control, payload…, checksum. Returns
 * null on anything that is not a well-formed frame, because a half-parsed frame
 * must never become a sent frame.
 */
export function telegramBytes(hex: string): Uint8Array | null {
    const parts = hex.trim().split(/\s+/);
    if (parts.length < 4) return null;
    const out = new Uint8Array(parts.length);
    for (let i = 0; i < parts.length; i++) {
        if (!/^[0-9a-fA-F]{2}$/.test(parts[i])) return null;
        out[i] = parseInt(parts[i], 16);
    }
    // length byte counts the whole frame including checksum
    if (out[1] !== out.length) return null;
    let ck = 0;
    for (let i = 0; i < out.length - 1; i++) ck ^= out[i];
    if (ck !== out[out.length - 1]) return null;
    return out;
}

/**
 * The verdict, cheapest-to-fix reason first — except for the two that are
 * properties of the job rather than of the session, which come first because no
 * amount of connecting or typing changes them.
 */
export function mayRun(
    job: CatalogJob,
    telegram: Telegram | null,
    ledger: Ledger,
    ctx: { moduleId: string },
): RunVerdict {
    if (job.class === 'programming') return { allowed: false, reason: 'run_block_programming' };

    // Anything that is not a read needs evidence, and even with evidence this
    // app has no execution path for it yet. Both refusals are real and they are
    // different sentences: "nobody has proven this" and "we have not built it".
    // Saying the first when the second is true would make the ledger look like
    // the only thing standing in the way.
    if (job.class !== 'read') {
        return mayRunOnVehicle(ledger, `${ctx.moduleId}:${job.id}`).allowed
            ? { allowed: false, reason: 'run_block_notRead' }
            : { allowed: false, reason: 'run_block_notVerified' };
    }

    // PRACTICE is NOT a reason to refuse.
    //
    // It was, in the first cut of this file, and that was backwards: the whole
    // point of the simulated ECU is that the app's real paths execute without a
    // car. Gating the run surface on a vehicle meant the transmit path would
    // first execute on a real M3 — which is the "the failure path has never once
    // run" mistake this codebase already has a scar from. A read is safe on
    // either link; which link it went to is in the comms log.
    if (!telegramIsCertain(telegram)) return { allowed: false, reason: 'run_block_noTelegram' };

    // An argument-taking job cannot be sent from a scraped frame. The frame the
    // extractor recovered embeds whatever argument values the SGBD's bytecode
    // happened to hold; we did not choose them and we have no mapping from the
    // operator's chosen values back into the payload. Sending it anyway would
    // read a block nobody asked for. (The block reads the operator CAN vary —
    // live values and adaptation blocks — are built from the protocol in
    // ds2-core, not from a scrape, and do not come through here.)
    if (job.args.length > 0) return { allowed: false, reason: 'run_block_needsArgs' };

    const bytes = telegramBytes(telegram.hex);
    if (!bytes) return { allowed: false, reason: 'run_block_noTelegram' };
    const control = bytes[2];

    // The bytes have the last word. If our classification says `read` and the
    // frame says otherwise, the frame is what the car would receive.
    if (!READ_ONLY_CONTROLS.has(control)) {
        return { allowed: false, reason: 'run_block_controlWrites' };
    }

    return { allowed: true, telegram, control };
}

/**
 * The clear-fault-memory frame, built from the protocol.
 *
 * NOT taken from the telegram scrape. `Ds2Control.CLEAR_ERROR_MEMORY` with an
 * empty payload is the DS2 command, and the scrape independently recovered
 * exactly that frame on all three modules (`12 04 05 13`, `32 04 05 33`,
 * `56 04 05 57`) — so the two derivations agree and neither is guessing. The
 * app builds its own rather than replaying the scrape, for the same reason
 * `readFaults` and `readIdent` do: a frame you construct from the spec is
 * checkable, and a frame you replay is only as good as the scrape.
 *
 * This is the one mutating command the app will send without a ledger entry.
 * It is irreversible in the way that matters — the freeze frames go with the
 * faults — so the caller must confirm, and the confirmation must say that.
 */
export function clearFaultsCommand(): { control: number; payload: Uint8Array } {
    return { control: Ds2Control.CLEAR_ERROR_MEMORY, payload: new Uint8Array(0) };
}

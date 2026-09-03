/**
 * The SMG II test-program protocol, as the SGBD states it.
 *
 * Not invented, and not inferred where it did not have to be. Every rule below
 * is quoted from `SMG2.prg`'s own job comments, which is why this module exists
 * separately from the wizard that drives it: the protocol is a fact about the
 * gearbox controller, and the dialog is one way of presenting it.
 *
 * ## The sequence
 *
 *   1. `TESTPRG_STOP` — "Muss VOR TESTPRG_STARTEN geschickt werden!"  It goes
 *      first even when nothing is running. That is the ECU's rule, not a
 *      defensive habit of ours.
 *   2. `TESTPRG_STARTEN` with the procedure's TESTPRG_NR.
 *   3. **Re-send `TESTPRG_STARTEN`, repeatedly.** "Job muss kontinuierlich
 *      angestossen werden … Job solange anstossen, bis dieses Result ungleich 1
 *      liefert!"  Each answer carries the current status; status 1 means the
 *      program is still running. This is not polling we chose — it is how the
 *      ECU reports progress, and a single START with no follow-up would leave
 *      the operator watching a spinner that knows nothing.
 *   4. `TESTPRG_STOP` at the end, whether it finished or was abandoned.
 *
 * ## The two clocks
 *
 * The ECU's own diagnosis timeout is 10 s — "(Steuergeraete-Timeout: 10s!)"
 * appears on four of these jobs. The link's heartbeat already runs at 2 s on
 * every state, so the session stays alive without this module doing anything;
 * adding a second keep-alive here would be two timers with one job, and the one
 * that drifted would be invisible. The interval below is for STATUS, and it is
 * far inside the 10 s so that a missed tick is late news rather than a dropped
 * session.
 *
 * The procedure's own duration comes from the SGBD table per procedure
 * (`durMaxSec`), up to sixteen minutes for a full gearbox adaptation.
 *
 * ## Where this may run
 *
 * PRACTICE only, today. `TESTPRG_STARTEN` is not a read and control 0x32 is not
 * in `runGate.READ_ONLY_CONTROLS`, so a vehicle refuses it — and this module
 * does not ask twice. It reports that refusal rather than routing around it.
 */
import { buildArgFrame, encodingBlocker, type ArgFrameBlockKey } from './argFrame';
import type { CatalogJob } from './ecuCatalog';
import type { Smg2Procedure } from './smg2Workflows';
import { bestTelegram, type TelegramTable } from './telegrams';

export const START_JOB = 'TESTPRG_STARTEN';
export const STOP_JOB = 'TESTPRG_STOP';

/** "(Steuergeraete-Timeout: 10s!)" — the SGBD, on four separate jobs. */
export const ECU_TIMEOUT_MS = 10_000;

/**
 * How often the status re-send goes out.
 *
 * A fifth of the ECU's timeout. The SGBD says "continuously" and gives no
 * number; a second is frequent enough that the activity text tracks what the
 * gearbox is doing, and slack enough that one late tick is not a lost session.
 */
export const STATUS_INTERVAL_MS = 1_000;

export type ProcedureBlockKey =
    | 'proc_block_vehicle'
    | 'proc_block_noJob'
    | 'proc_block_selection'
    | `argframe_${string}`;

export interface ProcedurePlan {
    /** Sent first, always. The ECU requires it. */
    stopHex: string;
    /** `TESTPRG_STARTEN` carrying this procedure's number. */
    startHex: string;
    /** Re-sent on this cadence to read the status out. */
    statusIntervalMs: number;
    /** The SGBD's own maximum for this procedure, or null where it states none. */
    durMaxSec: number | null;
}

export type ProcedurePlanResult =
    | { ok: true; plan: ProcedurePlan }
    | { ok: false; reason: ProcedureBlockKey; detail?: string };

export interface PlanInput {
    procedure: Smg2Procedure;
    /** The module's jobs, by id — `TESTPRG_STARTEN` and `TESTPRG_STOP` must be in it. */
    jobs: ReadonlyMap<string, CatalogJob>;
    telegrams: TelegramTable | null;
    mode: 'vehicle' | 'practice';
    /**
     * AUSWAHLBYTE, for the one procedure that selects something. 0x0A engages an
     * arbitrary gear: "0 = Neutral, 1-6 = Gang 1-6, 7 = Rueckwaertsgang".
     * Ignored — and required to be absent — for the other thirteen, because the
     * SGBD says "Alle anderen Testprg benoetigen kein Auswahlbyte".
     */
    selection?: number;
}

export function planProcedure(input: PlanInput): ProcedurePlanResult {
    const { procedure, jobs, telegrams, mode } = input;

    // A car is attached. `TESTPRG_STARTEN` writes, and nothing has verified it
    // against an ECU, so the vehicle gate refuses it — and this says so plainly
    // instead of building a frame nobody may send.
    if (mode === 'vehicle') return { ok: false, reason: 'proc_block_vehicle' };

    const start = jobs.get(START_JOB);
    const stop = jobs.get(STOP_JOB);
    if (!start || !stop) {
        return { ok: false, reason: 'proc_block_noJob', detail: !start ? START_JOB : STOP_JOB };
    }

    const stopTel = bestTelegram(telegrams, STOP_JOB);
    const startTel = bestTelegram(telegrams, START_JOB);
    for (const [job, tel] of [[stop, stopTel], [start, startTel]] as const) {
        const blocked = encodingBlocker(job, tel);
        if (blocked) return { ok: false, reason: blocked.reason as ArgFrameBlockKey, detail: blocked.detail };
    }

    const selection = input.selection;
    if (procedure.auswahl) {
        if (selection === undefined) return { ok: false, reason: 'proc_block_selection' };
        // 0 = neutral, 1..6 = the gears, 7 = reverse. Quoted, not assumed.
        if (!Number.isInteger(selection) || selection < 0 || selection > 7) {
            return { ok: false, reason: 'proc_block_selection', detail: String(selection) };
        }
    } else if (selection !== undefined) {
        // "Alle anderen Testprg benoetigen kein Auswahlbyte." Passing one for a
        // procedure that takes none would put a byte on the wire the ECU was
        // never told to expect, so it is an error rather than something ignored.
        return { ok: false, reason: 'proc_block_selection', detail: 'this procedure takes no AUSWAHLBYTE' };
    }

    const startFrame = buildArgFrame(start, startTel, {
        TESTPRG_NR: procedure.testprg,
        AUSWAHLBYTE: String(selection ?? 0),
    });
    if (!startFrame.ok) return { ok: false, reason: startFrame.reason, detail: startFrame.detail };

    const stopFrame = buildArgFrame(stop, stopTel, {});
    if (!stopFrame.ok) return { ok: false, reason: stopFrame.reason, detail: stopFrame.detail };

    return {
        ok: true,
        plan: {
            stopHex: stopFrame.hex,
            startHex: startFrame.hex,
            statusIntervalMs: STATUS_INTERVAL_MS,
            durMaxSec: procedure.durMaxSec,
        },
    };
}

/**
 * What the ECU said, out of the answer to `TESTPRG_STARTEN`.
 *
 * ## The offsets are INFERRED, and the UI says so
 *
 * The SGBD names the positions in the specification's numbering, not ours:
 * `INFO_STATUS_BYTE` is "Byte 5 (Lastenheft)" and `INFO_STATUS_BYTE2` is
 * "Byte 6". Reading that as 1-based over the whole telegram — address, length,
 * status, then payload — puts INFO_STATUS at payload index 1 and INFO_STATUS2 at
 * index 2, which leaves `TEST_STATUS_BYTE` at index 0, the first payload byte,
 * exactly where a status byte belongs.
 *
 * That is a reading of a document, not a measurement against a car. So this
 * returns `provenance: 'inferred'`, the wizard prints the raw response beside
 * the decoded text, and the first bench session is what turns it into
 * `measured`. Showing a decoded status with no such mark would be presenting a
 * guess in the clothes of a reading, which is the one thing this app does not do.
 */
export interface TestStatusRead {
    /** 0 condition not met, 1 running, 2 finished, 3 finished badly. */
    statusByte: number;
    /** Infobyte 1 — the activity vocabulary's key. */
    infoByte: number | null;
    /** Infobyte 2 — a measurement on procedure 0x04, a raw byte otherwise. */
    infoByte2: number | null;
    provenance: 'inferred';
}

export function decodeTestStatus(responseHex: string): TestStatusRead | null {
    const bytes = responseHex
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map((h) => Number.parseInt(h, 16));
    if (bytes.length === 0 || bytes.some((b) => !Number.isInteger(b) || b < 0 || b > 0xff)) return null;
    // `runRead` hands back the PAYLOAD, not the whole frame — see JobRunResult.
    if (bytes.length < 1) return null;
    return {
        statusByte: bytes[0],
        infoByte: bytes.length > 1 ? bytes[1] : null,
        infoByte2: bytes.length > 2 ? bytes[2] : null,
        provenance: 'inferred',
    };
}

/**
 * "Job solange anstossen, bis dieses Result ungleich 1 liefert!"
 *
 * The stopping rule, quoted. Anything that is not 1 ends the run — including
 * 0 ("test condition not met"), which is a real answer and not a reason to keep
 * asking. The wizard reports WHICH of them it got.
 */
export function stillRunning(statusByte: number): boolean {
    return statusByte === 0x01;
}

/** Did it finish the way it was supposed to? `0x02` alone means yes. */
export function finishedWell(statusByte: number): boolean {
    return statusByte === 0x02;
}

/**
 * What the app may send to ONE module on its own, outside the job catalogue.
 *
 * IDENT, the fault-memory read, the heartbeat, the session end and the fault-memory clear are
 * frames the app builds itself rather than running a job. The app built them for the MSS54 and
 * sent them to 0x12 whichever module was selected, and decoded every answer as an MSS54 answer.
 *
 * The rule here is one sentence: **send a module only what its own SGBD sends it.** Each frame is
 * taken from the module's own telegram table, by exact bytes, and a module whose table does not
 * carry a frame does not get it. FS_LESEN is the proof that guessing is wrong: its argument byte
 * is `00` and `01` on the MSS54, `01` alone on DSC, `1e` on the seat modules and `02` on the
 * steering-wheel buttons, so a "generic" fault read would have asked most modules something they
 * never ask themselves.
 *
 * Only the MSS54 has a decoder of the app's own for what comes back (`@tsunagi/ds2-mss54`). Another
 * module's answer is read, where it can be, by that module's own SGBD code run in the app
 * (lib/sgbd/results) — never by a layout guessed from the MSS54's, which would be a reading of
 * fiction — and its bytes are always kept.
 */

import { kwpFrameOf, type KwpFrame } from './kwpOnDs2';
import { telegramBytes } from './runGate';
import type { TelegramTable } from './telegrams';

/** One frame the app may send to this module, with where it came from. */
export interface ProtocolFrame {
    hex: string;
    control: number;
    payload: Uint8Array;
    /** The module's own job whose telegram carries these bytes, or how else we know. */
    source: string;
}

export interface ModuleProtocol {
    moduleId: string;
    address: number;
    ident: ProtocolFrame | null;
    /** The fault-memory reads, in the order the module's own FS_LESEN sends them. */
    faults: ProtocolFrame[];
    clear: ProtocolFrame | null;
    keepAlive: ProtocolFrame | null;
    endSession: ProtocolFrame | null;
    /** Which decoder reads this module's answers. Null: none, and the bytes are the answer. */
    decoder: 'mss54' | null;
    /**
     * A module whose SGBD speaks KWP2000-shaped frames on DS2's line (lib/kwpOnDs2; DSC MK60). Only
     * its identity and its fault read, each taken from its own table by exact bytes; every DS2 frame
     * above is then absent, so nothing else is ever sent to it. Null for a DS2 module.
     */
    kwp: { ident: KwpFrame | null; faults: KwpFrame[] } | null;
}

const C = { IDENT: 0x00, READ_FAULTS: 0x04, CLEAR_FAULTS: 0x05, KEEP_ALIVE: 0x9e, END_SESSION: 0x9f } as const;

/**
 * The MSS54's heartbeat is not in its SGBD — it has no DIAGNOSE_AUFRECHT job — but the tuner has
 * sent `12 04 9e 88` every two seconds on the real car for months. That is a measurement, and the
 * only module for which we have one.
 */
const MEASURED_KEEP_ALIVE: Readonly<Record<string, string>> = { mss54: '12 04 9e 88' };

/**
 * The frames a module may be sent, read from its own telegram table.
 *
 * `table` may be null — a module with no table gets nothing, which the screen shows as "not
 * established for this module" rather than as a failure.
 */
export function moduleProtocol(moduleId: string, address: number, table: TelegramTable | null): ModuleProtocol {
    const jobs = table?.jobs ?? {};
    const find = (jobNames: readonly string[], control: number, maxPayload: number): ProtocolFrame[] => {
        const out: ProtocolFrame[] = [];
        const seen = new Set<string>();
        for (const job of jobNames) {
            for (const t of jobs[job] ?? []) {
                const bytes = telegramBytes(t.hex);
                if (!bytes) continue;
                // The module's own address, its own control byte, and nothing longer than the
                // command needs. A long frame filed under FS_LESEN is a different protocol (EWS's
                // 0x1a strings) or an ASCII artefact, not this read.
                if (bytes[0] !== address || bytes[2] !== control) continue;
                const payload = bytes.slice(3, bytes.length - 1);
                if (payload.length > maxPayload || seen.has(t.hex)) continue;
                seen.add(t.hex);
                out.push({ hex: t.hex, control, payload, source: `${job} (SGBD telegram)` });
            }
        }
        return out;
    };

    // KWP-on-DS2: the module's own frames by their service byte — $1A ReadECUIdentification, $18
    // ReadDiagnosticTroubleCodesByStatus — addressed to this module on the wire. Nothing else.
    if (table?.framing === 'kwp-ds2') {
        const frames = (job: string, sid: number) =>
            (jobs[job] ?? [])
                .map((t) => kwpFrameOf(t.hex, `${job} (SGBD execution trace)`))
                .filter((f): f is KwpFrame => f !== null && parseInt(f.hex.slice(0, 2), 16) === address && f.data[0] === sid);
        return {
            moduleId,
            address,
            ident: null,
            faults: [],
            clear: null,
            keepAlive: null,
            endSession: null,
            decoder: null,
            kwp: { ident: frames('IDENT', 0x1a)[0] ?? null, faults: frames('FS_LESEN', 0x18) },
        };
    }

    const measured = MEASURED_KEEP_ALIVE[moduleId];
    const measuredBytes = measured ? telegramBytes(measured) : null;

    return {
        moduleId,
        address,
        ident: find(['IDENT'], C.IDENT, 0)[0] ?? null,
        faults: find(['FS_LESEN'], C.READ_FAULTS, 1),
        clear: find(['FS_LOESCHEN'], C.CLEAR_FAULTS, 0)[0] ?? null,
        keepAlive:
            measuredBytes && measuredBytes[0] === address
                ? { hex: measured!, control: C.KEEP_ALIVE, payload: new Uint8Array(0), source: 'measured on the car (TUNER)' }
                : (find(['DIAGNOSE_AUFRECHT'], C.KEEP_ALIVE, 0)[0] ?? null),
        endSession: find(['DIAGNOSE_ENDE'], C.END_SESSION, 0)[0] ?? null,
        decoder: moduleId === 'mss54' ? 'mss54' : null,
        kwp: null,
    };
}

/** A module the app knows nothing about sending to: every frame absent. */
export function noProtocol(moduleId: string, address: number): ModuleProtocol {
    return moduleProtocol(moduleId, address, null);
}

/** Whether the app has an identity frame for this module, DS2 or KWP-on-DS2. */
export const hasIdent = (p: ModuleProtocol): boolean => p.ident !== null || !!p.kwp?.ident;

/** Whether the app has a fault-read frame for this module, DS2 or KWP-on-DS2. */
export const hasFaultRead = (p: ModuleProtocol): boolean => p.faults.length > 0 || (p.kwp?.faults.length ?? 0) > 0;

/**
 * Whether a fault read may be tried: a frame of its own, or — any DS2 module but the DME — its SGBD's
 * own FS_LESEN, which the link runs when the data carries it (lib/sgbd/faultRead) and refuses, with
 * why, when it does not.
 */
export const mayTryFaultRead = (p: ModuleProtocol): boolean => hasFaultRead(p) || (p.kwp === null && p.decoder !== 'mss54');

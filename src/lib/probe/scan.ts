/**
 * Every module's fault memory, one address at a time: what the assistant's `monitoring_scan` and
 * an AI-mode investigation start from (operator, 2026-11-01: "read every module's faults without
 * choosing one").
 *
 * DS2 has no broadcast. A scan is each module's own fault read (FS_LESEN, control 0x04) sent to
 * its own address in turn, on the one link, through the same gate as the screen's READ.
 *
 * ## Fourteen addresses hold more than one SGBD
 *
 * 0x56 is ASCMK20 on an early car and DSC_E46 on a late one; 0x5B has three IHKA variants; and so
 * on. Which one is fitted is not known before it answers, and IDENT cannot say (only the MSS54's
 * IDENT is decoded). The house rule is that a module is sent only what its own SGBD sends it, so an
 * address gets only the frames EVERY candidate's table carries — whichever is fitted, the bytes are
 * its own. Most shared addresses agree byte for byte; where none is common (0x50: MFL carries one,
 * MFL2 none), the address is not asked, and says so.
 *
 * ## The identity first, as the screen does
 *
 * On the car (2026-11-12) the steering-angle sensor, the airbag and the light switch refused in a
 * scan the very frame they answered on DIAGNOSIS. The difference between the two was one frame:
 * DIAGNOSIS reads the identity when it connects, and the scan went straight to the fault read.
 * LWS5's and MRS4's own FS_LESEN send their IDENT before the read. So an address is sent its
 * IDENT first — when every candidate's table carries the same one — and silence there is the
 * module's absence. The identity's bytes are not kept in the result (they name the car's parts).
 *
 * ## An answer is kept
 *
 * A module that answers its first fault-read frame and refuses a later one has answered: the door
 * mirrors answer `04 00` and refuse `04 01`. The result is `answered`, with the frames that came
 * back, and the refusal is told beside them rather than replacing them. What the first answer
 * means stays unread — there is no decoder — but it is the module's answer, and it is shown.
 *
 * ## Another module's answer, read by its own SGBD
 *
 * When every frame came back, the answers go through the module's own FS_LESEN code
 * (`decodeBySgbd`, lib/sgbd/results): the entries with the location and kind texts its SGBD holds,
 * the same reading INPA gives. A module whose job does not send what the app sent, or that leaves
 * the interpreter's subset, stays bytes, with where the reading stopped.
 *
 * ## The DSC MK60 is in it
 *
 * The MK60's frames are KWP2000-shaped on the same line (lib/kwpOnDs2). The scan asks it too, and
 * while the car moves as every other module's fault read (operator, 2026-11-12: the first reads,
 * 2026-11-10, were parked only). Its codes are an estimate, kept beside the bytes.
 *
 * ## What it never does
 *
 *   - Wait for the car to stop. A fault read is a read, and it goes while the car moves too
 *     (operator, 2026-11-04). The DME's speed is still read when the line goes quiet, to tell a
 *     lost line from modules that are not fitted.
 *   - Retry. A module that does not answer is `silent` — likely not fitted, which is a fact about
 *     the car worth stating — and a refusal (`rejected`) is the module's answer, recorded as said.
 *   - Read meaning into bytes by any rule but the module's own: the MSS54's decoder, or the module's
 *     own SGBD code. The bytes are kept beside either.
 *
 * Pure apart from its deps, so the rules hold in a test with a simulated K-line.
 */
import { isDs2Error, isPositiveResponse, toHex, type Ds2Frame, type RetryOptions } from '@tsunagi/ds2-core';
import { parseDtcsByStatus, type KwpDtc, type KwpFrame } from '../kwpOnDs2';
import type { JobFaultRead } from '../sgbd/faultRead';
import type { Ledger } from '../ledger';
import type { ModuleProtocol, ProtocolFrame } from '../moduleProtocol';
import { mayRunProtocolRead, type RunBlockKey } from '../runGate';
import type { Motion } from '../vehicleState';
import type { SgbdFaultRead } from '../sgbd/results';

export interface ScanTarget {
    address: number;
    /** The SGBDs that use this address. One for most; up to four. */
    modules: string[];
    /** The fault-read frames every candidate's own table carries, in the first candidate's order. */
    frames: ProtocolFrame[];
    /** The IDENT every candidate's own table carries, sent before the read. Null: they differ or have none. */
    ident: ProtocolFrame | null;
    /** The MSS54's own decoder. Null: the module's own SGBD code reads it where it can (`decodeBySgbd`). */
    decoder: 'mss54' | null;
    /** A KWP-on-DS2 module (DSC MK60): its own fault-read frames. */
    kwp?: { faults: KwpFrame[] };
}

export type ScanOutcome =
    /** It answered: every frame, or the first ones before it refused a later one (`reason` says which). */
    | 'answered'
    /** No answer: not fitted, asleep, or on a bus this line does not reach. */
    | 'silent'
    /** It refused the first fault-read frame it was sent. */
    | 'rejected'
    /** The gate held it back (withdrawn, car moving), or no frame is common to its candidates. */
    | 'refused'
    /** Not reached: the scan stopped first (car moved, stopped, link lost). */
    | 'skipped';

export interface ScanResult {
    address: string;
    modules: string[];
    outcome: ScanOutcome;
    /** The fault-read frames sent. `refused` is on the one the module answered with a refusal status. */
    exchanges: Array<{ request: string; response: string | null; refused?: string }>;
    /** The IDENT sent first and how it went. The answer's bytes are not kept here. */
    ident?: { request: string; outcome: 'answered' | 'rejected'; bytes?: number };
    reason?: string;
    /** The MSS54's decoded entries, as the decoder gives them. */
    decoded?: unknown;
    /**
     * Another module's answer read by its own SGBD's FS_LESEN (lib/sgbd/results), with the SGBD whose
     * code read it. The bytes in `exchanges` stay the answer.
     */
    sgbdFaults?: SgbdFaultRead & { module: string };
    /** A KWP-on-DS2 answer read as ISO 14230 lays a $58 out (lib/kwpOnDs2): an estimate, the bytes stay the answer. */
    kwpDtcs?: KwpDtc[];
}

export interface ScanRun {
    startedAt: number;
    endedAt: number;
    /** `not-parked` is on scans kept before fault reads went while moving (2026-11-04). */
    end: 'done' | 'not-parked' | 'stopped' | 'link-lost';
    results: ScanResult[];
}

export interface ScanDeps {
    ledger(): Ledger;
    /** The DME's speed, read now: whether the DME still answers when the line goes quiet. */
    measure(): Promise<Motion>;
    /** One exchange, told to the read record; the hook's readFrame. */
    exchange(address: number, moduleId: string, job: string, f: ProtocolFrame, options: RetryOptions): Promise<Ds2Frame>;
    /**
     * One KWP-on-DS2 exchange (the hook's kwpRead).
     * Absent: a KWP module is not asked.
     */
    kwpExchange?(moduleId: string, job: string, f: KwpFrame): Promise<{ data: Uint8Array }>;
    /**
     * The address's fault memory read by its module's own FS_LESEN job (lib/sgbd/faultRead), which
     * sends what its SGBD sends, answer by answer, through the gate. Null: no candidate carries the job
     * here, and the frames below are sent instead.
     */
    jobRead?(target: ScanTarget): Promise<{ module: string; read: JobFaultRead } | null>;
    decode?(target: ScanTarget, responses: Ds2Frame[]): unknown;
    /** A module with no decoder of its own: its answers, each with the frame sent, read by its SGBD's own code. */
    decodeBySgbd?(target: ScanTarget, exchanges: { request: string; frame: Ds2Frame }[]): Promise<(SgbdFaultRead & { module: string }) | null>;
    stopped(): boolean;
    pause(): Promise<void>;
    now(): number;
    onResult?(r: ScanResult): void;
}

/** The module select's value for every module at once: DIAGNOSIS's scan (components/shell/Chrome). */
export const ALL_MODULES = 'all';

/** Transport failures in a row that mean the line, not the modules, is gone. */
const LINE_LOST_AFTER = 8;

const hex2 = (a: number) => `0x${a.toString(16).toUpperCase().padStart(2, '0')}`;

/** The addresses to ask and what each may be sent, from every module's own protocol. */
export function scanTargets(protocols: readonly ModuleProtocol[]): ScanTarget[] {
    const byAddress = new Map<number, ModuleProtocol[]>();
    for (const p of protocols) byAddress.set(p.address, [...(byAddress.get(p.address) ?? []), p]);
    const out: ScanTarget[] = [];
    for (const [address, group] of [...byAddress].sort((a, b) => a[0] - b[0])) {
        const [first, ...rest] = group;
        const frames = first.faults.filter((f) => rest.every((p) => p.faults.some((g) => g.hex === f.hex)));
        out.push({
            address,
            modules: group.map((p) => p.moduleId),
            frames,
            ident: first.ident && rest.every((p) => p.ident?.hex === first.ident!.hex) ? first.ident : null,
            decoder: group.length === 1 && first.decoder === 'mss54' ? 'mss54' : null,
            ...(group.length === 1 && first.kwp ? { kwp: { faults: first.kwp.faults } } : {}),
        });
    }
    // The DME first: it is the one decoded, and the speed comes from it anyway.
    return out.sort((a, b) => (a.decoder === 'mss54' ? -1 : b.decoder === 'mss54' ? 1 : a.address - b.address));
}

export async function runScan(targets: readonly ScanTarget[], deps: ScanDeps): Promise<ScanRun> {
    const run: ScanRun = { startedAt: deps.now(), endedAt: deps.now(), end: 'done', results: [] };
    const push = (r: ScanResult) => {
        run.results.push(r);
        deps.onResult?.(r);
    };
    const skipRest = (from: number, reason: string) => {
        for (const t of targets.slice(from)) push({ address: hex2(t.address), modules: t.modules, outcome: 'skipped', exchanges: [], reason });
    };

    let lostInARow = 0;
    for (const [i, t] of targets.entries()) {
        if (deps.stopped()) {
            run.end = 'stopped';
            skipRest(i, 'the scan was stopped');
            break;
        }
        const base = { address: hex2(t.address), modules: t.modules };
        if (t.kwp && t.kwp.faults.length > 0 && deps.kwpExchange) {
            const result = await readKwp(t, t.kwp.faults, base, deps);
            lostInARow = 0;
            push(result);
            await deps.pause();
            continue;
        }
        // The module's own job, where one of the candidates carries it (operator, 2026-11-13).
        if (deps.jobRead && !t.decoder && !t.kwp) {
            const held = t.modules.map((m) => mayRunProtocolRead(`${m}:FS_LESEN`, 'fault-read', deps.ledger(), 'unknown')).find((g) => !g.allowed) as
                | { allowed: false; reason: RunBlockKey }
                | undefined;
            if (held) {
                push({ ...base, outcome: 'refused', exchanges: [], reason: held.reason });
                continue;
            }
            const jr = await deps.jobRead(t);
            if (jr) {
                lostInARow = jr.read.outcome === 'silent' ? lostInARow + 1 : 0;
                push({
                    ...base,
                    outcome: jr.read.outcome,
                    exchanges: jr.read.exchanges,
                    ...(jr.read.reason ? { reason: jr.read.reason } : {}),
                    // What the job found, as a recorded read's decode gives it; shown only where it reached its own verdict.
                    sgbdFaults: { ...jr.read.read, module: jr.module },
                });
                if (lostInARow >= LINE_LOST_AFTER && run.results.some((r) => r.outcome === 'answered')) {
                    if ((await deps.measure()) === 'unknown') {
                        run.end = 'link-lost';
                        skipRest(i + 1, 'the DME stopped answering too: the line, not the modules');
                        break;
                    }
                    lostInARow = 0;
                }
                await deps.pause();
                continue;
            }
        }
        if (t.frames.length === 0) {
            push({
                ...base,
                outcome: 'refused',
                exchanges: [],
                reason: t.kwp
                    ? 'KWP2000-shaped frames on the DS2 line: no fault-read frame for it on this link'
                    : t.modules.length > 1
                        ? `no fault-read frame is common to ${t.modules.join(', ')}; which one is fitted is chosen on the screen, then read`
                        : 'its SGBD carries no short fault-read frame',
            });
            continue;
        }
        const blocked = t.modules.map((m) => mayRunProtocolRead(`${m}:FS_LESEN`, 'fault-read', deps.ledger(), 'unknown')).find((g) => !g.allowed) as
            | { allowed: false; reason: RunBlockKey }
            | undefined;
        if (blocked) {
            push({ ...base, outcome: 'refused', exchanges: [], reason: blocked.reason });
            continue;
        }

        const exchanges: ScanResult['exchanges'] = [];
        const frames: Ds2Frame[] = [];
        let outcome: ScanOutcome = 'answered';
        let reason: string | undefined;
        let ident: ScanResult['ident'];
        // The identity first. Withdrawn for any candidate: it is not sent, and the read goes alone.
        const identHeld = t.modules.some((m) => !mayRunProtocolRead(`${m}:IDENT`, 'fault-read', deps.ledger(), 'unknown').allowed);
        if (t.ident && !identHeld) {
            try {
                const frame = await deps.exchange(t.address, t.modules[0], 'IDENT', t.ident, { attempts: 1 });
                ident = isPositiveResponse(frame)
                    ? { request: t.ident.hex, outcome: 'answered', bytes: frame.payload.length }
                    : { request: t.ident.hex, outcome: 'rejected' };
            } catch (e) {
                if (isDs2Error(e) && e.code === 'NEGATIVE_RESPONSE') {
                    ident = { request: t.ident.hex, outcome: 'rejected' };
                } else {
                    // Nobody at this address: the fault read would wait out the same silence.
                    outcome = 'silent';
                    reason = e instanceof Error ? e.message.slice(0, 200) : String(e);
                }
            }
        }
        const status = (n: number) => `status 0x${n.toString(16).padStart(2, '0')}`;
        // A refusal after an answer keeps the answer; the first frame refused is the module's refusal.
        const refusal = (f: ProtocolFrame, why: string) => {
            if (frames.length === 0) {
                outcome = 'rejected';
                reason = why;
            } else {
                reason = `answered ${frames.length} of ${t.frames.length} frames; ${f.hex} refused (${why})`;
            }
        };
        for (const f of outcome === 'silent' ? [] : t.frames) {
            try {
                // One attempt: silence is the answer of a module that is not there, and three tries
                // of 37 absent ones would turn a one-minute scan into five.
                const frame = await deps.exchange(t.address, t.modules[0], 'FS_LESEN', f, { attempts: 1 });
                if (!isPositiveResponse(frame)) {
                    exchanges.push({ request: f.hex, response: null, refused: status(frame.controlOrStatus) });
                    refusal(f, status(frame.controlOrStatus));
                    break;
                }
                exchanges.push({ request: f.hex, response: toHex(frame.payload) });
                frames.push(frame);
            } catch (e) {
                const why = e instanceof Error ? e.message.slice(0, 200) : String(e);
                if (isDs2Error(e) && e.code === 'NEGATIVE_RESPONSE') {
                    exchanges.push({ request: f.hex, response: null, refused: why });
                    refusal(f, why);
                } else {
                    exchanges.push({ request: f.hex, response: null });
                    // Silence after an answer is still an answer cut short; say so rather than "not fitted".
                    if (frames.length === 0) outcome = 'silent';
                    reason = frames.length === 0 ? why : `answered ${frames.length} of ${t.frames.length} frames; ${f.hex} got no answer`;
                }
                break;
            }
        }
        lostInARow = outcome === 'silent' ? lostInARow + 1 : 0;
        const result: ScanResult = { ...base, outcome, exchanges, ...(ident ? { ident } : {}), ...(reason ? { reason } : {}) };
        if (outcome === 'answered' && frames.length === t.frames.length && t.decoder && deps.decode) {
            try {
                result.decoded = deps.decode(t, frames);
            } catch (e) {
                result.reason = `decoder: ${e instanceof Error ? e.message : String(e)}`;
            }
        }
        if (outcome === 'answered' && frames.length === t.frames.length && !t.decoder && deps.decodeBySgbd) {
            try {
                const read = await deps.decodeBySgbd(t, t.frames.map((f, k) => ({ request: f.hex, frame: frames[k] })));
                if (read) result.sgbdFaults = read;
            } catch (e) {
                result.reason = `SGBD reading: ${e instanceof Error ? e.message : String(e)}`;
            }
        }
        push(result);
        // The DME answered the speed read a moment ago, so a long run of silence after it is the
        // line, not the cars' equipment. Stop rather than mark every module absent.
        if (lostInARow >= LINE_LOST_AFTER && run.results.some((r) => r.outcome === 'answered')) {
            const probe = await deps.measure();
            if (probe === 'unknown') {
                run.end = 'link-lost';
                skipRest(i + 1, 'the DME stopped answering too: the line, not the modules');
                break;
            }
            lostInARow = 0;
        }
        await deps.pause();
    }
    run.endedAt = deps.now();
    return run;
}

/**
 * The DSC MK60's turn. A withdrawal holds it back like any read. One silence does not count toward a
 * lost line: this module's answer has not been seen on a car yet.
 */
async function readKwp(t: ScanTarget, faults: readonly KwpFrame[], base: { address: string; modules: string[] }, deps: ScanDeps): Promise<ScanResult> {
    const moduleId = t.modules[0];
    const gate = mayRunProtocolRead(`${moduleId}:FS_LESEN`, 'fault-read', deps.ledger(), 'unknown');
    if (!gate.allowed) return { ...base, outcome: 'refused', exchanges: [], reason: gate.reason };
    const exchanges: ScanResult['exchanges'] = [];
    const dtcs: KwpDtc[] = [];
    let shaped = true;
    for (const f of faults) {
        try {
            const answer = await deps.kwpExchange!(moduleId, 'FS_LESEN', f);
            exchanges.push({ request: f.hex, response: toHex(answer.data) });
            const read = parseDtcsByStatus(answer.data);
            if (read) dtcs.push(...read);
            else shaped = false;
        } catch (e) {
            exchanges.push({ request: f.hex, response: null });
            return {
                ...base,
                // Not a line error: something held the read back before it went (a withdrawal, a caller's ledger verdict).
                outcome: !isDs2Error(e) ? 'refused' : e.code === 'NEGATIVE_RESPONSE' ? 'rejected' : 'silent',
                exchanges,
                reason: e instanceof Error ? e.message.slice(0, 200) : String(e),
            };
        }
    }
    return { ...base, outcome: 'answered', exchanges, ...(shaped ? { kwpDtcs: dtcs } : {}) };
}

/** A line per outcome, for the answer and the log: `answered 21 · silent 14 · refused 2`. */
export function scanCounts(results: readonly ScanResult[]): Record<ScanOutcome, number> {
    const out: Record<ScanOutcome, number> = { answered: 0, silent: 0, rejected: 0, refused: 0, skipped: 0 };
    for (const r of results) out[r.outcome]++;
    return out;
}

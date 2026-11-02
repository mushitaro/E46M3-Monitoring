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
 * ## What it never does
 *
 *   - Send anything while the car is not measured stationary. The speed is read from the DME
 *     before the first module and again every few, and a scan that cannot show the car still stops
 *     where it is.
 *   - Retry. A module that does not answer is `silent` — likely not fitted, which is a fact about
 *     the car worth stating — and a refusal (`rejected`) is the module's answer, recorded as said.
 *   - Read meaning into bytes. Only the MSS54 has a decoder; every other answer is kept as bytes.
 *
 * Pure apart from its deps, so the rules hold in a test with a simulated K-line.
 */
import { isDs2Error, isPositiveResponse, toHex, type Ds2Frame, type RetryOptions } from '@tsunagi/ds2-core';
import type { Ledger } from '../ledger';
import type { ModuleProtocol, ProtocolFrame } from '../moduleProtocol';
import { mayRunProtocolRead, type RunBlockKey } from '../runGate';
import type { Motion } from '../vehicleState';

export interface ScanTarget {
    address: number;
    /** The SGBDs that use this address. One for most; up to four. */
    modules: string[];
    /** The fault-read frames every candidate's own table carries, in the first candidate's order. */
    frames: ProtocolFrame[];
    /** The MSS54 alone is decoded. */
    decoder: 'mss54' | null;
}

export type ScanOutcome =
    /** It answered every frame. */
    | 'answered'
    /** No answer: not fitted, asleep, or on a bus this line does not reach. */
    | 'silent'
    /** It answered with a refusal. */
    | 'rejected'
    /** The gate held it back (withdrawn, car moving), or no frame is common to its candidates. */
    | 'refused'
    /** Not reached: the scan stopped first (car moved, stopped, link lost). */
    | 'skipped';

export interface ScanResult {
    address: string;
    modules: string[];
    outcome: ScanOutcome;
    exchanges: Array<{ request: string; response: string | null }>;
    reason?: string;
    /** The MSS54's decoded entries, as the decoder gives them. */
    decoded?: unknown;
}

export interface ScanRun {
    startedAt: number;
    endedAt: number;
    end: 'done' | 'not-parked' | 'stopped' | 'link-lost';
    results: ScanResult[];
}

export interface ScanDeps {
    ledger(): Ledger;
    /** The DME's speed, read now. Only `parked` lets a frame go. */
    measure(): Promise<Motion>;
    /** One exchange, told to the read record; the hook's readFrame. */
    exchange(address: number, moduleId: string, job: string, f: ProtocolFrame, options: RetryOptions): Promise<Ds2Frame>;
    decode?(target: ScanTarget, responses: Ds2Frame[]): unknown;
    stopped(): boolean;
    pause(): Promise<void>;
    now(): number;
    onResult?(r: ScanResult): void;
}

/** The module select's value for every module at once: DIAGNOSIS's scan (components/shell/Chrome). */
export const ALL_MODULES = 'all';

/** Re-measure the speed after this many addresses: a scan takes a minute, and cars move. */
export const SCAN_REMEASURE_EVERY = 6;
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
            decoder: group.length === 1 && first.decoder === 'mss54' ? 'mss54' : null,
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
        if (i % SCAN_REMEASURE_EVERY === 0) {
            const motion = await deps.measure();
            if (motion !== 'parked') {
                run.end = 'not-parked';
                skipRest(i, `not sent — the car could not be shown to be stationary (${motion})`);
                break;
            }
        }
        const base = { address: hex2(t.address), modules: t.modules };
        if (t.frames.length === 0) {
            push({
                ...base,
                outcome: 'refused',
                exchanges: [],
                reason:
                    t.modules.length > 1
                        ? `no fault-read frame is common to ${t.modules.join(', ')}; which one is fitted is chosen on the screen, then read`
                        : 'its SGBD carries no short fault-read frame',
            });
            continue;
        }
        const blocked = t.modules.map((m) => mayRunProtocolRead(`${m}:FS_LESEN`, 'module', deps.ledger(), 'parked')).find((g) => !g.allowed) as
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
        for (const f of t.frames) {
            try {
                // One attempt: silence is the answer of a module that is not there, and three tries
                // of 37 absent ones would turn a one-minute scan into five.
                const frame = await deps.exchange(t.address, t.modules[0], 'FS_LESEN', f, { attempts: 1 });
                if (!isPositiveResponse(frame)) {
                    outcome = 'rejected';
                    reason = `status 0x${frame.controlOrStatus.toString(16).padStart(2, '0')}`;
                    exchanges.push({ request: f.hex, response: toHex(frame.payload) });
                    break;
                }
                exchanges.push({ request: f.hex, response: toHex(frame.payload) });
                frames.push(frame);
            } catch (e) {
                exchanges.push({ request: f.hex, response: null });
                if (isDs2Error(e) && e.code === 'NEGATIVE_RESPONSE') {
                    outcome = 'rejected';
                } else {
                    outcome = 'silent';
                }
                reason = e instanceof Error ? e.message.slice(0, 200) : String(e);
                break;
            }
        }
        lostInARow = outcome === 'silent' ? lostInARow + 1 : 0;
        const result: ScanResult = { ...base, outcome, exchanges, ...(reason ? { reason } : {}) };
        if (outcome === 'answered' && t.decoder && deps.decode) {
            try {
                result.decoded = deps.decode(t, frames);
            } catch (e) {
                result.reason = `decoder: ${e instanceof Error ? e.message : String(e)}`;
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

/** A line per outcome, for the answer and the log: `answered 21 · silent 14 · refused 2`. */
export function scanCounts(results: readonly ScanResult[]): Record<ScanOutcome, number> {
    const out: Record<ScanOutcome, number> = { answered: 0, silent: 0, rejected: 0, refused: 0, skipped: 0 };
    for (const r of results) out[r.outcome]++;
    return out;
}

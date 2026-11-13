/**
 * Every module's fault memory, one address at a time: what the assistant's `monitoring_scan` and
 * an AI-mode investigation start from (operator, 2026-11-01: "read every module's faults without
 * choosing one").
 *
 * DS2 has no broadcast. A scan is each module's own fault read (FS_LESEN, control 0x04) sent to
 * its own address in turn, on the one link, through the same gate as the screen's READ.
 *
 * ## Which module is at an address: its IDENT first
 *
 * The module list is the E46 M3's, and a non-M3 E46 has other modules at the same addresses (MS43 at
 * 0x12, GS20 at 0x32). So an address is first asked the common IDENT (`<addr> 04 00`) wherever the
 * answer decides anything, and its group file's rule (lib/variants, generated from `D_00xx.grp`)
 * chooses the SGBD from the answer:
 *
 *   - An address with a rule (0x12, 0x32) is sent its fault read only when the rule chose a module
 *     this app carries, and then that module's own frames.
 *   - An address without one is `?`. On a car whose DME said it is the MSS54 (an M3) it keeps the M3
 *     fitment below, without an IDENT; on any other car it gets the IDENT and nothing else
 *     (`identified`), whatever it answers.
 *
 * ## Fourteen addresses hold more than one SGBD
 *
 * 0x56 is ASCMK20 on an early car and DSC_E46 on a late one; 0x5B has three IHKA variants; and so
 * on. Where no rule chooses between them yet, the house rule is that a module is sent only what its
 * own SGBD sends it, so on an M3 such an address gets only the frames EVERY candidate's table
 * carries — whichever is fitted, the bytes are its own. Most shared addresses agree byte for byte;
 * where none is common (0x50: MFL carries one, MFL2 none), the address is not asked, and says so.
 *
 * ## The identity first, as the screen does
 *
 * On the car (2026-11-12) the steering-angle sensor, the airbag and the light switch refused in a
 * scan the very frame they answered on DIAGNOSIS. The difference between the two was one frame:
 * DIAGNOSIS reads the identity when it connects, and the scan went straight to the fault read.
 * LWS5's and MRS4's own FS_LESEN send their IDENT before the read. So an address on the M3 fitment
 * is sent its IDENT first — when every candidate's table carries the same one — and silence there is
 * the module's absence. (An address with a rule has had its IDENT asked already, above.) The
 * identity's bytes are not kept in the result (they name the car's parts).
 *
 * ## An answer is kept
 *
 * A module that answers its first fault-read frame and refuses a later one has answered: the door
 * mirrors answer `04 00` and refuse `04 01`. The result is `answered`, with the frames that came
 * back, and the refusal is told beside them rather than replacing them.
 *
 * ## Another module's answer, read by its own SGBD
 *
 * Where a candidate's data carries its own FS_LESEN job, the job itself conducts the read
 * (`jobRead`, ../sgbd/faultRead; operator 2026-11-13): it sends what its SGBD sends, answer by answer,
 * each frame through the gate, and names what it found. Where none does, the frames above go, and
 * when every frame came back the answers go through the module's own FS_LESEN code (`decodeBySgbd`,
 * ../sgbd/results): the entries with the location and kind texts its SGBD holds, the same reading INPA
 * gives. A module whose job does not send what the app sent, or that leaves the interpreter's subset,
 * stays bytes, with where the reading stopped.
 *
 * ## The DSC MK60 is in it, on an M3
 *
 * The MK60's frames are KWP2000-shaped on the same line (../kwpOnDs2). On a car whose DME said it is
 * the MSS54, the scan asks it too, and while the car moves as every other module's fault read
 * (operator, 2026-11-12: the first reads, 2026-11-10, were parked only). Its answer is read by its own
 * FS_LESEN code, replayed on what came back (`decodeKwpBySgbd`, 2026-11-13); only where that does not
 * reach its end are the codes the ISO 14230 estimate, kept beside the bytes. On any other car it is not asked: which DSC is fitted is not known there.
 *
 * ## The VIN, once (intake, operator 2026-11-10)
 *
 * The instrument cluster keeps the VIN's last seven (lib/clusterVin). Once its IDENT has chosen
 * KOMBI46 or KOMBI46R (D_0080; on any car, M3 or not) and its fault read has been answered, it is
 * sent that module's own VIN read, once, and what it said goes on the run as `vin` — NOT among the
 * results' exchanges. The exchanges are what the screen shows as raw bytes, what the ledger records
 * as fault-read facts, and what the assistant's answers carry (masked for an ASCII VIN; the cluster
 * answers in BCD, which no mask would catch). Kept apart, the answer has no road there. Only the
 * seven characters are kept on the run, not the bytes. Where 0x80 has no variant (`?`, or a module
 * the app does not carry) nothing is sent and `vin` stays null.
 *
 * ## What it never does
 *
 *   - Wait for the car to stop. A fault read is a read, and it goes while the car moves too
 *     (operator, 2026-11-04). The DME is still asked when the line goes quiet (`dmeAnswers`), to
 *     tell a lost line from modules that are not fitted.
 *   - Retry. A module that does not answer is `silent` — likely not fitted, which is a fact about
 *     the car worth stating — and a refusal (`rejected`) is the module's answer, recorded as said.
 *   - Read meaning into bytes by any rule but the module's own: the MSS54's decoder (only where the
 *     address's IDENT chose the MSS54), or the module's own SGBD code. The bytes are kept beside either.
 *
 * Pure apart from its deps, so the rules hold in a test with a simulated K-line.
 */
import { isDs2Error, isPositiveResponse, toHex, type Ds2Frame, type RetryOptions } from '@tsunagi/ds2-core';
import type { Ledger } from '../ledger.ts';
import { clusterVinShort } from '../clusterVin.ts';
import type { DecodedFault } from '../faultLayouts.ts';
import { parseDtcsByStatus, type KwpDtc, type KwpFrame } from '../kwpOnDs2.ts';
import type { ModuleProtocol, ProtocolFrame } from '../moduleProtocol.ts';
import { mayRunProtocolRead, type RunBlockKey } from '../runGate.ts';
import type { JobFaultRead } from '../sgbd/faultRead.ts';
import type { SgbdFaultRead } from '../sgbd/results.ts';
import { commonIdent, isM3, mayModuleBeSent, ruleFor, type Fitment, type Fitted, type VariantRules } from '../variants.ts';

export interface ScanTarget {
    address: number;
    /** The SGBDs that use this address. One for most; up to four. */
    modules: string[];
    /** The fault-read frames every candidate's own table carries, in the first candidate's order. */
    frames: ProtocolFrame[];
    /** Each candidate's own fault-read frames: what goes once the IDENT has chosen one of them. */
    byModule: Record<string, ProtocolFrame[]>;
    /** Each candidate's own VIN read (the cluster's; lib/clusterVin), where it has one. */
    vinByModule?: Record<string, ProtocolFrame & { job: string }>;
    /** The IDENT every candidate's table carries, sent before the read on the M3 fitment. Null: they differ or have none. */
    ident: ProtocolFrame | null;
    /** The MSS54's own decoder. Null: the module's own SGBD code reads it where it can (`decodeBySgbd`). */
    decoder: 'mss54' | null;
    /** A KWP-on-DS2 module (DSC MK60): its own fault-read frames. */
    kwp?: { faults: KwpFrame[] };
}

export type ScanOutcome =
    /** It answered: every frame, or the first ones before it refused a later one (`reason` says which). */
    | 'answered'
    /**
     * It answered its IDENT, and nothing more was sent: which module it is is not known (`?`), or it
     * is one whose SGBD this app does not carry. The answer and the variant are on the result.
     */
    | 'identified'
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
    /**
     * The frames sent: the common IDENT where a rule or a car not an M3 asked it, then the fault read.
     * `refused` is on the one the module answered with a refusal status.
     */
    exchanges: Array<{ request: string; response: string | null; refused?: string }>;
    /** The module's own IDENT sent first on the M3 fitment, and how it went. The answer's bytes are not kept here. */
    ident?: { request: string; outcome: 'answered' | 'rejected'; bytes?: number };
    reason?: string;
    /** The MSS54's decoded entries, as the decoder gives them. */
    decoded?: unknown;
    /**
     * Another module's answer read by its own SGBD's FS_LESEN (../sgbd/results, ../sgbd/faultRead), with
     * the SGBD whose code read it. The bytes in `exchanges` stay the answer.
     */
    sgbdFaults?: SgbdFaultRead & { module: string };
    /** A KWP-on-DS2 answer read as ISO 14230 lays a $58 out (../kwpOnDs2): an estimate, the bytes stay the answer. */
    kwpDtcs?: KwpDtc[];
    /**
     * Another module's faults, read from these exchanges where its own SGBD reads them (../faultLayouts):
     * not yet confirmed on a car. Absent where the module has no proved layout.
     */
    faults?: DecodedFault[];
    /**
     * What the address's IDENT said, when one was sent or was already known: the SGBD its group
     * chose (null: `?`), the module that is, and on what ground the fault read went (`m3-fitment`:
     * no rule, an M3).
     */
    variant?: { sgbd: string | null; moduleId: string | null; basis?: 'identified' | 'm3-fitment' };
}

/**
 * The cluster's VIN read in a scan, apart from the results (see the header). The seven characters
 * only, never the bytes; null where the answer did not hold a short VIN where the SGBD reads it.
 */
export interface ScanVinRead {
    address: string;
    moduleId: string;
    /** The module's own job that carries the frame (`AIF_FG_NR_LESEN`, `STATUS_AIF_FG_NR_LESEN`). */
    job: string;
    outcome: 'answered' | 'rejected' | 'silent' | 'refused';
    vinShort: string | null;
    reason?: string;
}

export interface ScanRun {
    startedAt: number;
    endedAt: number;
    /** `not-parked` is on scans kept before fault reads went while moving (2026-11-04). */
    end: 'done' | 'not-parked' | 'stopped' | 'link-lost';
    results: ScanResult[];
    /** The cluster's VIN read, when one was sent; absent on scans kept before it (2026-11-11). */
    vin?: ScanVinRead | null;
}

export interface ScanIdentity {
    rules: VariantRules;
    /** The addresses the common IDENT may go to (lib/variants `identAddresses`). */
    identOk: ReadonlySet<number>;
    /** What each address has said this session. */
    fitment(): Fitment;
    /** Send the address its common IDENT (once a session) and say what it chose; the hook's. */
    identify(address: number): Promise<Fitted>;
}

export interface ScanDeps {
    ledger(): Ledger;
    identity: ScanIdentity;
    /** Whether the DME still answers, asked when the line goes quiet: lost line, or absent modules. */
    dmeAnswers(): Promise<boolean>;
    /** One exchange, told to the read record; the hook's readFrame. */
    exchange(address: number, moduleId: string, job: string, f: ProtocolFrame, options: RetryOptions): Promise<Ds2Frame>;
    /**
     * One KWP-on-DS2 exchange (the session's kwpRead).
     * Absent: a KWP module is not asked.
     */
    kwpExchange?(moduleId: string, job: string, f: KwpFrame): Promise<{ data: Uint8Array; bytes?: Uint8Array }>;
    /**
     * A KWP module's answers read by its own FS_LESEN code (../sgbd/results), replayed on what came
     * back: nothing more is sent. Null: its data carries no such code.
     */
    decodeKwpBySgbd?(moduleId: string, exchanges: { request: string; answer: Uint8Array }[]): Promise<SgbdFaultRead | null>;
    /**
     * The address's fault memory read by its module's own FS_LESEN job (../sgbd/faultRead), which
     * sends what its SGBD sends, answer by answer, through the gate. `target.modules` are the
     * candidates the IDENT left. Null: no candidate carries the job here, and the frames are sent instead.
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
const hexOf = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join(' ');

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
            byModule: Object.fromEntries(group.map((p) => [p.moduleId, p.faults])),
            ...(group.some((p) => p.vin) ? { vinByModule: Object.fromEntries(group.flatMap((p) => (p.vin ? [[p.moduleId, p.vin]] : []))) } : {}),
            ident: first.ident && rest.every((p) => p.ident?.hex === first.ident!.hex) ? first.ident : null,
            // The MSS54 is decoded wherever it is a candidate: its IDENT says whether it is the one here
            // (since 2026-11-11 0x12 also carries the non-M3 DMEs), and only then are its entries decoded.
            decoder: group.some((p) => p.decoder === 'mss54') ? 'mss54' : null,
            ...(group.length === 1 && first.kwp ? { kwp: { faults: first.kwp.faults } } : {}),
        });
    }
    // The DME first: it is the one decoded, and the speed comes from it anyway.
    return out.sort((a, b) => (a.decoder === 'mss54' ? -1 : b.decoder === 'mss54' ? 1 : a.address - b.address));
}

export async function runScan(targets: readonly ScanTarget[], deps: ScanDeps): Promise<ScanRun> {
    const run: ScanRun = { startedAt: deps.now(), endedAt: deps.now(), end: 'done', results: [], vin: null };
    const push = (r: ScanResult) => {
        run.results.push(r);
        deps.onResult?.(r);
    };
    const skipRest = (from: number, reason: string) => {
        for (const t of targets.slice(from)) push({ address: hex2(t.address), modules: t.modules, outcome: 'skipped', exchanges: [], reason });
    };

    let lostInARow = 0;
    // Something answered a moment ago, so a long run of silence after it is the line, not the car's
    // equipment. Stop rather than mark every module absent — once the DME is asked and says nothing.
    const lineLost = async (i: number): Promise<boolean> => {
        if (lostInARow < LINE_LOST_AFTER || !run.results.some((r) => r.outcome === 'answered' || r.outcome === 'identified')) return false;
        if (!(await deps.dmeAnswers())) {
            run.end = 'link-lost';
            skipRest(i + 1, 'the DME stopped answering too: the line, not the modules');
            return true;
        }
        lostInARow = 0;
        return false;
    };
    for (const [i, t] of targets.entries()) {
        if (deps.stopped()) {
            run.end = 'stopped';
            skipRest(i, 'the scan was stopped');
            break;
        }
        const base = { address: hex2(t.address), modules: t.modules };
        const id = deps.identity;
        // The DSC MK60, on an M3 (above). A withdrawal holds it back like any read.
        if (t.kwp) {
            if (t.kwp.faults.length > 0 && deps.kwpExchange && isM3(id.fitment())) {
                push(await readKwp(t, t.kwp.faults, base, deps));
                lostInARow = 0;
                await deps.pause();
                continue;
            }
            push({
                ...base,
                outcome: 'refused',
                exchanges: [],
                reason: !isM3(id.fitment())
                    ? 'KWP2000-shaped frames on the DS2 line: not asked on a car not identified as an M3'
                    : 'KWP2000-shaped frames on the DS2 line: no fault-read frame for it on this link',
            });
            continue;
        }
        // No frame common to every candidate is no obstacle where the address's rule will name the one
        // that answers and each has its own (0x32: SMG II or GS20): its IDENT is asked first, below. On an
        // M3, a candidate's own job may still read it (`jobRead`); it is refused below if none does.
        const rule = ruleFor(id.rules, t.address);
        const chosenByRule = !!rule && t.modules.every((m) => (t.byModule[m] ?? []).length > 0);
        const noFrameReason =
            t.modules.length > 1
                ? `no fault-read frame is common to ${t.modules.join(', ')}; which one is fitted is chosen on the screen, then read`
                : 'its SGBD carries no short fault-read frame';
        if (t.frames.length === 0 && !chosenByRule && !(deps.jobRead && !rule && isM3(id.fitment()))) {
            push({ ...base, outcome: 'refused', exchanges: [], reason: noFrameReason });
            continue;
        }
        // Which module answers here, and so which frames are its own.
        const exchanges: ScanResult['exchanges'] = [];
        let variant: ScanResult['variant'];
        if (rule || !isM3(id.fitment())) {
            if (!id.identOk.has(t.address)) {
                push({ ...base, outcome: 'refused', exchanges: [], reason: 'which module is here is not known (?), and the common IDENT is not its own: nothing is sent' });
                continue;
            }
            const f = await id.identify(t.address);
            exchanges.push({ request: hexOf(commonIdent(t.address)), response: f.answer });
            variant = { sgbd: f.sgbd, moduleId: f.moduleId };
            if (f.answer === null) {
                lostInARow++;
                push({ ...base, outcome: 'silent', exchanges, variant, reason: 'no answer to its IDENT' });
                if (await lineLost(i)) break;
                await deps.pause();
                continue;
            }
            lostInARow = 0;
        }
        const chosen = rule ? (id.fitment().get(t.address)?.moduleId ?? null) : t.modules[0];
        const verdict = mayModuleBeSent(t.address, chosen && t.modules.includes(chosen) ? chosen : t.modules[0], id.fitment(), id.rules);
        if (!verdict.ok || !chosen || !t.modules.includes(chosen)) {
            push({
                ...base,
                outcome: 'identified',
                exchanges,
                ...(variant ? { variant } : {}),
                reason: verdict.ok ? 'not a module this scan reads at this address' : verdict.reason,
            });
            await deps.pause();
            continue;
        }
        variant = { ...(variant ?? { sgbd: null, moduleId: null }), basis: verdict.basis };
        const modules = verdict.basis === 'identified' ? [chosen] : t.modules;
        const toSend = verdict.basis === 'identified' ? (t.byModule[chosen] ?? []) : t.frames;
        const target: ScanTarget = { ...t, modules, frames: toSend };
        // The cluster's VIN, once: only a module its IDENT chose (never on the M3 fitment alone), only
        // after it answered its fault read (by its job or by the frames), and through the same gate,
        // which a withdrawal stops.
        const vinAfter = async (outcome: ScanOutcome) => {
            const vinFrame = verdict.basis === 'identified' ? t.vinByModule?.[chosen] : undefined;
            if (vinFrame && run.vin === null && outcome === 'answered') run.vin = await readVin(t.address, chosen, vinFrame, deps);
        };

        const blocked = modules.map((m) => mayRunProtocolRead(`${m}:FS_LESEN`, 'fault-read', deps.ledger(), 'unknown')).find((g) => !g.allowed) as
            | { allowed: false; reason: RunBlockKey }
            | undefined;
        if (blocked) {
            push({ ...base, outcome: 'refused', exchanges, variant, reason: blocked.reason });
            continue;
        }

        // The module's own job, where one of the candidates carries it (operator, 2026-11-13). Not the
        // MSS54, whose own decoder reads its frames.
        if (deps.jobRead && !modules.includes('mss54')) {
            const jr = await deps.jobRead(target);
            if (jr) {
                lostInARow = jr.read.outcome === 'silent' ? lostInARow + 1 : 0;
                push({
                    ...base,
                    outcome: jr.read.outcome,
                    exchanges: [...exchanges, ...jr.read.exchanges],
                    variant,
                    ...(jr.read.reason ? { reason: jr.read.reason } : {}),
                    // What the job found, as a recorded read's decode gives it; shown only where it reached its own verdict.
                    sgbdFaults: { ...jr.read.read, module: jr.module },
                });
                await vinAfter(jr.read.outcome);
                if (await lineLost(i)) break;
                await deps.pause();
                continue;
            }
        }
        if (toSend.length === 0) {
            push({
                ...base,
                outcome: 'refused',
                exchanges,
                variant,
                reason: verdict.basis === 'identified' ? `${chosen}: its SGBD carries no short fault-read frame` : noFrameReason,
            });
            continue;
        }

        const frames: Ds2Frame[] = [];
        let outcome: ScanOutcome = 'answered';
        let reason: string | undefined;
        let ident: ScanResult['ident'];
        // On the M3 fitment, the module's own identity first (above). Withdrawn for any candidate: it is
        // not sent, and the read goes alone.
        const identHeld = modules.some((m) => !mayRunProtocolRead(`${m}:IDENT`, 'fault-read', deps.ledger(), 'unknown').allowed);
        if (verdict.basis === 'm3-fitment' && t.ident && !identHeld) {
            try {
                const frame = await deps.exchange(t.address, modules[0], 'IDENT', t.ident, { attempts: 1 });
                ident = isPositiveResponse(frame)
                    ? { request: t.ident.hex, outcome: 'answered', bytes: frame.payload.length }
                    : { request: t.ident.hex, outcome: 'rejected' };
            } catch (e) {
                if (isDs2Error(e) && e.code === 'NEGATIVE_RESPONSE') {
                    ident = { request: t.ident.hex, outcome: 'rejected' };
                } else if (isDs2Error(e) && e.code === 'NOT_SENT') {
                    // The link's guard held it back: nothing went, so it says nothing about the car.
                    outcome = 'refused';
                    reason = e.message.slice(0, 200);
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
                reason = `answered ${frames.length} of ${toSend.length} frames; ${f.hex} refused (${why})`;
            }
        };
        for (const f of outcome === 'answered' ? toSend : []) {
            try {
                // One attempt: silence is the answer of a module that is not there, and three tries
                // of 37 absent ones would turn a one-minute scan into five.
                const frame = await deps.exchange(t.address, modules[0], 'FS_LESEN', f, { attempts: 1 });
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
                } else if (isDs2Error(e) && e.code === 'NOT_SENT') {
                    exchanges.push({ request: f.hex, response: null });
                    // The link's guard held it back: nothing went, so it says nothing about the car.
                    if (frames.length === 0) outcome = 'refused';
                    reason = frames.length === 0 ? why : `answered ${frames.length} of ${toSend.length} frames; ${f.hex} not sent (${why})`;
                } else {
                    exchanges.push({ request: f.hex, response: null });
                    // Silence after an answer is still an answer cut short; say so rather than "not fitted".
                    if (frames.length === 0) outcome = 'silent';
                    reason = frames.length === 0 ? why : `answered ${frames.length} of ${toSend.length} frames; ${f.hex} got no answer`;
                }
                break;
            }
        }
        lostInARow = outcome === 'silent' ? lostInARow + 1 : 0;
        const result: ScanResult = { ...base, outcome, exchanges, variant, ...(ident ? { ident } : {}), ...(reason ? { reason } : {}) };
        const whole = outcome === 'answered' && frames.length === toSend.length;
        // Decoded only when the module that answered is the decoded one, as its IDENT chose.
        if (whole && t.decoder === 'mss54' && deps.decode && verdict.basis === 'identified' && chosen === 'mss54') {
            try {
                result.decoded = deps.decode(target, frames);
            } catch (e) {
                result.reason = `decoder: ${e instanceof Error ? e.message : String(e)}`;
            }
        }
        if (whole && !modules.includes('mss54') && deps.decodeBySgbd) {
            try {
                const read = await deps.decodeBySgbd(target, toSend.map((f, k) => ({ request: f.hex, frame: frames[k] })));
                if (read) result.sgbdFaults = read;
            } catch (e) {
                result.reason = `SGBD reading: ${e instanceof Error ? e.message : String(e)}`;
            }
        }
        push(result);
        await vinAfter(outcome);
        if (await lineLost(i)) break;
        await deps.pause();
    }
    run.endedAt = deps.now();
    return run;
}

/** One VIN read: the seven characters, or why there are none. Never throws; never keeps the bytes. */
async function readVin(address: number, moduleId: string, f: ProtocolFrame & { job: string }, deps: ScanDeps): Promise<ScanVinRead> {
    const base = { address: hex2(address), moduleId, job: f.job };
    const gate = mayRunProtocolRead(`${moduleId}:${f.job}`, 'identity-read', deps.ledger(), 'unknown');
    if (!gate.allowed) return { ...base, outcome: 'refused', vinShort: null, reason: gate.reason };
    try {
        const frame = await deps.exchange(address, moduleId, f.job, f, { attempts: 2 });
        if (!isPositiveResponse(frame)) return { ...base, outcome: 'rejected', vinShort: null, reason: `status 0x${frame.controlOrStatus.toString(16).padStart(2, '0')}` };
        const vinShort = clusterVinShort(frame.payload);
        return { ...base, outcome: 'answered', vinShort, ...(vinShort ? {} : { reason: 'the answer does not hold a short VIN where the SGBD reads it' }) };
    } catch (e) {
        const outcome = isDs2Error(e) && e.code === 'NEGATIVE_RESPONSE' ? 'rejected' : isDs2Error(e) && e.code === 'NOT_SENT' ? 'refused' : 'silent';
        // The error's text can quote the answer: kept to its code.
        return { ...base, outcome, vinShort: null, reason: isDs2Error(e) ? e.code : 'error' };
    }
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
    const answers: { request: string; answer: Uint8Array }[] = [];
    const dtcs: KwpDtc[] = [];
    let shaped = true;
    for (const f of faults) {
        try {
            const answer = await deps.kwpExchange!(moduleId, 'FS_LESEN', f);
            exchanges.push({ request: f.hex, response: toHex(answer.data) });
            if (answer.bytes) answers.push({ request: f.hex, answer: answer.bytes });
            const read = parseDtcsByStatus(answer.data);
            if (read) dtcs.push(...read);
            else shaped = false;
        } catch (e) {
            exchanges.push({ request: f.hex, response: null });
            return {
                ...base,
                // Not a line error: something held the read back before it went (a withdrawal, a caller's ledger verdict, the guard).
                outcome: !isDs2Error(e) || e.code === 'NOT_SENT' ? 'refused' : e.code === 'NEGATIVE_RESPONSE' ? 'rejected' : 'silent',
                exchanges,
                reason: e instanceof Error ? e.message.slice(0, 200) : String(e),
            };
        }
    }
    // Its own FS_LESEN reads the answers (operator, 2026-11-13: read with the SGBD's own table). Read to
    // its end, that is the reading; otherwise the ISO 14230 estimate stays, beside the bytes.
    let read: SgbdFaultRead | null = null;
    let reason: string | undefined;
    if (deps.decodeKwpBySgbd && answers.length === faults.length) {
        try {
            read = await deps.decodeKwpBySgbd(moduleId, answers);
        } catch (e) {
            reason = `SGBD reading: ${e instanceof Error ? e.message : String(e)}`;
        }
    }
    if (read && read.stopped === null && read.status === 'OKAY') return { ...base, outcome: 'answered', exchanges, sgbdFaults: { ...read, module: moduleId } };
    if (read) reason = `SGBD reading: ${read.stopped ? `stopped — ${read.stopped.reason}` : read.status ?? 'no verdict'}`;
    return { ...base, outcome: 'answered', exchanges, ...(shaped ? { kwpDtcs: dtcs } : {}), ...(read ? { sgbdFaults: { ...read, module: moduleId } } : {}), ...(reason ? { reason } : {}) };
}

/** A line per outcome, for the answer and the log: `answered 21 · silent 14 · refused 2`. */
export function scanCounts(results: readonly ScanResult[]): Record<ScanOutcome, number> {
    const out: Record<ScanOutcome, number> = { answered: 0, identified: 0, silent: 0, rejected: 0, refused: 0, skipped: 0 };
    for (const r of results) out[r.outcome]++;
    return out;
}

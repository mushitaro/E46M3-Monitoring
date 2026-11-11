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
 *   - Read meaning into bytes. Only the MSS54 has a decoder, and only an address whose IDENT chose
 *     the MSS54 is decoded; every other answer is kept as bytes.
 *
 * Pure apart from its deps, so the rules hold in a test with a simulated K-line.
 */
import { isDs2Error, isPositiveResponse, toHex, type Ds2Frame, type RetryOptions } from '@tsunagi/ds2-core';
import type { Ledger } from '../ledger.ts';
import { clusterVinShort } from '../clusterVin.ts';
import type { DecodedFault } from '../faultLayouts.ts';
import type { ModuleProtocol, ProtocolFrame } from '../moduleProtocol.ts';
import { mayRunProtocolRead, type RunBlockKey } from '../runGate.ts';
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
    /** The MSS54 alone is decoded. */
    decoder: 'mss54' | null;
    /** A KWP-on-DS2 module (DSC MK60): not in the scan, which runs while moving — it is read on its own screen, parked. */
    kwp?: boolean;
}

export type ScanOutcome =
    /** It answered every frame. */
    | 'answered'
    /**
     * It answered its IDENT, and nothing more was sent: which module it is is not known (`?`), or it
     * is one whose SGBD this app does not carry. The answer and the variant are on the result.
     */
    | 'identified'
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
    decode?(target: ScanTarget, responses: Ds2Frame[]): unknown;
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
            decoder: group.length === 1 && first.decoder === 'mss54' ? 'mss54' : null,
            ...(group.some((p) => p.kwp) ? { kwp: true } : {}),
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
        if (t.frames.length === 0) {
            push({
                ...base,
                outcome: 'refused',
                exchanges: [],
                reason: t.kwp
                    ? 'KWP2000-shaped frames on the DS2 line: read on its own screen, parked, not in the scan'
                    : t.modules.length > 1
                        ? `no fault-read frame is common to ${t.modules.join(', ')}; which one is fitted is chosen on the screen, then read`
                        : 'its SGBD carries no short fault-read frame',
            });
            continue;
        }
        // Which module answers here, and so which frames are its own.
        const id = deps.identity;
        const rule = ruleFor(id.rules, t.address);
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
        if (toSend.length === 0) {
            push({ ...base, outcome: 'refused', exchanges, variant, reason: `${chosen}: its SGBD carries no short fault-read frame` });
            continue;
        }

        const blocked = modules.map((m) => mayRunProtocolRead(`${m}:FS_LESEN`, 'fault-read', deps.ledger(), 'unknown')).find((g) => !g.allowed) as
            | { allowed: false; reason: RunBlockKey }
            | undefined;
        if (blocked) {
            push({ ...base, outcome: 'refused', exchanges, variant, reason: blocked.reason });
            continue;
        }

        const frames: Ds2Frame[] = [];
        let outcome: ScanOutcome = 'answered';
        let reason: string | undefined;
        for (const f of toSend) {
            try {
                // One attempt: silence is the answer of a module that is not there, and three tries
                // of 37 absent ones would turn a one-minute scan into five.
                const frame = await deps.exchange(t.address, modules[0], 'FS_LESEN', f, { attempts: 1 });
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
                } else if (isDs2Error(e) && e.code === 'NOT_SENT') {
                    // The link's guard held it back: nothing went, so it says nothing about the car.
                    outcome = 'refused';
                } else {
                    outcome = 'silent';
                }
                reason = e instanceof Error ? e.message.slice(0, 200) : String(e);
                break;
            }
        }
        lostInARow = outcome === 'silent' ? lostInARow + 1 : 0;
        const result: ScanResult = { ...base, outcome, exchanges, variant, ...(reason ? { reason } : {}) };
        // Decoded only when the module that answered is the decoded one, as its IDENT chose.
        if (outcome === 'answered' && t.decoder && deps.decode && verdict.basis === 'identified' && chosen === 'mss54') {
            try {
                result.decoded = deps.decode(t, frames);
            } catch (e) {
                result.reason = `decoder: ${e instanceof Error ? e.message : String(e)}`;
            }
        }
        push(result);
        // The cluster's VIN, once: only a module its IDENT chose (never on the M3 fitment alone), only
        // after it answered its fault read, and through the same gate, which a withdrawal stops.
        const vinFrame = verdict.basis === 'identified' ? t.vinByModule?.[chosen] : undefined;
        if (vinFrame && run.vin === null && outcome === 'answered') run.vin = await readVin(t.address, chosen, vinFrame, deps);
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

/** A line per outcome, for the answer and the log: `answered 21 · silent 14 · refused 2`. */
export function scanCounts(results: readonly ScanResult[]): Record<ScanOutcome, number> {
    const out: Record<ScanOutcome, number> = { answered: 0, identified: 0, silent: 0, rejected: 0, refused: 0, skipped: 0 };
    for (const r of results) out[r.outcome]++;
    return out;
}

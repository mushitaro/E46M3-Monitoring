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
 * over an SGBD name and comment. The final check is made against the CONTROL
 * BYTE OF THE FRAME THAT WOULD ACTUALLY GO OUT, which does not depend on our
 * opinion of the job at all.
 *
 * **That check is NOT the backstop this comment used to claim it was.** It said
 * "if the classifier were ever wrong, this is the check that stops the car being
 * touched", and on this ECU that is false. Measured, on the shipped data:
 *
 *   - `12 05 0b 13 0f` is emitted by EIGHT MSS54 jobs. Five are classified
 *     `read`; three are classified `test`, including START_SYSTEMCHECK_DMTL_ECOS,
 *     STEUERN_SLS_CHECK and STEUERN_TEV_CHECK. An actuating job and a reading job
 *     are byte-for-byte identical.
 *   - The reason is that `0x0b` is not "a read command". It is *invoke status/IO
 *     block N*, and the discriminator is byte 3 — the Auswahlbyte — which this
 *     file never looks at (`bytes[2]` only). An allowlist of control bytes cannot
 *     separate reads from actuations inside that family.
 *   - STEUERN_SG_AUTOSYNC ("perform automatic idle synchronisation") has a
 *     `single`-graded telegram, no arguments, and control `0x0b` — on the
 *     allowlist. It is stopped by the CLASS check and by nothing else.
 *
 * So the layers are not redundant, and the class check is load-bearing rather
 * than advisory. What the byte check does buy is real but narrower: it refuses a
 * frame whose command is outright mutating (`0x0c` actuator, `0x05` clear), and
 * it refuses a malformed frame. It cannot vouch for a `0x0b`.
 *
 * How much of it is exercised, precisely — an earlier version of this comment
 * said "right about all 323 today", which was inflation:
 *
 *   149 jobs are classified `read`.
 *     8 of those have a `single`-graded telegram, so we know their bytes.
 *     5 of those take no arguments and reach the control-byte check.
 *     0 of those carry a control byte outside the allowlist.
 *
 * The one job that made the shortfall concrete was STATUS_TANK_DICHTHEIT, whose
 * own SGBD comment reads "Tankleckpruefung mit DMTL anstossen" — trigger the tank
 * leak test — and which was classified `read` because its NAME begins with
 * STATUS_. It is a `test` now (classify.py reads the comment before the name), and
 * on the day it was not, the only thing between it and the car was its telegram
 * happening to be graded `shared`.
 *
 * ## What is allowed out of the box
 *
 * Since 2026-11-15 it is the owner's decision (`policy.ts`): every job has a nature, and each
 * nature a when (moving / parked), a how far (run / show / off) and a who (screen / assistant).
 * A read goes as before, its frame carrying a read control byte, and goes while moving where the
 * owner said so. A job that drives something goes when its nature is `run`, its frame is certain
 * and takes no arguments, and the car is not moving; the
 * verdict carries its terms and `permitFor` the permit the link checks against the exact bytes,
 * before measuring the car (stationary, battery, engine) and sending. `show` is on the screen and
 * never sent; `off` is not on the screen.
 *
 * PRACTICE first is the build's, not each device's (owner, 2026-11-26, docs/NO-STOP.md D1): every item
 * the owner's table runs is run through the link session on the practice car by CI
 * (src/lib/practiceEveryItem.test.ts) before a build is delivered, so the send path never first runs on
 * a car. The ledger still records the PRACTICE runs a device makes; it no longer holds a run back.
 *
 * Fault-memory clearing is the exception and it is handled separately — see
 * `clearFaultsCommand`.
 */

import { Ds2Control } from '@tsunagi/ds2-core';
import type { CatalogJob } from './ecuCatalog.ts';
import { mayReadWhileMoving, withdrawn, type Ledger } from './ledger.ts';
import { DEFAULT_RUN_TIMEOUT_S, OWNER_DECISION, decisionFor, isReadNature, type Nature, type PolicyWho } from './policy.ts';
import { isAgreedFor, runName, type AgreedFrame } from './sgbd/agreedFrame.ts';
import { telegramIsCertain, type Telegram } from './telegrams.ts';
import type { Motion } from './vehicleState.ts';

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

/**
 * Control bytes that read on ONE module only.
 *
 * A control byte means what the module's own SGBD makes it mean, and some mean different things on
 * different modules. `0x40` is SMG II's "Abgleichwerte lesen (Kontrollbyte 0x40)" — its SGBD says
 * so in the comments of both jobs that use it (ADAPTIONSWERTE_LESEN: clutch, gearbox and gearbox
 * data by argument 0, 1, 2; GETRIEBEDATEN_LESEN: the gearbox data without an argument). On the
 * MSS54 the same byte heads ABGLEICHFLAG_SCHREIBEN, a write; on the navigation it reads system
 * parameters. So it is not in the list above, and it reads only where it is listed here.
 */
export const MODULE_READ_ONLY_CONTROLS: Readonly<Record<string, ReadonlySet<number>>> = {
    smg2: new Set([0x40]),
};

/**
 * The access frames a module's own read job sends before it reads (operator, 2026-11-13: 「全部読めるように」).
 *
 * The airbag modules answer their fault memory only after a login their own FS_LESEN sends first:
 * MRS3's `SG_LOGIN` (`a4 06 90 ff ff`, sent at the head of every MRS3 job, IDENT included) and MRS4's
 * access with the code its job builds from the identity it just read (`a4 08 95 …`). They change
 * nothing the module keeps; they open the session the read runs in, as INPA's fault read does. They go
 * only as part of that module's own job run by the app (lib/sgbd/faultRead), never on their own and
 * never to another module.
 */
export const MODULE_JOB_ACCESS_CONTROLS: Readonly<Record<string, ReadonlySet<number>>> = {
    mrs3: new Set([0x90]),
    mrs4: new Set([0x90, 0x95]),
};

/**
 * Whether a frame a module's own read job built may go to that module: addressed to it, its length
 * byte true, and a read — or one of the access frames its own job sends first (above).
 */
export function mayJobSend(moduleId: string, address: number, frame: Uint8Array): { ok: true; control: number; payload: Uint8Array } | { ok: false; why: string } {
    if (frame.length < 3) return { ok: false, why: 'a frame too short to send' };
    if (frame[0] !== address) return { ok: false, why: `addressed to 0x${frame[0].toString(16)}, not this module (0x${address.toString(16)})` };
    if (frame[1] !== frame.length + 1) return { ok: false, why: 'its length byte does not match' };
    const control = frame[2];
    if (!isReadOnlyControl(control, moduleId) && !(MODULE_JOB_ACCESS_CONTROLS[moduleId]?.has(control) ?? false)) {
        return { ok: false, why: `control 0x${control.toString(16).padStart(2, '0')} is not a read` };
    }
    return { ok: true, control, payload: frame.slice(3) };
}

/** A read on this module: in the common list, or in the module's own. */
export function isReadOnlyControl(control: number, moduleId: string): boolean {
    return READ_ONLY_CONTROLS.has(control) || (MODULE_READ_ONLY_CONTROLS[moduleId]?.has(control) ?? false);
}

export type RunBlockKey =
    | 'run_block_programming'
    | 'run_block_identity'
    | 'run_block_noTelegram'
    | 'run_block_needsArgs'
    | 'run_block_notRead'
    | 'run_block_controlWrites'
    | 'run_block_revoked'
    | 'run_block_moving'
    | 'run_block_policyShow'
    | 'run_block_policyOff';

/**
 * What the link must measure immediately before the bytes go.
 *
 * `parked`: read the car's speed first and send only if it is measured zero (useDs2Link's
 * preflight). `none`: the owner cleared this read for a moving car. The decision is made here;
 * the measurement is made at the wire, because a verdict computed at render time is already
 * stale by the time someone presses the button.
 */
export type SendRequirement = 'parked' | 'none';

/**
 * The terms a job that drives something runs on, from the owner's decision (policy.ts) and the
 * job's own SGBD: who may start it, the engine state its SGBD asks for (measured before the send),
 * how long it may stay on, and the job that stops it.
 */
export interface ActuationTerms {
    nature: Nature;
    who: PolicyWho;
    /** `off`: the SGBD asks for the engine stopped; `run`: running; null: it says nothing. */
    engine: 'off' | 'run' | null;
    /** Stopped after this many seconds: the SGBD's own limit, else DEFAULT_RUN_TIMEOUT_S. */
    timeoutS: number;
    stopJob: string | null;
}

export type RunVerdict =
    | { allowed: true; telegram: Telegram; control: number; requires: SendRequirement; actuation?: ActuationTerms; args?: readonly string[] }
    | { allowed: false; reason: RunBlockKey };

/**
 * What lets a frame that is not a read leave on a vehicle: issued by `permitFor` from an allowed
 * verdict, checked by the link session against the exact frame (module, job, bytes) before it goes.
 * A stop permit (`kind: 'stop'`) is the release of a run already started; it is never held back by
 * a measurement.
 */
export interface ActuationPermit {
    /** `run`: a start, measured first. `follow`: the same running thing asked again (a procedure's
     *  status re-ask), not measured again. `stop`: its release, never held back. */
    kind: 'run' | 'follow' | 'stop';
    moduleId: string;
    jobId: string;
    hex: string;
    engine: 'off' | 'run' | null;
    issuedAt: number;
    /**
     * A job that sends several frames: all of them, in order (`hex` the first), as its own code and
     * EdiabasLib send them (sgbd/agreedFrame). The link runs the job and sends each frame it builds
     * only if it is the next of these (or one already sent, a status it asks again).
     */
    sequence?: string[];
    /** The values the job runs with, for a link that runs its code (a sequence, a KWP-on-DS2 module). */
    args?: string[];
}

/** A permit for an allowed verdict that drives something; null for a read. */
export function permitFor(verdict: RunVerdict, moduleId: string, jobId: string, now: number): ActuationPermit | null {
    if (!verdict.allowed || !verdict.actuation) return null;
    const seq = verdict.telegram.sequence;
    return {
        kind: 'run',
        moduleId,
        jobId,
        hex: normHex(verdict.telegram.hex),
        engine: verdict.actuation.engine,
        issuedAt: now,
        ...(seq && seq.length > 1 ? { sequence: seq.map(normHex) } : {}),
        ...(verdict.args ? { args: [...verdict.args] } : {}),
    };
}

/** The release of a run that a permit started: its stop job's frame, sent whatever is measured. */
export function stopPermit(run: ActuationPermit, stopJobId: string, stopHex: string): ActuationPermit {
    return { kind: 'stop', moduleId: run.moduleId, jobId: stopJobId, hex: normHex(stopHex), engine: null, issuedAt: run.issuedAt };
}

/** A stop permit for a stop that sends several frames, or runs with values (a run's own job, or its stop job's). */
export function stopPermitOf(run: ActuationPermit, stopJobId: string, stop: { hex: string; sequence?: readonly string[] }, args?: readonly string[]): ActuationPermit {
    return {
        ...stopPermit(run, stopJobId, stop.hex),
        ...(stop.sequence && stop.sequence.length > 1 ? { sequence: stop.sequence.map(normHex) } : {}),
        ...(args ? { args: [...args] } : {}),
    };
}

/** How long a run permit stays good: from the press to the bytes. A stop permit does not expire. */
export const PERMIT_MAX_AGE_MS = 120_000;

/** Whether a permit is for exactly this frame (one of the frames of its sequence), now. */
export function permitCovers(permit: ActuationPermit, moduleId: string, jobId: string, hex: string, now: number): boolean {
    const h = normHex(hex);
    if (permit.moduleId !== moduleId || permit.jobId !== jobId || (permit.hex !== h && !(permit.sequence ?? []).includes(h))) return false;
    return permit.kind !== 'run' || now - permit.issuedAt <= PERMIT_MAX_AGE_MS;
}

/**
 * A module's own procedure — SMG II's TESTPRG_STARTEN with a program number — under the owner's
 * decision (`p_smg`, 2026-11-15): run, parked. Each program has run in PRACTICE in the build
 * (src/lib/practiceEveryItem.test.ts; owner, 2026-11-26). The ledger keeps each program apart
 * (`smg2:TESTPRG_STARTEN(0x01)`), so a withdrawal of one stops only that one. Its frame is built from
 * the job's own arguments (lib/procedureRun).
 */
export function mayRunProcedure(
    moduleId: string,
    startJob: Pick<CatalogJob, 'id' | 'class'>,
    program: string,
    ledger: Ledger,
    motion: Motion,
): { allowed: true; id: string } | { allowed: false; reason: RunBlockKey } {
    const decision = decisionFor(moduleId, startJob);
    if (decision.how === 'off') return { allowed: false, reason: 'run_block_policyOff' };
    if (decision.how === 'show') return { allowed: false, reason: 'run_block_policyShow' };
    const id = `${moduleId}:${startJob.id}(${program})`;
    if (withdrawn(ledger, id) || withdrawn(ledger, `${moduleId}:${startJob.id}`)) return { allowed: false, reason: 'run_block_revoked' };
    if (motion === 'moving') return { allowed: false, reason: 'run_block_moving' };
    return { allowed: true, id };
}

/** The three permits a procedure runs on: its start (measured), its status re-asks, its stop. */
export function procedurePermits(
    moduleId: string,
    start: { jobId: string; hex: string },
    stop: { jobId: string; hex: string },
    engine: 'off' | 'run' | null,
    now: number,
): { start: ActuationPermit; follow: ActuationPermit; stop: ActuationPermit } {
    const base = { moduleId, engine, issuedAt: now };
    return {
        start: { ...base, kind: 'run', jobId: start.jobId, hex: normHex(start.hex) },
        follow: { ...base, kind: 'follow', jobId: start.jobId, hex: normHex(start.hex), engine: null },
        stop: { ...base, kind: 'stop', jobId: stop.jobId, hex: normHex(stop.hex), engine: null },
    };
}

const normHex = (hex: string) => hex.trim().toLowerCase().replace(/\s+/g, ' ');

export interface RunContext {
    moduleId: string;
    /**
     * Whether the car is standing still, as last measured (`lib/vehicleState`). Required: a caller
     * that has not thought about it must not get a default. `unknown` is not a refusal here — the
     * link measures before it sends — but it is never treated as `parked` either.
     */
    motion: Motion;
    /** The module's group in the index (engine, comfort, …): part of how a job's nature is judged. */
    group?: string;
    /** Values chosen for the job's arguments, where its nature depends on one. */
    args?: readonly string[];
    /**
     * For a job that takes values: the frame for `args` that the app and EdiabasLib build alike
     * (sgbd/agreedFrame.ts). Without it, or when it is not for this job, these values and the
     * telegram handed in, a job that takes values is refused: a scraped frame carries values nobody chose.
     */
    agreed?: AgreedFrame;
}

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
    // DS2: the length byte counts the whole frame, checksum included. KWP on DS2 (the DSC MK60,
    // kwpOnDs2): `B8 <target> F1 <LL> …`, LL counting the data.
    const kwp = out[0] === 0xb8 && out[2] === 0xf1 && out.length === out[3] + 5;
    if (!kwp && out[1] !== out.length) return null;
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
    ctx: RunContext,
): RunVerdict {
    // The owner's decision for this job (policy.ts, 2026-11-15): when, how far, who.
    const decision = decisionFor(ctx.moduleId, job, ctx.group, ctx.args);
    if (decision.how === 'off') {
        // Same refusal, and the sentence a reader of the job's class expects.
        if (job.class === 'programming') return { allowed: false, reason: 'run_block_programming' };
        if (job.class === 'identity') return { allowed: false, reason: 'run_block_identity' };
        return { allowed: false, reason: 'run_block_policyOff' };
    }
    if (job.catalogOnly) return { allowed: false, reason: 'run_block_noTelegram' };
    if (!isReadNature(decision.nature)) return mayDrive(job, telegram, ledger, ctx, decision);

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
    // happened to hold; we did not choose them. It goes only as the frame built
    // for the chosen values by the job's own code, where EdiabasLib builds the
    // same (ctx.agreed). (The block reads the operator CAN vary — live values and
    // adaptation blocks — are built from the protocol in ds2-core, not from a
    // scrape, and do not come through here.)
    if (job.args.length > 0 && !isAgreedFor(ctx.agreed, ctx.moduleId, job.id, ctx.args, telegram.hex)) return { allowed: false, reason: 'run_block_needsArgs' };

    const bytes = telegramBytes(telegram.hex);
    if (!bytes) return { allowed: false, reason: 'run_block_noTelegram' };
    const control = bytes[2];

    // The bytes have the last word. If our classification says `read` and the
    // frame says otherwise, the frame is what the car would receive.
    if (!isReadOnlyControl(control, ctx.moduleId)) {
        return { allowed: false, reason: 'run_block_controlWrites' };
    }

    // A withdrawal applies to reads too. The ledger used to be consulted only for non-reads, so a
    // kill list could not stop a read whose frame turned out to be wrong.
    const id = `${ctx.moduleId}:${job.id}`;
    if (withdrawn(ledger, id)) return { allowed: false, reason: 'run_block_revoked' };

    // The car. A read the owner cleared for a moving car goes whatever the speed; any other read
    // goes only to a car measured stationary, and a car measured moving is refused here so the
    // screen can say so. Unknown is left to the preflight at the wire.
    if (decision.when === 'moving' || mayReadWhileMoving(ledger, id)) return { allowed: true, telegram, control, requires: 'none' };
    if (ctx.motion === 'moving') return { allowed: false, reason: 'run_block_moving' };
    return { allowed: true, telegram, control, requires: 'parked' };
}

/**
 * A job that drives something — an output, a check, a simulation, a reset, a procedure, a clear —
 * under the owner's decision. Its frame does not carry a read control byte; the link lets it go
 * only with the permit this verdict issues (`permitFor`), and only after measuring the car.
 */
function mayDrive(job: CatalogJob, telegram: Telegram | null, ledger: Ledger, ctx: RunContext, decision: ReturnType<typeof decisionFor>): RunVerdict {
    if (decision.how === 'show') return { allowed: false, reason: 'run_block_policyShow' };
    if (!telegramIsCertain(telegram)) return { allowed: false, reason: 'run_block_noTelegram' };
    // Every nature that drives something was decided `parked` (2026-11-15). Said before the values: a
    // car measured moving is the reason it cannot run now, whichever set is chosen (IJ F09).
    if (ctx.motion === 'moving') return { allowed: false, reason: 'run_block_moving' };
    // Arguments are chosen on the screen and the frame built by the job's own SGBD, and it goes only
    // where EdiabasLib builds the same for those values (ctx.agreed); a scraped frame carries values
    // nobody chose.
    if (job.args.length > 0 && !isAgreedFor(ctx.agreed, ctx.moduleId, job.id, ctx.args, telegram.hex)) return { allowed: false, reason: 'run_block_needsArgs' };
    const bytes = telegramBytes(telegram.hex);
    if (!bytes) return { allowed: false, reason: 'run_block_noTelegram' };
    const id = `${ctx.moduleId}:${job.id}`;
    // A job that takes values is withdrawn and recorded per part it drives (agreedFrame.runName).
    const runId = `${ctx.moduleId}:${runName(job.id, job.args.length ? ctx.args : undefined)}`;
    if (withdrawn(ledger, id) || withdrawn(ledger, runId)) return { allowed: false, reason: 'run_block_revoked' };
    // A job whose own SGBD asks for the car stationary goes parked whatever is decided
    // (OWNER_RULES.sgbdStationaryWins): measured again at the wire before it is sent.
    return { allowed: true, telegram, control: bytes[2], requires: 'parked', actuation: actuationTerms(job, decision), ...(job.args.length ? { args: [...(ctx.args ?? [])] } : {}) };
}

/** The terms a job that drives something runs on: its decision, and its own SGBD's engine state, limit and stop. */
export function actuationTerms(job: CatalogJob, decision: { nature: Nature; who: PolicyWho }): ActuationTerms {
    const engine = job.preconditions.includes('engine_off') ? 'off' : job.preconditions.includes('engine_running') ? 'run' : null;
    // The ECU's own time-out first (SMG II: "Steuergeraete-Timeout: 10s"): the app stops a hold when the
    // module itself would drop it unattended, not at the longest it can be held by keeping diagnosis up
    // (SMG II's "maximal 60 sek."). The read-back, the dialog, the running row and the assistant's answer
    // all state this one number (the owner's lead, 2026-11-20).
    const sgbdTimeout = job.op?.ecuTimeoutSec ?? job.op?.maxHoldSec ?? null;
    return {
        nature: decision.nature,
        who: decision.who,
        engine,
        timeoutS: typeof sgbdTimeout === 'number' && sgbdTimeout > 0 ? sgbdTimeout : DEFAULT_RUN_TIMEOUT_S,
        stopJob: job.op?.stopJob ?? null,
    };
}

/**
 * Where the evidence that a protocol-built read is harmless on a moving car comes from.
 *
 *   - `dme-measured`: an MSS54 live block (0x0B) or a master-window RAM read (0x06). TUNER sends
 *     both on this car while it drives, every sample, and has for months (its VE profile reads
 *     block 3 every sample and block 19 every eighth; `ramMap.ts` there records why 0x06 in those
 *     windows is a byte copy with a weaker command mask than 0x0B). That is a measurement.
 *   - `fault-read`: a module's own identity and fault-memory read (IDENT, FS_QUICKTEST, FS_LESEN),
 *     the frames its own SGBD sends for them (lib/moduleProtocol). Sent while the car moves too
 *     (operator, 2026-11-04: "read the fault codes while driving"). Clearing the fault memory is
 *     not a read and stays parked, on the screen, behind its confirmation.
 *   - `identity-read`: the instrument cluster's VIN read (KOMBI46 / KOMBI46R, AIF block 2,
 *     `80 05 02 02`; lib/clusterVin), sent once in a scan so the store can match the car (operator,
 *     2026-11-10). It is an identification like IDENT and treated as IDENT is: it does not wait for
 *     the car to stop, and a withdrawal stops it. Its control byte (0x02) is NOT a read on every
 *     module — on SMG II it starts a learning procedure — so it is never added to
 *     READ_ONLY_CONTROLS: it goes only as the cluster's own frame, picked by moduleProtocol.
 *   - `status-read`: learned values read by the probe — the MSS54's adaptation blocks, SMG II's
 *     ADAPTIONSWERTE_LESEN. The owner's table files them where a catalogue read of the same values
 *     goes (`r_status`, policy.ts), so they follow its `when` like that read does: before
 *     2026-11-27 they were held to a parked car by this gate alone, while the same SMG II job read
 *     from the catalogue went while moving (docs/ASSISTANT-LAYERS.md C9, Q5).
 *   - `module`: anything else built from the protocol. Read on a moving car only once the owner
 *     has cleared it in the ledger, exactly like a catalogue read.
 */
export type ProtocolReadEvidence = 'dme-measured' | 'fault-read' | 'identity-read' | 'status-read' | 'module';

/**
 * The gate for a read the app builds from the protocol rather than takes from the catalogue: the
 * frames `lib/moduleProtocol` picks and the probe's live and RAM reads. Same file, same rules as
 * `mayRun`: a withdrawal refuses it, a moving car refuses it unless the evidence or the owner says
 * otherwise, and a stationary car is measured at the wire rather than assumed.
 *
 * `id` is the ledger's key for it: `${moduleId}:FS_LESEN`, `mss54:LIVE_19`, `mss54:RAM_FFD1A2`,
 * `kombi46r:STATUS_AIF_FG_NR_LESEN`.
 */
export function mayRunProtocolRead(
    id: string,
    evidence: ProtocolReadEvidence,
    ledger: Ledger,
    motion: Motion,
): { allowed: true; requires: SendRequirement } | { allowed: false; reason: RunBlockKey } {
    if (withdrawn(ledger, id)) return { allowed: false, reason: 'run_block_revoked' };
    if (evidence === 'dme-measured' || evidence === 'fault-read' || evidence === 'identity-read' || mayReadWhileMoving(ledger, id)) return { allowed: true, requires: 'none' };
    if (evidence === 'status-read' && OWNER_DECISION.r_status.when === 'moving') return { allowed: true, requires: 'none' };
    if (motion === 'moving') return { allowed: false, reason: 'run_block_moving' };
    return { allowed: true, requires: 'parked' };
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

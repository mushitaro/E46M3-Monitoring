/**
 * The gate for the ACTUATOR surface — the outer layer, and only the outer layer.
 *
 * `runGate.mayRun` decides what this app sends to a car. That does not change
 * here, and this module must never grow a path around it: on a vehicle,
 * `mayActuate` delegates to `mayRun` and returns its answer verbatim.
 *
 * What this adds is PRACTICE. The simulated ECU exists so the app's real
 * transmit path runs before it ever runs on an M3 — and an actuator surface that
 * only comes alive with a car attached means the first execution of the send
 * path, the argument builder, the arming state machine and the STOP path all
 * happen on the operator's own car. This codebase already has a scar from
 * exactly that: a failure path that had never once executed.
 *
 * So in PRACTICE the gate is narrower than "anything goes" and wider than
 * `mayRun`:
 *
 *   - Refused: `programming` and `identity`. Not because a simulator could be
 *     harmed, but because the labels those classes ship with say **this app does
 *     not run these**. Building a working run path for them would make the app's
 *     own sentence false, and the next person to widen the gate would find the
 *     path already built.
 *   - Refused: **a job that takes arguments**, unless it comes with the frame its
 *     own SGBD code builds for the chosen values and EdiabasLib builds the same
 *     for exactly those values (`ctx.agreed`, sgbd/agreedFrame.ts). A scraped
 *     frame embeds whatever values the SGBD's bytecode happened to hold; sending
 *     it while the gate dialog showed the operator's values would disclose a call
 *     that is not the call — which is worse than refusing, because it looks like
 *     it worked. The same rule in both modes: PRACTICE rehearses the bytes a car
 *     would get.
 *   - Refused: no telegram. There is nothing to send.
 *   - Allowed: everything else, including the non-read control bytes — that IS
 *     the surface being exercised.
 *
 * `unclassified` is allowed in PRACTICE on purpose. Its shipped caution says it
 * "cannot be run on a vehicle", which is a statement about vehicles; nothing is
 * claimed about a simulator, and refusing it here would be inventing a rule the
 * app never told the operator about.
 */
import type { CatalogJob } from './ecuCatalog.ts';
import type { Ledger } from './ledger.ts';
import { actuationTerms, isReadOnlyControl, mayRun, READ_ONLY_CONTROLS, telegramBytes, type RunVerdict } from './runGate.ts';
import { isAgreedFor, type AgreedFrame } from './sgbd/agreedFrame.ts';
import type { Telegram } from './telegrams.ts';
import { decisionFor, isReadNature } from './policy.ts';
import type { Motion } from './vehicleState.ts';

export type ActuationMode = 'vehicle' | 'practice';

/** Classes whose own label promises the app will not run them, anywhere. */
const NEVER_RUN = new Set<CatalogJob['class']>(['programming', 'identity']);

export interface ActuationContext {
    moduleId: string;
    mode: ActuationMode;
    /** As last measured. On a vehicle it goes to `mayRun` unchanged. */
    motion: Motion;
    /** The module's group in the index, for the owner's decision (policy.ts). */
    group?: string;
    /** Values chosen for a job that takes them, and their agreed frame (runGate.ts `RunContext`). */
    args?: readonly string[];
    agreed?: AgreedFrame;
}

export function mayActuate(
    job: CatalogJob,
    telegram: Telegram | null,
    ledger: Ledger,
    ctx: ActuationContext,
): RunVerdict {
    // A vehicle is attached. One decision, made in one place, unchanged.
    if (ctx.mode === 'vehicle') return mayRun(job, telegram, ledger, { moduleId: ctx.moduleId, motion: ctx.motion, group: ctx.group, args: ctx.args, agreed: ctx.agreed });

    // Not on the screen at all is not on PRACTICE's screen either (policy.ts).
    if (decisionFor(ctx.moduleId, job, ctx.group, ctx.args).how === 'off') {
        if (job.class === 'programming') return { allowed: false, reason: 'run_block_programming' };
        if (job.class === 'identity') return { allowed: false, reason: 'run_block_identity' };
        return { allowed: false, reason: 'run_block_policyOff' };
    }

    if (NEVER_RUN.has(job.class)) {
        return {
            allowed: false,
            reason: job.class === 'identity' ? 'run_block_identity' : 'run_block_programming',
        };
    }

    if (!telegram || telegram.confidence !== 'single') {
        return { allowed: false, reason: 'run_block_noTelegram' };
    }

    // A job that takes values goes only as the frame its own code builds for the chosen values, where
    // EdiabasLib builds the same (sgbd/agreedFrame.ts): PRACTICE rehearses exactly what a car would get.
    if (job.args.length > 0 && !isAgreedFor(ctx.agreed, ctx.moduleId, job.id, ctx.args, telegram.hex)) return { allowed: false, reason: 'run_block_needsArgs' };

    const bytes = telegramBytes(telegram.hex);
    if (!bytes) return { allowed: false, reason: 'run_block_noTelegram' };

    // PRACTICE measures too: the preflight runs against the simulated DME, so the path that stops
    // a read on a moving car has executed before a car is the first thing it executes against.
    // A job that drives something carries its terms in PRACTICE too, so the permit, the battery and
    // engine preflight and the time-out run here before they run on a car (policy: practice first).
    // As on a car (runGate.mayDrive): what is not a read by its nature drives something, and goes after
    // the screen's confirmation with its permit, whatever its control byte (a clear's 0x05 included).
    const decision = decisionFor(ctx.moduleId, job, ctx.group, ctx.args);
    const drives = !isReadNature(decision.nature);
    return { allowed: true, telegram, control: bytes[2], requires: 'parked', ...(drives ? { actuation: actuationTerms(job, decision) } : {}) };
}

/**
 * The last check before bytes leave — the one the link itself performs.
 *
 * This is deliberately separate from the gate above and deliberately not a
 * repeat of it: the gate reasons about a job, this reasons about the bytes that
 * are actually about to go out. It is the check that catches a hole in the gate,
 * so it must not be able to reach the same wrong answer by the same route.
 *
 * On a vehicle the rule is unconditional and always has been: a control byte
 * outside the read allowlist does not go. An allowlist and not a denylist —
 * an unrecognised control must be refused, and a denylist waves it through.
 *
 * Returns the reason to refuse, or `null` to send.
 */
export function whyNotSendable(control: number, mode: ActuationMode, moduleId?: string, permitted = false): string | null {
    if (READ_ONLY_CONTROLS.has(control)) return null;
    // A frame the gate issued a permit for, checked against these exact bytes by the caller
    // (runGate.permitCovers). The owner decided what may drive the car (policy.ts, 2026-11-15).
    if (permitted) return null;
    // A module's own reads (runGate.MODULE_READ_ONLY_CONTROLS) only to that module.
    if (moduleId && isReadOnlyControl(control, moduleId)) return null;
    if (mode === 'practice') return null;
    return `refusing to send control 0x${control.toString(16).padStart(2, '0')} — not a read`;
}

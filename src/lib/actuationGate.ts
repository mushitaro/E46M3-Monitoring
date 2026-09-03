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
 *   - Refused: a job with arguments the operator has not filled in. The point of
 *     practising is to practise the real call.
 *   - Refused: no telegram. There is nothing to send.
 *   - Allowed: everything else, including the non-read control bytes — that IS
 *     the surface being exercised.
 *
 * `unclassified` is allowed in PRACTICE on purpose. Its shipped caution says it
 * "cannot be run on a vehicle", which is a statement about vehicles; nothing is
 * claimed about a simulator, and refusing it here would be inventing a rule the
 * app never told the operator about.
 */
import type { CatalogJob } from './ecuCatalog';
import type { Ledger } from './ledger';
import { mayRun, READ_ONLY_CONTROLS, telegramBytes, type RunVerdict } from './runGate';
import type { Telegram } from './telegrams';

export type ActuationMode = 'vehicle' | 'practice';

/** Classes whose own label promises the app will not run them, anywhere. */
const NEVER_RUN = new Set<CatalogJob['class']>(['programming', 'identity']);

export interface ActuationContext {
    moduleId: string;
    mode: ActuationMode;
    /** What the operator has filled in, by argument name. */
    args?: Readonly<Record<string, string>>;
}

export function mayActuate(
    job: CatalogJob,
    telegram: Telegram | null,
    ledger: Ledger,
    ctx: ActuationContext,
): RunVerdict {
    // A vehicle is attached. One decision, made in one place, unchanged.
    if (ctx.mode === 'vehicle') return mayRun(job, telegram, ledger, { moduleId: ctx.moduleId });

    if (NEVER_RUN.has(job.class)) {
        return {
            allowed: false,
            reason: job.class === 'identity' ? 'run_block_identity' : 'run_block_programming',
        };
    }

    if (!telegram || telegram.confidence !== 'single') {
        return { allowed: false, reason: 'run_block_noTelegram' };
    }

    const filled = ctx.args ?? {};
    if (job.args.some((a) => !filled[a.name])) {
        return { allowed: false, reason: 'run_block_needsArgs' };
    }

    const bytes = telegramBytes(telegram.hex);
    if (!bytes) return { allowed: false, reason: 'run_block_noTelegram' };

    return { allowed: true, telegram, control: bytes[2] };
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
export function whyNotSendable(control: number, mode: ActuationMode): string | null {
    if (READ_ONLY_CONTROLS.has(control)) return null;
    if (mode === 'practice') return null;
    return `refusing to send control 0x${control.toString(16).padStart(2, '0')} — not a read`;
}

/**
 * What the operator has to tick before RUN becomes pressable, and what the app measures instead.
 *
 * A list of keys, computed from the job, so the rule "RUN is locked until every
 * box is ticked" can be asserted without rendering anything — and so the set of
 * boxes and the readiness test cannot be two different ideas of the same list.
 * The dialog renders one box per key and enables RUN when every key is ticked;
 * that is the whole of the logic, and both halves read this function.
 *
 * Each key is a separate statement. A single combined "I understand" would be
 * one click standing in for three different facts, which is the shape of a
 * consent nobody read.
 *
 * ## A precondition the app measures is not a box (operator, 2026-11-21)
 *
 * The battery (12 V or more), the car standing still, and the engine state a job's own SGBD asks for
 * are measured by the link immediately before the bytes go (`session.preflight` / `preflightRun`), and
 * the link refuses when one fails. A box beside them was a second, manual copy of a check the machine
 * already makes: a press that confirmed nothing. So they are shown as what was last measured
 * (`lastMeasured`), and only what the app cannot measure — and the acknowledgements of what cannot be
 * undone or stopped — stays a box. `measuredAtSend` says which, from the verdict the dialog was opened
 * with: the same verdict that issues the permit the link measures under, so the screen cannot call a
 * precondition measured that the send does not measure.
 */
import { execStyleOf } from './execStyle';
import type { CatalogJob, RunVerdict, VehicleState } from '@tsunagi/monitoring-engine';
import type { JobOperation } from '@tsunagi/monitoring-engine';
import { ENGINE_RUNNING_RPM, MIN_RUN_VOLTAGE, VEHICLE_STATE_MAX_AGE_MS, motionOf } from '@tsunagi/monitoring-engine';

export type GateCheckKey = `pre:${string}` | 'ack:irreversible' | 'ack:unreleasable';

/** The preconditions the link can measure: the battery, the speed, the engine. */
export type MeasuredPrecondition = 'voltage_ok' | 'stationary' | 'engine_off' | 'engine_running';

/** The part of an allowed verdict that says what the link measures before it sends. */
export type SendTerms = Pick<Extract<RunVerdict, { allowed: true }>, 'requires' | 'actuation'>;

/**
 * Does the link measure this precondition itself, immediately before these bytes go?
 *
 * A verdict with actuation terms is sent with a `run` permit (`permitFor`): the link measures the speed
 * (`preflight`, parked), then the battery and — where the job's SGBD asks for one — the engine state
 * (`preflightRun`). Without actuation terms only a parked read's speed is measured. Anything else the
 * job lists is the person's to confirm.
 */
export function measuredAtSend(p: string, terms: SendTerms): p is MeasuredPrecondition {
    const run = terms.actuation;
    if (p === 'stationary') return !!run || terms.requires === 'parked';
    if (!run) return false;
    if (p === 'voltage_ok') return true;
    if (p === 'engine_off') return run.engine === 'off';
    if (p === 'engine_running') return run.engine === 'run';
    return false;
}

export function requiredChecks(
    job: Pick<CatalogJob, 'preconditions'>,
    op: Pick<JobOperation, 'termination' | 'irreversible'>,
    /** The verdict the dialog opened with: what it measures before sending is not a box. */
    terms?: SendTerms,
): GateCheckKey[] {
    const keys: GateCheckKey[] = job.preconditions
        .filter((p) => !(terms && measuredAtSend(p, terms)))
        .map((p) => `pre:${p}` as const);
    // Irreversible and unreleasable are DIFFERENT claims and get different boxes.
    // "This cannot be undone" is about the state afterwards; "there is no release
    // job" is about whether the app can even try. A job can be both.
    if (op.irreversible) keys.push('ack:irreversible');
    if (execStyleOf(op) === 'pulse-unreleasable') keys.push('ack:unreleasable');
    return keys;
}

/** Is RUN pressable? Derived on every render; never stored. */
export function allChecked(required: readonly GateCheckKey[], ticked: ReadonlySet<string>): boolean {
    return required.every((k) => ticked.has(k));
}

/** How old a measurement may be and still be shown as the last one. */
export const MEASURE_SHOWN_MS = 60_000;

/**
 * The last measurement of one precondition: its value and whether it would pass the measurement the
 * link takes on the press — or `unmeasured` when nothing was read in the last `MEASURE_SHOWN_MS`.
 * The speed's age is the speed reading's (`at`); the battery's and the engine's are their own
 * (`engineAt`), since they are carried over when only the speed is read.
 *
 * `current`: read within `VEHICLE_STATE_MAX_AGE_MS`, the engine's own bound past which "a reading says
 * nothing about now". A failing reading that is current holds RUN (`holdsRun`): the car is in that
 * state now (a recording keeps it so). An older one is still shown, red, as the last measurement, but
 * does not hold RUN — the person may have stopped the engine or put a charger on since — and the press
 * measures again and decides.
 */
export type Measurement = { kind: 'unmeasured' } | { kind: 'ok' | 'bad'; value: number; current: boolean };

export function lastMeasured(p: MeasuredPrecondition, m: VehicleState | null | undefined, now: number): Measurement {
    const fresh = (at: number | null | undefined): at is number => at != null && now >= at && now - at <= MEASURE_SHOWN_MS;
    const current = (at: number) => now - at <= VEHICLE_STATE_MAX_AGE_MS;
    if (!m) return { kind: 'unmeasured' };
    if (p === 'stationary') {
        if (!fresh(m.at)) return { kind: 'unmeasured' };
        // The motion AT the reading, by the gate's own rule (both speeds, the CAN floor).
        const motion = motionOf(m, m.at);
        const value = m.speedKmh ?? m.speedCanKmh;
        if (motion === 'unknown' || value === null) return { kind: 'unmeasured' };
        return { kind: motion === 'parked' ? 'ok' : 'bad', value, current: current(m.at) };
    }
    const at = m.engineAt;
    if (!fresh(at)) return { kind: 'unmeasured' };
    const reading = (ok: boolean, value: number): Measurement => ({ kind: ok ? 'ok' : 'bad', value, current: current(at) });
    if (p === 'voltage_ok') {
        const v = m.voltageV;
        return v === null || !Number.isFinite(v) ? { kind: 'unmeasured' } : reading(v >= MIN_RUN_VOLTAGE, v);
    }
    const rpm = m.rpm;
    if (rpm === null || !Number.isFinite(rpm)) return { kind: 'unmeasured' };
    if (p === 'engine_off') return reading(rpm <= 0, rpm);
    return reading(rpm >= ENGINE_RUNNING_RPM, rpm);
}

/** Does this last measurement hold RUN? Only a failing one taken just now (see `Measurement`). */
export function holdsRun(m: Measurement): boolean {
    return m.kind === 'bad' && m.current;
}

/**
 * An SMG II procedure's preconditions the link measures before its start: the start goes with a `run`
 * permit (`procedurePermits`), so the speed, the battery and — where the procedure names one — the
 * engine state are measured immediately before it, as for any job that drives something.
 */
export function procedureMeasured(engine: string): MeasuredPrecondition[] {
    return ['voltage_ok', 'stationary', ...(engine === 'off' ? (['engine_off'] as const) : engine === 'run' ? (['engine_running'] as const) : [])];
}

/**
 * Is this one of a procedure's SGBD sentences wholly the battery's (「バッテリ電圧が十分（充電器推奨）」)?
 * That one is measured, so it is not a box; its advice stays visible as an instruction. The others
 * mix in what the app cannot measure (neutral, the fluid temperature, level ground) and stay boxes,
 * even where they also name the standstill or the engine.
 */
export function isMeasuredPrereq(p: { en: string }): boolean {
    return /^sufficient battery voltage\b/i.test(p.en.trim());
}

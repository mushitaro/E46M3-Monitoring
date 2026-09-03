/**
 * The arguments an actuator row sends, and the plan it discloses before sending.
 *
 * Three functions, all pure, because the thing they decide — the exact byte-level
 * call that is about to go to a car — is the thing the gate dialog shows the
 * operator. If the preview and the call can disagree, the disclosure is theatre.
 * So the preview is BUILT FROM the same function that builds the call.
 *
 * The predecessor had the phase values in the UI:
 *
 *     if (job.style === "hold" && nm === "SCHALTEN") out[a.name] = phase === "start" ? "ein" : "aus";
 *     if (job.id === "IO_STATUS_VORGEBEN" && nm === "TASTVERHAELTNIS" && phase === "stop") out[a.name] = "0";
 *
 * Both are now `op.startArgs` / `op.stopArgs`, quoted from the SGBD's own
 * argument comments (`Werte: 'ein', 'aus'` and `00 Stellglied nicht angesteuert`).
 * The behaviour is identical and the source of the values is now checkable.
 *
 * ## What these can and cannot do here
 *
 * **This app sends no job that takes arguments** — not on a vehicle, not in
 * PRACTICE. It has no encoder from an argument list to a DS2 frame; the only
 * frames it can send are derived from the protocol or replayed from the static
 * scrape, and a scraped frame carries whatever values the SGBD's bytecode held.
 * `mayRun` and `mayActuate` both refuse them, with that as the stated reason.
 *
 * So these functions serve DISCLOSURE. The row shows what a job would take and
 * why it cannot run; the gate shows the exact call for the jobs that can (which
 * are the zero-argument ones, where `buildArgs` returns `{}` and the plan line is
 * the bare job id). They are written for the general case because the general
 * case is what the data describes, and because a disclosure that quietly omits
 * an argument is the failure this module exists to prevent — but nothing here
 * makes an argument-taking job sendable, and nothing here should.
 */
import type { CatalogArg, CatalogJob } from './ecuCatalog';
import type { JobOperation } from './jobOps';

export type Phase = 'pulse' | 'start' | 'stop';

type ArgOp = Pick<JobOperation, 'startArgs' | 'stopArgs'>;

function imposed(op: ArgOp, phase: Phase): Record<string, string> {
    if (phase === 'start') return op.startArgs ?? {};
    if (phase === 'stop') return op.stopArgs ?? {};
    return {};
}

/**
 * The arguments the operator gets to fill in.
 *
 * An argument the START and the STOP both impose is one the two buttons already
 * answer — putting it in the form would ask the operator to choose a value that
 * is then overwritten either way. An argument only the STOP imposes stays: its
 * start value is genuinely theirs (the duty cycle to drive a pin at), and only
 * the release is fixed.
 *
 * Derived, so a job whose data changes changes the form. The predecessor
 * filtered on the literal name `SCHALTEN`.
 */
export function visibleArgs(job: Pick<CatalogJob, 'args'>, op: ArgOp): CatalogArg[] {
    const both = new Set(
        Object.keys(op.startArgs ?? {}).filter((k) => k in (op.stopArgs ?? {})),
    );
    return job.args.filter((a) => !both.has(a.name));
}

/**
 * The values that actually go out, in the job's own declared order.
 *
 * Order matters: the transport turns this into a positional argument list, so an
 * object that happens to enumerate differently is a different call.
 */
export function buildArgs(
    job: Pick<CatalogJob, 'args'>,
    op: ArgOp,
    values: Readonly<Record<string, string>>,
    phase: Phase,
): Record<string, string> {
    const fixed = imposed(op, phase);
    const out: Record<string, string> = {};
    for (const a of job.args) {
        out[a.name] = a.name in fixed ? fixed[a.name] : (values[a.name] ?? '');
    }
    return out;
}

/** `JOB(ARG=value,…)`, or bare `JOB` when it takes none. */
export function jobCallLine(jobId: string, args: Readonly<Record<string, string>>): string {
    const entries = Object.entries(args);
    if (!entries.length) return jobId;
    return `${jobId}(${entries.map(([k, v]) => `${k}=${v}`).join(',')})`;
}

/**
 * What the gate dialog discloses under PLANNED JOB.
 *
 * A hold shows BOTH lines — the start and the release — even though this press
 * sends only one of them. The operator is agreeing to a thing that stays running
 * until a second press, so the second press is part of what they are agreeing
 * to, and it is the half people forget.
 */
export function planLines(
    job: Pick<CatalogJob, 'id' | 'args'>,
    op: ArgOp,
    values: Readonly<Record<string, string>>,
    phase: Phase,
    labels: { start: string; stop: string },
): string[] {
    if (phase === 'pulse') return [jobCallLine(job.id, buildArgs(job, op, values, 'pulse'))];
    return [
        `${labels.start}: ${jobCallLine(job.id, buildArgs(job, op, values, 'start'))}`,
        `${labels.stop}: ${jobCallLine(job.id, buildArgs(job, op, values, 'stop'))}`,
    ];
}

/** Which visible arguments are still empty. Empty list = ready to run. */
export function missingArgs(
    job: Pick<CatalogJob, 'args'>,
    op: ArgOp,
    values: Readonly<Record<string, string>>,
): string[] {
    return visibleArgs(job, op)
        .filter((a) => !(values[a.name] ?? '').trim())
        .map((a) => a.name);
}

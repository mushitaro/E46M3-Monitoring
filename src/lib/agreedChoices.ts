/**
 * The sets of values a job that takes them can be run with — on the screen and by the assistant.
 *
 * A set is offered only where the app and EdiabasLib build the same frame for exactly those values
 * (`agreedCasesFrom`, the engine's sgbd/agreedFrame.ts). For a start that leaves something on, its
 * stop must be agreed too: the job's `stopArgs` laid over the same values (SMG II's
 * STEUERN_STELLGLIED: the same part with STEUERART1 = INAKTIV), or the stop job's own values (its
 * arguments taken by name from the start's, or none). A start whose stop is not agreed is not offered,
 * and a "start" that is its own stop (INAKTIV as the mode) is not a start.
 *
 * The choices are whole sets, never one value at a time: values chosen one by one can make a set
 * nobody compared.
 *
 * Pure, so vitest (node) holds it.
 */
import { agreedCases, operationFor, type AgreedFrame, type CatalogJob, type JobOperation } from '@tsunagi/monitoring-engine';

export interface AgreedChoice {
    /** The frame to send to start (or to run once). */
    start: AgreedFrame;
    /** The frame that ends it, for a start that leaves something on. */
    stop?: AgreedFrame;
    /** `HYDROPUMPE · AKTIV · 0`: the values, in the job's order. */
    label: string;
    /** The values by argument name, for the gate dialog's call lines. */
    values: Record<string, string>;
}

const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

export function agreedChoices(
    job: Pick<CatalogJob, 'id' | 'args'>,
    op: Pick<JobOperation, 'kind' | 'stopJob' | 'startArgs' | 'stopArgs'>,
    starts: readonly AgreedFrame[],
    stops: readonly AgreedFrame[],
    /** The stop job's own argument names, where the stop is another job. Absent: it takes the same as this one. */
    stopArgNames?: readonly string[],
): AgreedChoice[] {
    const names = job.args.map((a) => a.name);
    const hold = op.kind === 'hold' && !!op.stopJob;
    const stopNames = op.stopJob === job.id ? names : (stopArgNames ?? names);
    const stopArgs = op.stopArgs ?? {};
    const startArgs = op.startArgs ?? {};
    const out: AgreedChoice[] = [];
    for (const s of starts) {
        if (s.args.length !== names.length) continue;
        const values = Object.fromEntries(names.map((n, i) => [n, s.args[i]]));
        // What the start itself imposes must be what was compared.
        if (Object.entries(startArgs).some(([k, v]) => k in values && values[k] !== v)) continue;
        let stop: AgreedFrame | undefined;
        if (hold) {
            // A start that already carries its stop's values is the stop, not a start.
            if (op.stopJob === job.id && Object.keys(stopArgs).length && Object.entries(stopArgs).every(([k, v]) => values[k] === v)) continue;
            // The stop's values: its own arguments, each from what the stop imposes, else the start's same-named value.
            const want = stopNames.map((n) => (n in stopArgs ? stopArgs[n] : (values[n] ?? '')));
            stop = stops.find((x) => x.jobId === op.stopJob && same(x.args, want));
            if (!stop) continue;
        }
        out.push({ start: s, stop, label: s.args.join(' · '), values });
    }
    return out;
}

/**
 * The sets a job may run with, its stop's taken from wherever the stop lives: the same job (SMG II's
 * STEUERN_STELLGLIED, AKTIV then INAKTIV) or another job of the module (a STEUERN_…_EIN and its _AUS).
 * The screen, the assistant and the coverage count all ask this, so none of them can look for a stop
 * where another does not (2026-11-20: the screen and the assistant looked in the start's own sets).
 */
export function choicesOf(job: CatalogJob, jobs: readonly CatalogJob[], casesOf: (jobId: string) => readonly AgreedFrame[]): AgreedChoice[] {
    const op = operationFor(job);
    const hold = op.kind === 'hold' && !!op.stopJob;
    const stopJob = hold ? jobs.find((j) => j.id === op.stopJob) : undefined;
    const starts = casesOf(job.id);
    const stops = hold && stopJob ? (stopJob.id === job.id ? starts : casesOf(stopJob.id)) : [];
    return agreedChoices(job, op, starts, stops, stopJob?.args.map((a) => a.name));
}

/** `choicesOf`, with each job's agreed sets loaded for this module. */
export async function loadChoices(moduleId: string, address: number, job: CatalogJob, jobs: readonly CatalogJob[]): Promise<AgreedChoice[]> {
    const op = operationFor(job);
    const ids = [...new Set([job.id, ...(op.kind === 'hold' && op.stopJob ? [op.stopJob] : [])])];
    const loaded = new Map(await Promise.all(ids.map(async (id) => [id, await agreedCases(moduleId, address, id)] as const)));
    return choicesOf(job, jobs, (id) => loaded.get(id) ?? []);
}

export type AssistantPick =
    | { ok: true; runPhase: 'start' | 'pulse'; choice?: AgreedChoice }
    | { ok: false; reason: string; sets?: string[][] };

/**
 * What the assistant's start of a job comes to, before any gate: the phase it runs in and the set of
 * values, or why not and the sets to choose from. A job that stays on until its stop always starts
 * with the stop armed and the time-out running, whatever phase was asked (car, 2026-11-19).
 */
export function assistantPick(
    job: CatalogJob,
    choices: readonly AgreedChoice[],
    phase: 'start' | 'pulse',
    values: readonly string[] | undefined,
    openToAssistant: (args: readonly string[]) => boolean,
): AssistantPick {
    const op = operationFor(job);
    const runPhase = op.kind === 'hold' && op.stopJob ? 'start' : phase;
    if (job.args.length === 0) return { ok: true, runPhase };
    const agreed = choices.filter((c) => runPhase === 'start' || !c.stop);
    if (!agreed.length) return { ok: false, reason: `No set of values for ${job.id} has been compared with EdiabasLib: it is not run.` };
    const sets = agreed.filter((c) => openToAssistant(c.start.args));
    if (!sets.length) return { ok: false, reason: `The owner's table keeps every set of ${job.id} for a person on the screen. monitoring_stage puts it there for them to press.` };
    const choice = values ? sets.find((c) => c.start.args.length === values.length && c.start.args.every((x, i) => x === values[i])) : undefined;
    if (!choice) {
        return {
            ok: false,
            reason: values
                ? `${job.id}(${values.join(', ')}) is not one of the sets compared with EdiabasLib. Choose one of these.`
                : `${job.id} takes values (${job.args.map((a) => a.name).join(', ')}). Read back the set meant, wait for the OK, and pass it as values.`,
            sets: sets.map((c) => [...c.start.args]),
        };
    }
    return { ok: true, runPhase, choice };
}

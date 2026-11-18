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
import type { AgreedFrame, CatalogJob, JobOperation } from '@tsunagi/monitoring-engine';

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

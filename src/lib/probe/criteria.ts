/**
 * Conditions and judgements over recorded samples — computed by the tab, so the voice in the car
 * and the desk read the same number (TUNER's rule: the tab calculates, the tools read).
 *
 * A channel that is missing from a sample is not zero and not true: a clause on it does not hold,
 * and a judgement over no samples has no verdict (`pass: null`), which is a different answer from
 * failing.
 */

import type { Clause, Judge, Op } from './plan';

export type Values = Readonly<Record<string, number | null | undefined>>;

export interface ProbeSample {
    /** Seconds since the run began. */
    t: number;
    values: Values;
}

function compare(a: number, op: Op, b: number): boolean {
    switch (op) {
        case '<':
            return a < b;
        case '<=':
            return a <= b;
        case '>':
            return a > b;
        case '>=':
            return a >= b;
        case '==':
            return a === b;
        case '!=':
            return a !== b;
    }
}

/** Every clause holds on this sample. A clause on a channel the sample lacks does not hold. */
export function holds(clauses: readonly Clause[], values: Values): boolean {
    return clauses.every((c) => {
        const v = values[c.channel];
        return typeof v === 'number' && Number.isFinite(v) && compare(v, c.op, c.value);
    });
}

export interface JudgeResult {
    id: string;
    hypothesis?: string;
    /** Samples the judgement was taken over (after `where`, with the channel present). */
    n: number;
    value: number | null;
    /** Null: no samples, so no verdict — not a failure. */
    pass: boolean | null;
    provenance: Judge['provenance'];
}

export function judge(j: Judge, samples: readonly ProbeSample[]): JudgeResult {
    const xs: number[] = [];
    for (const s of samples) {
        if (j.where && !holds(j.where, s.values)) continue;
        const v = s.values[j.channel];
        if (typeof v === 'number' && Number.isFinite(v)) xs.push(v);
    }
    const base = { id: j.id, hypothesis: j.hypothesis, n: xs.length, provenance: j.provenance };
    if (j.stat === 'count') return { ...base, value: xs.length, pass: compare(xs.length, j.op, j.value) };
    if (xs.length === 0) return { ...base, value: null, pass: null };
    let value: number;
    switch (j.stat) {
        case 'max':
            value = Math.max(...xs);
            break;
        case 'min':
            value = Math.min(...xs);
            break;
        case 'mean':
            value = xs.reduce((a, b) => a + b, 0) / xs.length;
            break;
        case 'spread':
            value = Math.max(...xs) - Math.min(...xs);
            break;
    }
    return { ...base, value, pass: compare(value, j.op, j.value) };
}

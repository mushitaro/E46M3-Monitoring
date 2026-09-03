/**
 * What the operator has to tick before RUN becomes pressable.
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
 */
import { execStyleOf } from './execStyle';
import type { CatalogJob } from './ecuCatalog';
import type { JobOperation } from './jobOps';

export type GateCheckKey = `pre:${string}` | 'ack:irreversible' | 'ack:unreleasable';

export function requiredChecks(
    job: Pick<CatalogJob, 'preconditions'>,
    op: Pick<JobOperation, 'termination' | 'irreversible'>,
): GateCheckKey[] {
    const keys: GateCheckKey[] = job.preconditions.map((p) => `pre:${p}` as const);
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

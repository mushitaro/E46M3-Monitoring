/**
 * PROBE runs kept on this device (lib/sync/db.ts, store `runs`), numbered per CO-WORK record.
 *
 * The number is what a fact's evidence names (`run: 2, from: 31, to: 44`), so it is the record's,
 * not the device's: the second run of an investigation is run 2 wherever it is read. Taken when the
 * run starts, as one more than the runs the record already has here.
 *
 * WORKS-only, like lib/sync.
 */
import { inTransaction, RUNS } from '../sync/db';
import type { ProbeSample } from './criteria';
import type { ProbeRun } from './executor';

export interface StoredRun extends ProbeRun {
    id: string;
    /** The CO-WORK record the plan came from. */
    sessionId: string;
    /** 1, 2, 3 … within that record. */
    n: number;
    /** PRACTICE: the simulated car. Absent on runs kept before it was recorded. */
    mock?: boolean;
}

/** The run in progress, as the bridge reads it: whose plan, which run of that record, since when,
 *  and the samples so far (the array grows in place; read it, do not keep it). */
export interface ProbeLive {
    sessionId: string;
    n: number;
    startedAt: number;
    planV: number;
    samples: ProbeSample[];
}

/** The runs of one record, in order. */
export function listRuns(sessionId: string): Promise<StoredRun[]> {
    return inTransaction<StoredRun[]>(RUNS, 'readonly', (s, done) => {
        const req = s.index('sessionId').getAll(sessionId);
        req.onsuccess = () => done((req.result as StoredRun[]).sort((a, b) => a.n - b.n));
    });
}

export function putRun(run: StoredRun): Promise<void> {
    return inTransaction<void>(RUNS, 'readwrite', (s, done) => {
        s.put(run).onsuccess = () => done(undefined);
    });
}

/**
 * A DME's learned values (adaptations), read by its own SGBD code — for the DMEs that are not the
 * MSS54, whose adaptation blocks have their own decoder (`@tsunagi/ds2-mss54`). GREN BLUE SUITE's test
 * plan §7.2 (2): learned values on the non-M3 E46's DMEs too (MS42, MS43, BMS43, BMS46).
 *
 * Which jobs: the ones whose name says they read a learned value — an adaptation (`…ADAP…`) or the
 * lambda trims (`STATUS_ADD`, `STATUS_MUL`, `STATUS_LAMBDA_ADD_1`, …). tools/gen_sgbd_results.py
 * carries the argument-free ones of each non-M3 DME's SGBD by the same rule (`ADAPTATION_READ`).
 *
 * What is sent is not decided here: each frame is the one the job's own code builds (sgbd/jobFrame),
 * and it goes only where the run gate lets it.
 */

import type { SgbdResultsTable } from './results.ts';

/** The rule, as tools/gen_sgbd_results.py writes it. */
export const ADAPTATION_READ = /^STATUS_(.*ADAP.*|(LAMBDA_)?(ADD|MUL)(_\d)?)$/;

/** The learned-value reads whose code the module's data carries, in the order the data lists them. */
export function adaptationReadJobs(table: SgbdResultsTable | null): string[] {
    return table ? Object.keys(table.jobs).filter((j) => ADAPTATION_READ.test(j)) : [];
}

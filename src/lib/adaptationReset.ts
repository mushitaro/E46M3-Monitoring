/**
 * Which jobs erase what an ECU has learned — per module, stated, and tested
 * against the shipped catalogue.
 *
 * This started as one array of MSS54's two job ids used for all three modules,
 * which is wrong in the worst direction: SMG II has `ADAPTIONSWERTE_LOESCHEN`
 * and the pane would have printed "this module's SGBD has no adaptation-erase
 * job" over the top of a job that erases every clutch and gearbox adaptation in
 * the car. A missing entry read as a statement of absence.
 *
 * So the shape is a map with an entry per module, `[]` is a POSITIVE claim, and
 * an absent key is `unknown` rather than `none` — `resetJobsFor()` returns which
 * of the three it is, and the UI says the right sentence for each.
 *
 * `adaptationReset.test.ts` re-derives the answer from the catalogue and fails
 * if a job ever appears that is not listed here. That test is the actual
 * guarantee; this table is just where the answer is written down.
 */

/** Per module, the SGBD jobs that erase adaptation values. `[]` means: checked, there are none. */
export const ADAPTATION_RESET_JOBS: Readonly<Record<string, readonly string[]>> = {
    // ADAPT_LOESCHEN erases the lot. ADAPT_SELEKTIV_LOESCHEN takes a bitmask and
    // erases the selected blocks — a narrower blast radius, the same class of act.
    mss54: ['ADAPT_LOESCHEN', 'ADAPT_SELEKTIV_LOESCHEN'],
    smg2: ['ADAPTIONSWERTE_LOESCHEN'],
    // None. DSC's erase-shaped jobs are something else: FS_LOESCHEN and FS_INIT
    // are fault memory, DDS_RESET is the tyre-pressure system, INITIALISIERUNG is
    // the generic controller init every module has.
    dsc_e46: [],
};

export type ResetJobs =
    | { known: true; ids: readonly string[] }
    /** No entry for this module. Not the same as "none" and must not be shown as it. */
    | { known: false; ids: readonly [] };

export function resetJobsFor(moduleId: string): ResetJobs {
    const ids = ADAPTATION_RESET_JOBS[moduleId];
    return ids === undefined ? { known: false, ids: [] } : { known: true, ids };
}

/**
 * What an adaptation-erase job looks like in an id.
 *
 * Used by the test to re-derive the table from the catalogue, NOT by the app —
 * a regex over job ids is a guess, and this app does not drive writes off
 * guesses. Its job is to notice when the hand-written table above has fallen
 * behind the data, and to fail loudly when it has.
 *
 * `FS_*` is deliberately not matched: fault memory is not an adaptation, and it
 * already has its own confirmed, and separately gated, path.
 */
export const ADAPTATION_ERASE_ID = /^(ADAPT|ADAPTION|ADAPTIONSWERTE)[A-Z_]*_(LOESCHEN|RESET)$/;

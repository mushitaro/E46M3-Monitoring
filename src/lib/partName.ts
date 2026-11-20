/**
 * The part a job drives, in the owner's words.
 *
 * A job that takes values drives the part its first value names (SMG II's STEUERN_STELLGLIED:
 * HYDROPUMPE, MAGNETVENTIL_KUPPLUNG …). Where the module's own data names those parts — SMG II's
 * STELLGLIEDER table, translated in smg2-workflows.json `actuators` — the screen, the confirmation,
 * the running row, the stop notice and the assistant's answers all say that name, so the owner
 * hears 「油圧ポンプ」 and never only `HYDROPUMPE`. Where nothing names it, the value itself stands
 * (an identifier is never dressed up as a translation), and a job without values is its own name.
 *
 * Pure, so vitest (node) holds it.
 */
import type { Smg2Workflows } from './smg2Workflows';

export interface PartName {
    /** The value that names the part (HYDROPUMPE), or null for a job without values. */
    part: string | null;
    ja: string;
    en: string;
    /** Whether the module's own data named it (false: the value or the job's name stands in). */
    named: boolean;
}

/** The parts a module's own data names, by the value that selects them. */
export function partTable(moduleId: string, workflows: Smg2Workflows | null): ReadonlyMap<string, { ja: string; en: string }> {
    if (moduleId !== 'smg2' || !workflows) return new Map();
    return new Map(workflows.actuators.map((a) => [a.id, { ja: a.ja, en: a.en }]));
}

/** The part a run drives: named from the module's data where it can be, else the value, else the job. */
export function partName(
    moduleId: string,
    job: { id: string; ja?: string; en?: string } | null,
    args: readonly string[] | null | undefined,
    workflows: Smg2Workflows | null,
): PartName {
    const part = args?.[0] ?? null;
    if (part) {
        const known = partTable(moduleId, workflows).get(part);
        if (known) return { part, ja: known.ja, en: known.en, named: true };
        return { part, ja: part, en: part, named: false };
    }
    return { part: null, ja: job?.ja ?? job?.id ?? '', en: job?.en ?? job?.id ?? '', named: false };
}

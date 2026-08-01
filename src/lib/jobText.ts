'use client';

/**
 * The one written sentence a job may carry: what to know BEFORE pressing it.
 *
 * ## What this used to be, and why it is gone
 *
 * This module used to hold five slots per job — what it does, what happens on
 * the car, how you know it is OK, what to suspect, what it leaves behind —
 * generated from a component dictionary crossed with an action dictionary, with
 * hand-written overrides on top. 1315 of the 1640 fields were generated.
 *
 * On a control panel that was five headings of near-identical prose above the
 * controls, and for the fourteen SMG II procedures it was literally identical
 * text on all fourteen, because they all inherited `TESTPRG_STARTEN`'s. The
 * headings promised specifics and delivered a template.
 *
 * What replaced them is not more prose. It is the things the five slots were
 * paraphrasing at lower fidelity:
 *
 *   "what it does"        → the step list (`StepList`), from the ECU's own
 *                           activity vocabulary or the job's wire plan
 *   "how you know"        → the results, and the recorded values
 *   "what it leaves"      → the before/after numbers, and the irreversibility
 *                           callout that was always there
 *
 * A table of numbers answers "what did this change" better than a sentence can,
 * and that is the whole argument for the rework.
 *
 * ## What survives
 *
 * `caution`: the sentence you need before pressing, on the jobs where pressing
 * is consequential. It has no heading scaffolding — it is a callout, because
 * that is what it is. Only hand-written text lives here now; there is no
 * generated tier and therefore no confidence to display.
 */

export interface JobTextEntry {
    id: string;
    caution?: { ja: string; en: string };
}

export interface JobTextTable {
    schema: 2;
    module: string;
    jobs: JobTextEntry[];
}

const cache = new Map<string, JobTextTable | null>();
const indexes = new WeakMap<JobTextTable, Map<string, JobTextEntry>>();

/**
 * Returns null — not a throw — when a module has no text file. A missing file
 * must degrade the job view to "no caution written", never break it.
 */
export async function loadJobText(moduleId: string): Promise<JobTextTable | null> {
    const hit = cache.get(moduleId);
    if (hit !== undefined) return hit;
    try {
        const res = await fetch(`./ecu-data/${moduleId}.jobtext.json`, { cache: 'no-store' });
        if (!res.ok) {
            cache.set(moduleId, null);
            return null;
        }
        const table = (await res.json()) as JobTextTable;
        cache.set(moduleId, table);
        return table;
    } catch {
        cache.set(moduleId, null);
        return null;
    }
}

function indexOf(table: JobTextTable): Map<string, JobTextEntry> {
    let idx = indexes.get(table);
    if (!idx) {
        idx = new Map(table.jobs.map((j) => [j.id, j]));
        indexes.set(table, idx);
    }
    return idx;
}

/** The caution for a job, or null. Null means nobody wrote one — not that there is nothing to say. */
export function cautionFor(
    table: JobTextTable | null,
    jobId: string,
    lang: 'ja' | 'en',
): string | null {
    if (!table) return null;
    const c = indexOf(table).get(jobId)?.caution;
    if (!c) return null;
    return (lang === 'en' ? c.en : c.ja) || c.ja || c.en || null;
}

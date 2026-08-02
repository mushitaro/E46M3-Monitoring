'use client';

/**
 * "What will actually go out on the wire" — per job, when it is knowable.
 *
 * `tools/extract_telegrams.py` walks the SGBD `.prg` bytecode offline and
 * recovers the DS2 request frames each job emits. That is a STATIC scrape of a
 * bytecode interpreter, so its confidence varies and the grading matters more
 * than the bytes:
 *
 *   single   — exactly one telegram, emitted by this job and no other. These
 *              are the bytes. Cross-validated: SMG II's SEED_KEY extracts as
 *              `32 08 90 42 4d 57 05 f7`, byte-identical to what ds2-core
 *              builds from scratch, checksum included.
 *   multiple — several candidates. The job branches, and which frame goes out
 *              depends on arguments or ECU state the scrape cannot evaluate.
 *   shared   — the same frame appears under several job names. The SGBD builds
 *              the real request from arguments at run time, and the scrape
 *              recovered only the template.
 *
 * A shared telegram is NOT this job's telegram. Showing one as if it were is
 * how you send a neighbouring job's command, so the UI prints the grade next to
 * the bytes every time and the run gate treats anything below `single` as
 * unknown.
 *
 * DSC MK60 has ZERO single-graded telegrams — not in its 15 reads, not anywhere:
 * all 124 rows in its table are `shared` or `multiple`. That is a real result
 * about the module, not a gap to paper over, and it is why nothing in DSC is
 * runnable.
 *
 * (This said "all 48 jobs". 48 is the number of KEYS IN THIS TABLE; the DSC
 * catalogue has 54 jobs, six of which the scrape recovered nothing for. Two
 * different counts, and the sentence used the wrong one.)
 */

export type TelegramConfidence = 'single' | 'multiple' | 'shared';

export interface Telegram {
    /** Space-separated lowercase hex, address byte first, checksum last. */
    hex: string;
    /** The DS2 control byte. */
    cmd: number;
    /** Its human name, from the extractor's own table. */
    cmdName: string;
    occurrences: number;
    sharedWithJobs?: number;
    confidence: TelegramConfidence;
}

export interface TelegramTable {
    module: string;
    sgbd: string;
    address: number;
    source?: string;
    jobs: Record<string, Telegram[]>;
}

const cache = new Map<string, TelegramTable | null>();

/**
 * Returns null — not a throw — when a module has no table. A missing telegram
 * file must degrade the job view to "unknown", never break it: the catalogue is
 * still worth reading without one.
 */
export async function loadTelegrams(moduleId: string): Promise<TelegramTable | null> {
    const hit = cache.get(moduleId);
    if (hit !== undefined) return hit;
    try {
        const res = await fetch(`./ecu-data/${moduleId}.telegrams.json`, { cache: 'no-store' });
        if (!res.ok) {
            cache.set(moduleId, null);
            return null;
        }
        const table = (await res.json()) as TelegramTable;
        cache.set(moduleId, table);
        return table;
    } catch {
        cache.set(moduleId, null);
        return null;
    }
}

/** The best telegram for a job, or null. Best = the highest confidence present. */
export function bestTelegram(table: TelegramTable | null, jobId: string): Telegram | null {
    const list = table?.jobs[jobId];
    if (!list || list.length === 0) return null;
    const rank: Record<TelegramConfidence, number> = { single: 3, multiple: 2, shared: 1 };
    return list.reduce((best, t) => (rank[t.confidence] > rank[best.confidence] ? t : best));
}

/**
 * Is this job's request known well enough to send?
 *
 * Only `single`. This is the gate's input, and it is deliberately strict — the
 * cost of being wrong is a neighbouring job's command reaching a car.
 */
export function telegramIsCertain(t: Telegram | null): t is Telegram {
    return !!t && t.confidence === 'single';
}

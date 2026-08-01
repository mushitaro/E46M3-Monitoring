'use client';

/**
 * The owner-facing explanation of a job: what it does, what you will see, how you
 * know it worked, what to suspect if it did not, and what it leaves behind.
 *
 * ## Why this is a separate file from the catalogue
 *
 * The catalogue is generated from the SGBD and is authentic ECU data. This is
 * NOT: it is `tools/jobtext/`, which builds five sentences per job out of a
 * 105-entry component dictionary crossed with an 11-entry action dictionary, and
 * then lets `tools/jobtext/overrides/` replace any of them with text somebody
 * actually wrote. Keeping the two apart is what makes it possible to say, per
 * field, which one you are reading.
 *
 * ## Confidence is per FIELD, not per job
 *
 * A job with a hand-written `does` and a templated `fail` is the normal case, and
 * the reader is entitled to know which is which. A generic "if it fails, check
 * the wiring" under a heading that promises to tell you what went wrong is worse
 * than an empty space, because it looks like an answer.
 *
 * That is also why `calibration` and `programming` jobs cannot ship a templated
 * `fail` or `after` at all — the generator refuses to emit one and exits non-zero.
 * A sentence about what an irreversible write leaves behind has to be about THAT
 * write.
 *
 * ## Absence is a state, not a blank
 *
 * `loadJobText` returns null rather than throwing, like `loadTelegrams`: the
 * catalogue is still worth reading without the plain-language layer. But a
 * missing explanation is never rendered as empty space — `resolve()` falls back
 * to the SGBD's German original and says outright that no plain-language version
 * exists. An empty cell reads as "nothing to say here", which is a different
 * claim entirely.
 */

/** The five questions, in the order an owner asks them. */
export const SLOTS = ['does', 'observe', 'pass', 'fail', 'after'] as const;
export type Slot = (typeof SLOTS)[number];

/** `caution` is optional and sits apart: it is read BEFORE pressing, not after. */
export type TextKey = Slot | 'caution';

export type Confidence =
    /** Somebody wrote this sentence about this job. */
    | 'authored'
    /** Generated from the component × action dictionaries. */
    | 'template'
    /** Generated, but the component had no "where it is / what it does" phrase, so it is thin. */
    | 'template-thin'
    /** There is no entry at all. The German original is shown instead. */
    | 'missing';

export interface JobTextEntry {
    id: string;
    text: Partial<Record<TextKey, { ja: string; en: string }>>;
    confidence: Partial<Record<TextKey, Exclude<Confidence, 'missing'>>>;
    /** Which dictionary entries produced it. Absent on fully-authored jobs. */
    from?: { component: string; action: string };
}

export interface JobTextTable {
    schema: 1;
    module: string;
    jobs: JobTextEntry[];
}

const cache = new Map<string, JobTextTable | null>();
const indexes = new WeakMap<JobTextTable, Map<string, JobTextEntry>>();

/**
 * Returns null — not a throw — when a module has no text file. A missing file
 * must degrade the job view to the German originals, never break it.
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

export function jobTextFor(table: JobTextTable | null, jobId: string): JobTextEntry | null {
    if (!table) return null;
    let idx = indexes.get(table);
    if (!idx) {
        idx = new Map(table.jobs.map((j) => [j.id, j]));
        indexes.set(table, idx);
    }
    return idx.get(jobId) ?? null;
}

export interface ResolvedText {
    text: string;
    confidence: Confidence;
    /**
     * The SGBD's German, when this is the fallback. Set only for `missing`,
     * because that is the only case where the German IS the explanation rather
     * than a source shown beside one.
     */
    original?: string;
}

/**
 * One field, resolved, with a confidence the caller is expected to render.
 *
 * `fallbackDe` is the job's own German comment. When there is no written
 * explanation the caller gets that plus `confidence: 'missing'`, and the UI is
 * responsible for saying "no plain-language version has been written" — not for
 * quietly showing German under a Japanese heading and letting the reader work it
 * out.
 */
export function resolve(
    entry: JobTextEntry | null,
    key: TextKey,
    lang: 'ja' | 'en',
    fallbackDe = '',
): ResolvedText {
    const t = entry?.text[key];
    const c = entry?.confidence[key];
    if (!t || !c) return { text: '', confidence: 'missing', original: fallbackDe };
    const s = (lang === 'en' ? t.en : t.ja) || t.ja || t.en;
    if (!s) return { text: '', confidence: 'missing', original: fallbackDe };
    return { text: s, confidence: c };
}

/** Is any of this job's text hand-written? Drives whether the detail view says so once, at the top. */
export function hasAuthoredText(entry: JobTextEntry | null): boolean {
    return !!entry && Object.values(entry.confidence).some((c) => c === 'authored');
}

/** Every field written by hand. Fully-authored jobs are the ones worth flagging as such. */
export function isFullyAuthored(entry: JobTextEntry | null): boolean {
    if (!entry) return false;
    const vals = SLOTS.map((s) => entry.confidence[s]);
    return vals.every((c) => c === 'authored');
}

/**
 * Reading a CO-WORK record back out of D1, for the SYNC routes and the desk Worker.
 *
 * Who the record belongs to is the caller's to say — the gate's owner for a route, the record's own
 * row for the desk — and it is always part of the query.
 */
import { entryProblem, mergeEntries, type NotebookEntry } from '../../src/lib/notebook/rules';
import type { D1Database } from './sync';

/** The record as stored, in the order written. A row that no longer parses is left out. */
export async function recordEntries(db: D1Database, owner: string, record: string): Promise<NotebookEntry[]> {
    const { results } = await db
        .prepare('SELECT entry FROM monitoring_notebook WHERE owner = ? AND record = ? ORDER BY at, id')
        .bind(owner, record)
        .all<{ entry: string }>();
    const out: NotebookEntry[] = [];
    for (const r of results) {
        try {
            const e = JSON.parse(r.entry) as unknown;
            if (!entryProblem(e)) out.push(e as NotebookEntry);
        } catch {
            /* a row this build cannot read is not part of the record it reasons about */
        }
    }
    return mergeEntries(out);
}

/** Write entries that passed the rules. Returns the ids that were already there under someone else. */
export async function insertEntries(db: D1Database, owner: string, entries: readonly NotebookEntry[], now: number): Promise<string[]> {
    const taken: string[] = [];
    for (const e of entries) {
        const res = await db
            .prepare(
                `INSERT INTO monitoring_notebook (id, owner, record, at, by, kind, entry, synced_at)
                 VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`,
            )
            .bind(e.id, owner, e.sessionId, e.at, e.by, e.body.kind, JSON.stringify(e), now)
            .run();
        if (res.meta.changes === 0) {
            const row = await db.prepare('SELECT owner FROM monitoring_notebook WHERE id = ?').bind(e.id).first<{ owner: string }>();
            if (row && row.owner !== owner) taken.push(e.id);
        }
    }
    return taken;
}

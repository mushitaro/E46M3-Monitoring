/**
 * CO-WORK kept on this device, in IndexedDB (lib/sync/db.ts, store `notebook`).
 *
 * Every write goes through `addProblem` inside the transaction that writes it, so the record on the
 * device can only hold what the rules allow, whichever writer — the assistant through the bridge, a
 * plan brought down from the account, the owner on the screen — reached it, and two writers cannot
 * both pass the check against a record that changes between them.
 *
 * Entries are only added. There is no update and no delete here: a finding is withdrawn by a
 * `status` entry (rules.ts). Removing a whole record goes with removing what it belongs to, and
 * is not offered yet.
 *
 * WORKS-only, like lib/sync.
 */
import { inTransaction, NOTEBOOK } from '../sync/db';
import { addProblem, mergeEntries, type NotebookEntry } from './rules';

/** The entries of one record, in the order written. */
export function listEntries(sessionId: string): Promise<NotebookEntry[]> {
    return inTransaction<NotebookEntry[]>(NOTEBOOK, 'readonly', (s, done) => {
        const req = s.index('sessionId').getAll(sessionId);
        req.onsuccess = () => done(mergeEntries(req.result as NotebookEntry[]));
    });
}

/** Every entry on the device, in the order written. */
export function listAllEntries(): Promise<NotebookEntry[]> {
    return inTransaction<NotebookEntry[]>(NOTEBOOK, 'readonly', (s, done) => {
        const req = s.getAll();
        req.onsuccess = () => done(mergeEntries(req.result as NotebookEntry[]));
    });
}

/**
 * Add entries to their records, each checked against the record as it stands with the ones before
 * it in this call. All or nothing: the first refusal aborts the transaction and rejects with the
 * rule's sentence, which the caller relays to the writer unchanged.
 */
export function addEntries(entries: readonly NotebookEntry[]): Promise<void> {
    const sessions = [...new Set(entries.map((e) => e.sessionId))];
    return inTransaction<void>(NOTEBOOK, 'readwrite', (s, done, fail) => {
        const records = new Map<string, NotebookEntry[]>();
        let pending = sessions.length;
        const write = () => {
            for (const e of entries) {
                const record = records.get(e.sessionId) ?? [];
                const problem = addProblem(e, record);
                if (problem) return fail(new Error(problem));
                if (!record.some((y) => y.id === e.id)) {
                    s.put(e);
                    record.push(e);
                }
            }
            done(undefined);
        };
        if (pending === 0) return done(undefined);
        for (const id of sessions) {
            const req = s.index('sessionId').getAll(id);
            req.onsuccess = () => {
                records.set(id, mergeEntries(req.result as NotebookEntry[]));
                if (--pending === 0) write();
            };
        }
    });
}

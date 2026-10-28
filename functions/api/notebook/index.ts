import { json, ownerOf, unauthorized } from '../../_owner-gate/owner';
import { insertEntries, recordEntries } from '../../_lib/investigation';
import { wakeDesk, wakeWorthy } from '../../_lib/wake';
import { type SyncContext, isRowId } from '../../_lib/sync';
import { addProblem, entryProblem, mergeEntries, type NotebookEntry } from '../../../src/lib/notebook/rules';
import { sendableEntry } from '../../../src/lib/investigation/share';

/**
 * CO-WORK of a delegated investigation, both ways: the tab sends what it wrote, and takes back what
 * the desk wrote (lib/sync/investigations.ts is the other half).
 *
 * Only a delegated record is kept here, and only what was written while it was delegated — the
 * policy's 「調査の記録」. The tab sends nothing else, and this route refuses anything else, by the
 * same function (lib/investigation/share `sendableEntry`). Entries go through the same rules as on
 * the device (lib/notebook/rules `addProblem`), checked against the record as stored. The tab never
 * writes as `desk`: what the desk writes comes only through the desk Worker.
 */

const MAX_BATCH = 100;

/** GET /api/notebook?record=… — the record as stored for this owner. */
export const onRequestGet = async (ctx: SyncContext): Promise<Response> => {
    const owner = ownerOf(ctx.data);
    if (!owner) return unauthorized();
    const record = new URL(ctx.request.url).searchParams.get('record');
    if (!isRowId(record)) return json({ error: 'record is missing or malformed.' }, 400);
    return json({ entries: await recordEntries(ctx.env.RUNS_DB, owner.id, record) });
};

/**
 * POST /api/notebook — `{ entries }`, from one record or several. Each is stored or refused on its
 * own, and a refusal says why: a rule refuses the same entry every time, so it must not hold back
 * the ones behind it.
 */
export const onRequestPost = async (ctx: SyncContext): Promise<Response> => {
    const owner = ownerOf(ctx.data);
    if (!owner) return unauthorized();

    let body: { entries?: unknown };
    try {
        body = (await ctx.request.json()) as { entries?: unknown };
    } catch {
        return json({ error: 'Body is not JSON.' }, 400);
    }
    if (!Array.isArray(body.entries) || body.entries.length === 0 || body.entries.length > MAX_BATCH) {
        return json({ error: `entries must be 1-${MAX_BATCH} entries.` }, 400);
    }

    const refused: { id: unknown; reason: string }[] = [];
    const byRecord = new Map<string, NotebookEntry[]>();
    for (const e of body.entries as NotebookEntry[]) {
        const record = (e as Partial<NotebookEntry>)?.sessionId;
        if (typeof record !== 'string' || !isRowId(record)) {
            refused.push({ id: (e as Partial<NotebookEntry>)?.id, reason: 'sessionId must be a record id' });
            continue;
        }
        byRecord.set(record, [...(byRecord.get(record) ?? []), e]);
    }

    let stored = 0;
    const now = Date.now();
    for (const [record, batch] of byRecord) {
        const existing = await recordEntries(ctx.env.RUNS_DB, owner.id, record);
        // The record as it will stand, so a mandate sent in the same batch delegates what follows it.
        const whole = mergeEntries(existing, batch.filter((e) => !entryProblem(e)));
        const accepted: NotebookEntry[] = [];
        for (const e of [...batch].sort((a, b) => a.at - b.at)) {
            const problem =
                (e?.by === 'desk' ? 'the desk writes through the desk, not through the tab' : null) ??
                addProblem(e, mergeEntries(existing, accepted)) ??
                (sendableEntry(whole, e) ? null : 'this record was not delegated when the entry was written; it stays on the device');
            if (problem) refused.push({ id: e?.id, reason: problem });
            else accepted.push(e);
        }
        const taken = await insertEntries(ctx.env.RUNS_DB, owner.id, accepted, now);
        for (const id of taken) refused.push({ id, reason: 'id_taken' });
        stored += accepted.length - taken.length;
        // Something the loop is asked to do wakes it now, not at its next scheduled turn.
        const asks = accepted.filter((e) => !taken.includes(e.id) && wakeWorthy(e, whole));
        if (asks.length > 0) ctx.waitUntil?.(wakeDesk(ctx.env, owner.id, record, asks.map((e) => e.body.kind).join(', ')));
    }
    return json({ stored, refused });
};

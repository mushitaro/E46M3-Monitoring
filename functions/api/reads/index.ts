import { json, ownerOf, unauthorized } from '../../_owner-gate/owner';
import { type SyncContext, optText } from '../../_lib/sync';
import { READ_LIMITS, readRecordProblem, type ReadRecord } from '../../../src/lib/investigation/readRecord';

/**
 * Read records — what the WORKS build sent to the car and what came back, sent by the app itself,
 * success or failure (the policy's 「読み取りの記録」; lib/sync/readRecords.ts is the client half).
 *
 * Stored as sent, per owner. Nothing here lists them for the tab: they are for the operator to see
 * which reads a module answers and to fix the tool, and the desk reads the part of them a mandate
 * covers (workers/desk).
 */

/** POST /api/reads — `{ reads, appBuild }`. Malformed records are refused one by one; the same id again changes nothing. */
export const onRequestPost = async (ctx: SyncContext): Promise<Response> => {
    const owner = ownerOf(ctx.data);
    if (!owner) return unauthorized();

    let body: { reads?: unknown; appBuild?: unknown };
    try {
        body = (await ctx.request.json()) as { reads?: unknown; appBuild?: unknown };
    } catch {
        return json({ error: 'Body is not JSON.' }, 400);
    }
    if (!Array.isArray(body.reads) || body.reads.length === 0 || body.reads.length > READ_LIMITS.batch) {
        return json({ error: `reads must be 1-${READ_LIMITS.batch} records.` }, 400);
    }
    const appBuild = optText(body.appBuild, 40);
    const now = Date.now();
    const refused: { id: unknown; reason: string }[] = [];
    let stored = 0;
    for (const r of body.reads as ReadRecord[]) {
        const problem = readRecordProblem(r);
        if (problem) {
            refused.push({ id: (r as Partial<ReadRecord>)?.id, reason: problem });
            continue;
        }
        const res = await ctx.env.RUNS_DB.prepare(`
            INSERT INTO monitoring_reads (
                id, owner, at, synced_at, module, job, request, response, outcome, reason, speed_kmh, motion, app_build
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING
        `).bind(r.id, owner.id, r.at, now, r.module, r.job, r.request, r.response, r.outcome, r.reason, r.speedKmh, r.motion, appBuild).run();
        stored += res.meta.changes;
    }
    return json({ stored, refused });
};

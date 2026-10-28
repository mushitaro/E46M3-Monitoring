import { MAX_ROW_BYTES, conflict, json, ownerOf, rowBytes, tooLarge, unauthorized } from '../../_owner-gate/owner';
import { recordEntries } from '../../_lib/investigation';
import { wakeDesk } from '../../_lib/wake';
import { type SyncContext, gzipField, isRowId, optInt, optText } from '../../_lib/sync';
import { sendableRun } from '../../../src/lib/investigation/share';

/**
 * PROBE runs of a delegated investigation — what the plan recorded, for the desk to judge.
 *
 * Kept only for a record that was delegated when the run started (lib/investigation/share
 * `sendableRun`), which the tab checks before sending and this route checks again against the
 * record as stored: the mandate reaches here first, through /api/notebook. A finished run only;
 * a run is final once it ends, so the same id again replaces it, for the same owner only.
 */

const RUN_COLUMNS = 'id, n, plan_v, started_at, ended_at, end_reason, sample_count, mock, app_build, synced_at, length(run_gz) AS run_bytes';

/** GET /api/runs?record=… — this owner's runs of the record, without their data. */
export const onRequestGet = async (ctx: SyncContext): Promise<Response> => {
    const owner = ownerOf(ctx.data);
    if (!owner) return unauthorized();
    const record = new URL(ctx.request.url).searchParams.get('record');
    if (!isRowId(record)) return json({ error: 'record is missing or malformed.' }, 400);
    const { results } = await ctx.env.RUNS_DB
        .prepare(`SELECT ${RUN_COLUMNS} FROM monitoring_runs WHERE owner = ? AND record = ? ORDER BY n`)
        .bind(owner.id, record)
        .all();
    return json({ runs: results });
};

interface RunBody {
    id?: unknown;
    record?: unknown;
    n?: unknown;
    planV?: unknown;
    startedAt?: unknown;
    endedAt?: unknown;
    end?: unknown;
    sampleCount?: unknown;
    mock?: unknown;
    appBuild?: unknown;
    /** base64 of the gzipped run JSON. */
    runGz?: unknown;
}

const ENDS = new Set(['done', 'stopped', 'link-lost', 'limit']);

/** POST /api/runs — one finished run. */
export const onRequestPost = async (ctx: SyncContext): Promise<Response> => {
    const owner = ownerOf(ctx.data);
    if (!owner) return unauthorized();

    let body: RunBody;
    try {
        body = (await ctx.request.json()) as RunBody;
    } catch {
        return json({ error: 'Body is not JSON.' }, 400);
    }
    if (!isRowId(body.id)) return json({ error: 'id is missing or malformed.' }, 400);
    if (!isRowId(body.record)) return json({ error: 'record is missing or malformed.' }, 400);
    const n = optInt(body.n);
    const planV = optInt(body.planV);
    const startedAt = optInt(body.startedAt);
    const endedAt = optInt(body.endedAt);
    if (n === null || n < 1 || planV === null || startedAt === null || endedAt === null || endedAt < startedAt) {
        return json({ error: 'n, planV, startedAt and endedAt must be numbers, and the run must have ended.' }, 400);
    }
    if (typeof body.end !== 'string' || !ENDS.has(body.end)) return json({ error: 'end must be how the run ended.' }, 400);
    const blob = gzipField(body.runGz, 'runGz');
    if (typeof blob === 'string') return json({ error: blob }, 400);

    const entries = await recordEntries(ctx.env.RUNS_DB, owner.id, body.record);
    if (!sendableRun(entries, { startedAt })) {
        return json({ error: 'not_delegated', reason: 'No mandate of this record stood when the run started; it stays on the device.' }, 422);
    }

    const values = [
        body.id, owner.id, body.record, n, planV, startedAt, endedAt, body.end, optInt(body.sampleCount) ?? 0,
        body.mock === true ? 1 : 0, optText(body.appBuild, 40), Date.now(), blob,
    ];
    const bytes = rowBytes(values);
    if (bytes > MAX_ROW_BYTES) return tooLarge(bytes);

    const res = await ctx.env.RUNS_DB.prepare(`
        INSERT INTO monitoring_runs (
            id, owner, record, n, plan_v, started_at, ended_at, end_reason, sample_count, mock, app_build, synced_at, run_gz
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET
            ended_at = excluded.ended_at,
            end_reason = excluded.end_reason,
            sample_count = excluded.sample_count,
            app_build = excluded.app_build,
            synced_at = excluded.synced_at,
            run_gz = excluded.run_gz
        WHERE monitoring_runs.owner = excluded.owner AND monitoring_runs.record = excluded.record
    `).bind(...values).run();

    if (res.meta.changes === 0) return conflict();
    // A run is what the plan was waiting for: the loop reads it now.
    ctx.waitUntil?.(wakeDesk(ctx.env, owner.id, body.record, `run ${n}`));
    return json({ id: body.id, storedBytes: bytes });
};

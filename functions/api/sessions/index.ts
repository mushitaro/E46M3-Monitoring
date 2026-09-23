import { MAX_ROW_BYTES, conflict, json, ownerOf, rowBytes, tooLarge, unauthorized } from '../../_owner-gate/owner';
import { type SyncContext, gzipField, isRowId, optInt, optText } from '../../_lib/sync';

/**
 * Saved sessions — what the SESSIONS tab's SYNC sends, one row per session, per owner.
 *
 * A session is uploaded because the owner pressed SYNC and wants their work somewhere other than
 * this phone: the fault read, the datalog, and the comms log around anything that failed. It is
 * stored as the device's IndexedDB holds it (gzipped JSON), so a restore on another device puts
 * back exactly what was saved. The columns beside the blob are only what the list needs to say
 * which session is which without inflating it.
 */

/** Every column except the blob. The list must never inflate a session to describe it. */
const LIST_COLUMNS = `
    id, label, created_at, synced_at, ecu, mock, fault_count, sample_count, failure_count, app_build,
    length(session_gz) AS session_bytes
`;

/**
 * GET /api/sessions — this owner's, most recent first.
 *
 * No pagination: one person's own sessions. The day it needs paging it needs a different design,
 * and a limit that silently dropped the oldest would be worse than either.
 */
export const onRequestGet = async (ctx: SyncContext): Promise<Response> => {
    const owner = ownerOf(ctx.data);
    if (!owner) return unauthorized();

    const limit = Math.min(200, Math.max(1, Number(new URL(ctx.request.url).searchParams.get('limit') ?? 100) || 100));
    const { results } = await ctx.env.RUNS_DB
        .prepare(`SELECT ${LIST_COLUMNS} FROM monitoring_sessions WHERE owner = ? ORDER BY created_at DESC LIMIT ?`)
        .bind(owner.id, limit)
        .all();
    return json({ sessions: results });
};

interface SessionBody {
    id?: unknown;
    label?: unknown;
    createdAt?: unknown;
    ecu?: unknown;
    mock?: unknown;
    faultCount?: unknown;
    sampleCount?: unknown;
    failureCount?: unknown;
    appBuild?: unknown;
    /** base64 of the gzipped session JSON. */
    sessionGz?: unknown;
}

/**
 * POST /api/sessions — store one session. Idempotent on the device's own id: re-syncing replaces,
 * which is what a phone on an unreliable connection needs.
 *
 * Replaces only the SAME owner's row. The upsert's WHERE makes an id that already belongs to
 * someone else change nothing, and `changes === 0` is how that is told apart from success — a 409,
 * never a silent overwrite and never a merge into another account's record.
 */
export const onRequestPost = async (ctx: SyncContext): Promise<Response> => {
    const owner = ownerOf(ctx.data);
    if (!owner) return unauthorized();

    let body: SessionBody;
    try {
        body = (await ctx.request.json()) as SessionBody;
    } catch {
        return json({ error: 'Body is not JSON.' }, 400);
    }
    if (!isRowId(body.id)) return json({ error: 'id is missing or malformed.' }, 400);
    const label = optText(body.label, 120);
    if (!label) return json({ error: 'label is required.' }, 400);
    const createdAt = optInt(body.createdAt);
    if (createdAt === null) return json({ error: 'createdAt must be a number.' }, 400);
    const blob = gzipField(body.sessionGz, 'sessionGz');
    if (typeof blob === 'string') return json({ error: blob }, 400);

    const values = [
        body.id, owner.id, label, createdAt, Date.now(), optText(body.ecu, 40), body.mock === true ? 1 : 0,
        optInt(body.faultCount), optInt(body.sampleCount) ?? 0, optInt(body.failureCount) ?? 0,
        optText(body.appBuild, 40), blob,
    ];
    // Before the write, not caught after it: D1's own refusal of an oversized row is a bare 500,
    // and the owner needs to be told "too large" in words.
    const bytes = rowBytes(values);
    if (bytes > MAX_ROW_BYTES) return tooLarge(bytes);

    const res = await ctx.env.RUNS_DB.prepare(`
        INSERT INTO monitoring_sessions (
            id, owner, label, created_at, synced_at, ecu, mock,
            fault_count, sample_count, failure_count, app_build, session_gz
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET
            label = excluded.label,
            synced_at = excluded.synced_at,
            ecu = excluded.ecu,
            mock = excluded.mock,
            fault_count = excluded.fault_count,
            sample_count = excluded.sample_count,
            failure_count = excluded.failure_count,
            app_build = excluded.app_build,
            session_gz = excluded.session_gz
        WHERE monitoring_sessions.owner = excluded.owner
    `).bind(...values).run();

    if (res.meta.changes === 0) return conflict();
    return json({ id: body.id, storedBytes: bytes });
};

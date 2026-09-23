import { MAX_ROW_BYTES, conflict, json, ownerOf, rowBytes, tooLarge, unauthorized } from '../../_owner-gate/owner';
import { type SyncContext, gzipField, isRowId, optInt, optText } from '../../_lib/sync';

/**
 * Error records — one row per failed operation, sent by the app on its own.
 *
 * A sibling of /api/sessions rather than part of it, because the two are sent for opposite reasons.
 * A session goes up because the owner pressed SYNC. An error record goes up by itself, the moment a
 * read fails, because a failure is worth most at the instant it happens and is exactly the thing
 * that never becomes a session anyone saves. See src/lib/sync/errorRecords.ts for the client half.
 */

const LIST_COLUMNS = `
    id, created_at, synced_at, ecu, job, error, error_kind, transport, mock, app_build,
    length(payload_gz) AS payload_bytes
`;

/** GET /api/diagnostics — this owner's, most recent first. */
export const onRequestGet = async (ctx: SyncContext): Promise<Response> => {
    const owner = ownerOf(ctx.data);
    if (!owner) return unauthorized();

    const limit = Math.min(500, Math.max(1, Number(new URL(ctx.request.url).searchParams.get('limit') ?? 100) || 100));
    const { results } = await ctx.env.RUNS_DB
        .prepare(`SELECT ${LIST_COLUMNS} FROM monitoring_diagnostics WHERE owner = ? ORDER BY created_at DESC LIMIT ?`)
        .bind(owner.id, limit)
        .all();
    return json({ diagnostics: results });
};

interface DiagnosticBody {
    id?: unknown;
    createdAt?: unknown;
    ecu?: unknown;
    job?: unknown;
    error?: unknown;
    errorKind?: unknown;
    transport?: unknown;
    mock?: unknown;
    appBuild?: unknown;
    /** base64 of gzipped JSON: identity and comms excerpt. Optional — a failed connect has neither. */
    payloadGz?: unknown;
}

/**
 * POST /api/diagnostics — store one record. Idempotent on the client's id, because the outbox
 * resends after a failure it cannot tell apart from a lost response. The same owner rule as
 * sessions: another owner's id is a 409, not an overwrite.
 */
export const onRequestPost = async (ctx: SyncContext): Promise<Response> => {
    const owner = ownerOf(ctx.data);
    if (!owner) return unauthorized();

    let body: DiagnosticBody;
    try {
        body = (await ctx.request.json()) as DiagnosticBody;
    } catch {
        return json({ error: 'Body is not JSON.' }, 400);
    }
    if (!isRowId(body.id)) return json({ error: 'id is missing or malformed.' }, 400);
    const job = optText(body.job, 120);
    if (!job) return json({ error: 'job is required.' }, 400);
    const createdAt = optInt(body.createdAt);
    if (createdAt === null) return json({ error: 'createdAt must be a number.' }, 400);
    let payload: Uint8Array | null = null;
    if (body.payloadGz != null) {
        const blob = gzipField(body.payloadGz, 'payloadGz');
        if (typeof blob === 'string') return json({ error: blob }, 400);
        payload = blob;
    }

    const values = [
        body.id, owner.id, createdAt, Date.now(), optText(body.ecu, 40), job, optText(body.error, 2000),
        optText(body.errorKind, 40), optText(body.transport, 40), body.mock === true ? 1 : 0,
        optText(body.appBuild, 40), payload,
    ];
    const bytes = rowBytes(values);
    if (bytes > MAX_ROW_BYTES) return tooLarge(bytes);

    const res = await ctx.env.RUNS_DB.prepare(`
        INSERT INTO monitoring_diagnostics (
            id, owner, created_at, synced_at, ecu, job, error, error_kind, transport, mock, app_build, payload_gz
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET
            synced_at = excluded.synced_at,
            error = excluded.error,
            error_kind = excluded.error_kind,
            payload_gz = excluded.payload_gz
        WHERE monitoring_diagnostics.owner = excluded.owner
    `).bind(...values).run();

    if (res.meta.changes === 0) return conflict();
    return json({ id: body.id, storedBytes: bytes });
};

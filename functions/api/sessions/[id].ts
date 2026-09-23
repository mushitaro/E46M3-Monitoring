import { json, ownerOf, unauthorized } from '../../_owner-gate/owner';
import { type SyncContext, blobBytes, encodeBase64, paramId } from '../../_lib/sync';

/**
 * One saved session: fetched whole for a restore, or deleted.
 *
 * Both carry `owner = ?`. Another owner's id answers exactly as an id that does not exist — 404 —
 * so the route cannot be used to learn which ids are taken.
 */

/** GET /api/sessions/:id — the session with its blob, for a restore into this device's store. */
export const onRequestGet = async (ctx: SyncContext): Promise<Response> => {
    const owner = ownerOf(ctx.data);
    if (!owner) return unauthorized();
    const id = paramId(ctx);
    if (!id) return json({ error: 'not_found' }, 404);

    const row = await ctx.env.RUNS_DB
        .prepare(`SELECT id, label, created_at, synced_at, ecu, mock, app_build, session_gz
                  FROM monitoring_sessions WHERE id = ? AND owner = ?`)
        .bind(id, owner.id)
        .first<Record<string, unknown>>();
    if (!row) return json({ error: 'not_found' }, 404);

    const blob = blobBytes(row.session_gz);
    const { session_gz: _omit, ...meta } = row;
    void _omit;
    return json({ ...meta, sessionGz: blob ? encodeBase64(blob) : null });
};

/** DELETE /api/sessions/:id — gone from the cloud. The copy on the device is not touched. */
export const onRequestDelete = async (ctx: SyncContext): Promise<Response> => {
    const owner = ownerOf(ctx.data);
    if (!owner) return unauthorized();
    const id = paramId(ctx);
    if (!id) return json({ error: 'not_found' }, 404);

    const res = await ctx.env.RUNS_DB
        .prepare('DELETE FROM monitoring_sessions WHERE id = ? AND owner = ?')
        .bind(id, owner.id)
        .run();
    if (res.meta.changes === 0) return json({ error: 'not_found' }, 404);
    return json({ id, deleted: true });
};

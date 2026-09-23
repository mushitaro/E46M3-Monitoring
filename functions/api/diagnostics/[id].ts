import { json, ownerOf, unauthorized } from '../../_owner-gate/owner';
import { type SyncContext, blobBytes, encodeBase64, paramId } from '../../_lib/sync';

/** One error record: read whole (with its comms excerpt), or deleted. Owner-scoped, like sessions. */

export const onRequestGet = async (ctx: SyncContext): Promise<Response> => {
    const owner = ownerOf(ctx.data);
    if (!owner) return unauthorized();
    const id = paramId(ctx);
    if (!id) return json({ error: 'not_found' }, 404);

    const row = await ctx.env.RUNS_DB
        .prepare(`SELECT id, created_at, synced_at, ecu, job, error, error_kind, transport, mock, app_build, payload_gz
                  FROM monitoring_diagnostics WHERE id = ? AND owner = ?`)
        .bind(id, owner.id)
        .first<Record<string, unknown>>();
    if (!row) return json({ error: 'not_found' }, 404);

    const blob = blobBytes(row.payload_gz);
    const { payload_gz: _omit, ...meta } = row;
    void _omit;
    return json({ ...meta, payloadGz: blob ? encodeBase64(blob) : null });
};

export const onRequestDelete = async (ctx: SyncContext): Promise<Response> => {
    const owner = ownerOf(ctx.data);
    if (!owner) return unauthorized();
    const id = paramId(ctx);
    if (!id) return json({ error: 'not_found' }, 404);

    const res = await ctx.env.RUNS_DB
        .prepare('DELETE FROM monitoring_diagnostics WHERE id = ? AND owner = ?')
        .bind(id, owner.id)
        .run();
    if (res.meta.changes === 0) return json({ error: 'not_found' }, 404);
    return json({ id, deleted: true });
};

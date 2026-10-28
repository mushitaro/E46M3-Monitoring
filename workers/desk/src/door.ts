/**
 * What every app's desk shares, whatever it serves: who may call, what is put on record, and how an
 * answer goes out. MONITORING's own rules — what a mandate covers, what is withheld — are in
 * index.ts. When a second desk exists (TUNER, SMG2), this file is the part that moves to one
 * canonical copy, as the owner gate did (operator, 2026-10-28); until then it lives here.
 */
import type { D1Database } from '../../../functions/_lib/sync';

/** The two tables a desk keeps beside its app's data. Constants of each app, never input. */
export interface DeskTables {
    /** id, hash (SHA-256 of the token), label, created_at, expires_at, revoked_at */
    tokens: string;
    /** id, at, token, action, record, detail */
    audit: string;
}

export function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
    });
}

export async function sha256Hex(s: string): Promise<string> {
    const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
    return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** The token's id, if the bearer is one that stands now: known by its hash, not expired, not revoked. */
export async function tokenOf(request: Request, db: D1Database, tables: DeskTables, now: number): Promise<string | null> {
    const m = /^Bearer ([A-Za-z0-9_-]{32,128})$/.exec(request.headers.get('authorization') ?? '');
    if (!m) return null;
    const row = await db
        .prepare(`SELECT id FROM ${tables.tokens} WHERE hash = ? AND revoked_at IS NULL AND expires_at > ?`)
        .bind(await sha256Hex(m[1]), now)
        .first<{ id: string }>();
    return row?.id ?? null;
}

/** One row per call answered, written before the answer goes. */
export async function audit(db: D1Database, tables: DeskTables, now: number, token: string, action: string, record: string | null, detail: unknown): Promise<void> {
    await db
        .prepare(`INSERT INTO ${tables.audit} (at, token, action, record, detail) VALUES (?,?,?,?,?)`)
        .bind(now, token, action, record, detail === null ? null : JSON.stringify(detail))
        .run();
}

export async function gunzipJson(bytes: Uint8Array): Promise<unknown> {
    const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
    return JSON.parse(await new Response(stream).text());
}

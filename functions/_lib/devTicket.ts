/**
 * The relay's ticket for the development desk (operator, 2026-11-10: 「この形で作る」).
 *
 * The assistant bridge's ticket (functions/api/bridge/ticket.ts) goes from this origin to the relay;
 * this one comes back the other way. When MONITORING WORKS is not open — the head unit is off, the
 * tab is closed or broken — TSUNAGI///Matrix still takes the operator's words for the development
 * desk and calls /api/bridge/dev-request itself, with
 *
 *     Authorization: Bearer v1.<base64url(JSON {o: account id, a: 'monitoring-dev', e: expiry s, n: nonce})>.<base64url(HMAC-SHA256)>
 *
 * signed over `v1.<payload>` with RELAY_DEV_SECRET, a secret of its own (not BRIDGE_TICKET_SECRET:
 * other direction, other use). The account is the m3 account the relay verified at sign-in and
 * re-checks with m3 on every call; it is one of DEV_REQUEST_OWNERS (comma-separated account ids) or
 * nothing is done. A ticket lives sixty seconds and is good once (monitoring_dev_nonce).
 *
 * The copy of this format that SIGNS is matrix-tsunagi/bridge (monitoring-dev); change both.
 */
import type { D1Database } from './sync';

export interface DevEnv {
    RUNS_DB: D1Database;
    RELAY_DEV_SECRET?: string;
    DEV_REQUEST_OWNERS?: string;
}

export const DEV_AUDIENCE = 'monitoring-dev';
/** The relay mints for sixty seconds; a little more is allowed for the clocks between. */
const MAX_TTL_S = 90;

export type DevAuth = { owner: string } | { error: 'auth' | 'not_allowed' | 'dev_unavailable'; status: 401 | 403 | 503 };

const enc = new TextEncoder();

function b64urlBytes(s: string): Uint8Array<ArrayBuffer> | null {
    if (!/^[A-Za-z0-9_-]*$/.test(s)) return null;
    try {
        const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
        return Uint8Array.from(bin, (c) => c.charCodeAt(0));
    } catch {
        return null;
    }
}

/** Who the relay says is asking — checked, in this order: configured, signed, for us, alive, allowed, unused. */
export async function verifyDevTicket(env: DevEnv, header: string | null, nowSec = Date.now() / 1000): Promise<DevAuth> {
    const secret = env.RELAY_DEV_SECRET;
    const allowed = (env.DEV_REQUEST_OWNERS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    if (!secret || secret.length < 32 || allowed.length === 0) return { error: 'dev_unavailable', status: 503 };

    const m = /^Bearer (v1)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(header ?? '');
    if (!m) return { error: 'auth', status: 401 };
    const [, , payload, sig] = m;
    const sigBytes = b64urlBytes(sig);
    if (!sigBytes) return { error: 'auth', status: 401 };
    const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    // verify() compares in constant time.
    if (!(await crypto.subtle.verify('HMAC', key, sigBytes, enc.encode(`v1.${payload}`)))) return { error: 'auth', status: 401 };

    let claims: { o?: unknown; a?: unknown; e?: unknown; n?: unknown };
    try {
        claims = JSON.parse(new TextDecoder().decode(b64urlBytes(payload) ?? new Uint8Array()));
    } catch {
        return { error: 'auth', status: 401 };
    }
    const { o, a, e, n } = claims;
    if (a !== DEV_AUDIENCE || typeof e !== 'number' || e <= nowSec || e > nowSec + MAX_TTL_S) return { error: 'auth', status: 401 };
    if (typeof n !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(n)) return { error: 'auth', status: 401 };
    if (typeof o !== 'string' || !/^[0-9a-zA-Z-]{8,64}$/.test(o)) return { error: 'auth', status: 401 };
    if (!allowed.includes(o)) return { error: 'not_allowed', status: 403 };

    // Good once: a ticket seen before is refused, and the ones past their time are let go.
    const now = Math.floor(nowSec);
    await env.RUNS_DB.prepare('DELETE FROM monitoring_dev_nonce WHERE exp < ?').bind(now).run();
    const used = await env.RUNS_DB.prepare('INSERT INTO monitoring_dev_nonce (n, exp) VALUES (?, ?) ON CONFLICT(n) DO NOTHING').bind(n, Math.ceil(e)).run();
    if (used.meta.changes === 0) return { error: 'auth', status: 401 };
    return { owner: o };
}

/** The one record an owner's development requests go into: `dev-` and the first 16 hex of SHA-256(account id). */
export async function devRecordOf(owner: string): Promise<string> {
    const h = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(owner)));
    return `dev-${[...h.slice(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

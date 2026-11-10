/**
 * The ticket a Mainstay's engine report carries (operator, 2026-11-11: the diagnostic engine's
 * errors reach the operator through Cloudflare and the autonomous loop fixes them).
 *
 * The same make as the relay's development ticket (PR #42, functions/_lib/devTicket.ts), with the
 * body bound in:
 *
 *     Authorization: Bearer v1.<base64url(JSON {s, a, e, n, h})>.<base64url(HMAC-SHA256)>
 *
 *   s  the Mainstay: a store slug on ENGINE_REPORT_MAINSTAYS (wrangler vars, comma-separated)
 *   a  'engine-report'
 *   e  expiry in seconds; the store mints for sixty
 *   n  a nonce; each ticket is good once (monitoring_engine_report_nonce)
 *   h  base64url SHA-256 of the exact body, so a ticket cannot carry another report
 *
 * signed over `v1.<payload>` with that Mainstay's own key, the Pages secret
 * ENGINE_REPORT_SECRET_<SLUG> (`gren-blue-auto` → ENGINE_REPORT_SECRET_GREN_BLUE_AUTO). One key per
 * store, so one store can be cut off without touching another. Nothing here is the owner gate's: a
 * store's server has no owner cookie, and this route answers nothing but whether it took the report.
 *
 * The copy of this format that SIGNS is the store's (GREN BLUE: packages/api-kit/src/engineReport/
 * ticket.ts in tsunagi_gren-blue); change both.
 */
import type { D1Database } from './sync';

export interface EngineReportEnv {
    RUNS_DB: D1Database;
    /** Comma-separated store slugs allowed to report (wrangler vars). Empty: the door is shut. */
    ENGINE_REPORT_MAINSTAYS?: string;
    /** Per-store keys, ENGINE_REPORT_SECRET_<SLUG>. Pages secrets. */
    [key: `ENGINE_REPORT_SECRET_${string}`]: string | undefined;
}

export const ENGINE_REPORT_AUDIENCE = 'engine-report';
/** The store mints for sixty seconds; a little more is allowed for the clocks between. */
const MAX_TTL_S = 90;
const SECRET_MIN = 32;

export type EngineReportAuth = { mainstay: string } | { error: 'auth' | 'engine_report_unavailable'; status: 401 | 503 };

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

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** The Pages secret that holds a store's key. */
export function secretNameOf(mainstay: string): `ENGINE_REPORT_SECRET_${string}` {
    return `ENGINE_REPORT_SECRET_${mainstay.toUpperCase().replace(/-/g, '_')}`;
}

export function rosterOf(env: Pick<EngineReportEnv, 'ENGINE_REPORT_MAINSTAYS'>): string[] {
    return (env.ENGINE_REPORT_MAINSTAYS ?? '').split(',').map((s) => s.trim()).filter((s) => /^[a-z0-9-]{2,40}$/.test(s));
}

/**
 * Which store sent this body — checked, in this order: the door is open, the header has the shape,
 * the store is on the roster and has a key, the signature, the audience, the time, the body, unused.
 * An unknown store is the same 401 as a bad signature: the roster is not told to strangers.
 */
export async function verifyEngineReportTicket(env: EngineReportEnv, header: string | null, body: string, nowSec = Date.now() / 1000): Promise<EngineReportAuth> {
    const roster = rosterOf(env);
    if (roster.length === 0) return { error: 'engine_report_unavailable', status: 503 };

    const m = /^Bearer (v1)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(header ?? '');
    if (!m) return { error: 'auth', status: 401 };
    const [, , payload, sig] = m;

    let claims: { s?: unknown; a?: unknown; e?: unknown; n?: unknown; h?: unknown };
    try {
        claims = JSON.parse(new TextDecoder().decode(b64urlBytes(payload) ?? new Uint8Array()));
    } catch {
        return { error: 'auth', status: 401 };
    }
    // The claimed store only picks the key; nothing is believed until the signature holds.
    const { s, a, e, n, h } = claims;
    if (typeof s !== 'string' || !roster.includes(s)) return { error: 'auth', status: 401 };
    const secret = env[secretNameOf(s)];
    if (!secret || secret.length < SECRET_MIN) return { error: 'auth', status: 401 };

    const sigBytes = b64urlBytes(sig);
    if (!sigBytes) return { error: 'auth', status: 401 };
    const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    // verify() compares in constant time.
    if (!(await crypto.subtle.verify('HMAC', key, sigBytes, enc.encode(`v1.${payload}`)))) return { error: 'auth', status: 401 };

    if (a !== ENGINE_REPORT_AUDIENCE || typeof e !== 'number' || e <= nowSec || e > nowSec + MAX_TTL_S) return { error: 'auth', status: 401 };
    if (typeof n !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(n)) return { error: 'auth', status: 401 };
    const digest = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(body))));
    if (h !== digest) return { error: 'auth', status: 401 };

    // Good once: a ticket seen before is refused, and the ones past their time are let go.
    const now = Math.floor(nowSec);
    await env.RUNS_DB.prepare('DELETE FROM monitoring_engine_report_nonce WHERE exp < ?').bind(now).run();
    const used = await env.RUNS_DB.prepare('INSERT INTO monitoring_engine_report_nonce (n, exp) VALUES (?, ?) ON CONFLICT(n) DO NOTHING').bind(n, Math.ceil(e)).run();
    if (used.meta.changes === 0) return { error: 'auth', status: 401 };
    return { mainstay: s };
}

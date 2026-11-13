/**
 * The ticket M's platform carries when its engine door hands this desk a report
 * (tsunagi-m-platform services/engine/src/deliver.ts; the format is that repository's
 * contract/src/tickets.ts, v2):
 *
 *     Authorization: Bearer v2.<base64url(JSON {s, a, e, n, h})>.<base64url(HMAC-SHA256)>
 *
 *   s  'm' — the platform's own namespace. A Mainstay never holds this key; a Mainstay's ticket
 *      (s = its slug) is the engine door's business, not the desk's
 *   a  'desk-deliver' — and nothing else
 *   e  expiry in seconds; the door mints for sixty
 *   n  a nonce; each ticket is good once (monitoring_engine_report_nonce)
 *   h  base64url SHA-256 of `POST <path and query>\n<body>` — the exact request, so a ticket cannot
 *      carry another report or reach another route
 *
 * signed over `v2.<payload>` with the key the two deployments share: the door's secret M_DESK_KEY,
 * here the Pages secret DESK_DELIVER_KEY (the same value; names only — the operator sets both).
 *
 * This is the copy that VERIFIES. The copy that mints is the platform's
 * (services/door-kit/src/ticket.ts `mintPlatformTicket`); change both.
 *
 * Every refusal is the same 401. A missing key is 503: the desk cannot tell who is calling, which is
 * not the caller's fault and is never a pass.
 */
import type { D1Database } from '../../../functions/_lib/sync';

export interface PlatformTicketEnv {
    RUNS_DB: D1Database;
    /** The key shared with the platform's engine door (its M_DESK_KEY). A Pages secret. */
    DESK_DELIVER_KEY?: string;
}

export const DESK_DELIVER_PURPOSE = 'desk-deliver';
const PLATFORM_NAMESPACE = 'm';
/** The door mints for sixty seconds; a little more is allowed for the clocks between. */
const MAX_TTL_S = 90;
const KEY_MIN = 32;

export type PlatformTicketAuth = { ok: true } | { ok: false; error: 'auth' | 'unconfigured'; status: 401 | 503 };

const REFUSED: PlatformTicketAuth = { ok: false, error: 'auth', status: 401 };
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

/** What `h` is the SHA-256 of — the platform contract's `ticketBinding`. */
export const ticketBinding = (method: string, pathAndQuery: string, body: string) => `${method.toUpperCase()} ${pathAndQuery}\n${body}`;

/**
 * Whether the platform's engine door sent this request — checked in this order: the key is set, the
 * header has the shape, the claims are the platform's and for the desk, the signature, the time, the
 * request it is bound to, unused.
 */
export async function verifyPlatformTicket(
    env: PlatformTicketEnv,
    header: string | null,
    request: { method: string; pathAndQuery: string; body: string },
    nowSec = Date.now() / 1000,
): Promise<PlatformTicketAuth> {
    const key = env.DESK_DELIVER_KEY;
    if (!key || key.length < KEY_MIN) return { ok: false, error: 'unconfigured', status: 503 };

    const m = /^Bearer v2\.([A-Za-z0-9_-]{16,1024})\.([A-Za-z0-9_-]{43})$/.exec(header ?? '');
    if (!m) return REFUSED;
    const [, payload, sig] = m;

    let claims: { s?: unknown; a?: unknown; e?: unknown; n?: unknown; h?: unknown; k?: unknown; o?: unknown; t?: unknown };
    try {
        claims = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(b64urlBytes(payload) ?? new Uint8Array()));
    } catch {
        return REFUSED;
    }
    if (!claims || typeof claims !== 'object') return REFUSED;

    const sigBytes = b64urlBytes(sig);
    if (!sigBytes) return REFUSED;
    const hmac = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    // verify() compares in constant time.
    if (!(await crypto.subtle.verify('HMAC', hmac, sigBytes, enc.encode(`v2.${payload}`)))) return REFUSED;

    const { s, a, e, n, h } = claims;
    // The platform's own ticket, for the desk, and nothing riding along.
    if (s !== PLATFORM_NAMESPACE || a !== DESK_DELIVER_PURPOSE) return REFUSED;
    if (claims.k !== undefined || claims.o !== undefined || claims.t !== undefined) return REFUSED;
    if (typeof e !== 'number' || e <= nowSec || e > nowSec + MAX_TTL_S) return REFUSED;
    if (typeof n !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(n)) return REFUSED;
    const digest = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(ticketBinding(request.method, request.pathAndQuery, request.body)))));
    if (h !== digest) return REFUSED;

    // Good once: a ticket seen before is refused, and the ones past their time are let go.
    const now = Math.floor(nowSec);
    await env.RUNS_DB.prepare('DELETE FROM monitoring_engine_report_nonce WHERE exp < ?').bind(now).run();
    const used = await env.RUNS_DB.prepare('INSERT INTO monitoring_engine_report_nonce (n, exp) VALUES (?, ?) ON CONFLICT(n) DO NOTHING').bind(n, Math.ceil(e)).run();
    if (used.meta.changes === 0) return REFUSED;
    return { ok: true };
}

/**
 * The ECU data for another app's server: `GET /api/engine-data/<file>` (docs/ENGINE.md §4).
 *
 * GREN BLUE SUITE uses this app's diagnosis engine (`@tsunagi/monitoring-engine`) and reads the
 * engine's private data (`/ecu-data/`, BMW-derived; THIRD-PARTY-NOTICES.md §3) from here, server to
 * server, on behalf of a person m3 says may read it (operator, 2026-11-11):
 *
 *   - the request carries `Authorization: Bearer <m3 token>`, a token m3 issued for THIS app's
 *     client (`monitoring-preview`). m3 confirms a session only to the client it was issued to, and a
 *     token is never handed from one service to another (tsunagi-m-access §3-3), so the other app
 *     obtains one for this audience from m3 itself (token exchange; m3's side is not built yet — until
 *     it is, no such token exists and every request here is refused);
 *   - the token is asked about at m3 (`/api/access/introspect`, with this app's client secret, as the
 *     owner gate does), and only an active one whose account holds `monitoring_engine` reads;
 *   - only the data's own file names are served, from this deployment's assets, never cached by
 *     anything in between. No CORS: a browser cannot read the answer, only a server.
 *
 * Fails closed: no secret, m3 unreachable, an answer not understood — nothing is served.
 */

export const ENGINE_DATA_SCOPE = 'monitoring_engine';
export const ENGINE_DATA_PREFIX = '/api/engine-data/';
const CLIENT_ID = 'monitoring-preview';
const M3_SERVER = 'https://tsunagi-m3.pages.dev';
const POSITIVE_TTL_MS = 60_000;

/** The data's own files: the index, the variant rules, a module's catalogue and telegram table. */
const FILE = /^(?:index\.json|variants\.json|[a-z0-9_]{1,40}\.(?:jobs|telegrams)\.json)$/;

export interface EngineDataEnv {
    M3_CLIENT_SECRET?: string;
    ASSETS?: { fetch(input: Request | string): Promise<Response> };
}

export interface EngineDataDeps {
    fetch?: typeof fetch;
    now?: () => number;
}

const NO_STORE = { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' };

function answer(status: number, error: string, extra: Record<string, string> = {}): Response {
    return new Response(JSON.stringify({ error }), { status, headers: { 'content-type': 'application/json', ...NO_STORE, ...extra } });
}

const basic = (id: string, secret: string) => `Basic ${btoa(`${id}:${secret}`)}`;

async function sha256(text: string): Promise<string> {
    const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** A positive answer, kept a minute by the token's hash (as the gate keeps one); never a negative. */
const memo = new Map<string, number>();

/** The file the path names, or null when it is not one of the data's own. */
export function engineDataFile(pathname: string): string | null {
    if (!pathname.startsWith(ENGINE_DATA_PREFIX)) return null;
    const file = pathname.slice(ENGINE_DATA_PREFIX.length);
    return FILE.test(file) ? file : null;
}

type Verdict = 'ok' | 'no-token' | 'inactive' | 'no-right' | 'unavailable';

async function verify(request: Request, env: EngineDataEnv, deps: EngineDataDeps): Promise<Verdict> {
    const token = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(request.headers.get('authorization') ?? '')?.[1];
    if (!token) return 'no-token';
    const secret = env.M3_CLIENT_SECRET;
    if (!secret) return 'unavailable';
    const now = (deps.now ?? Date.now)();
    const key = await sha256(token);
    const until = memo.get(key);
    if (until !== undefined && until > now) return 'ok';

    let res: Response;
    try {
        res = await (deps.fetch ?? fetch)(`${M3_SERVER}/api/access/introspect`, {
            method: 'POST',
            headers: { authorization: basic(CLIENT_ID, secret), 'content-type': 'application/json' },
            body: JSON.stringify({ token }),
        });
    } catch {
        return 'unavailable';
    }
    if (res.status !== 200) return 'unavailable';
    const body = (await res.json().catch(() => null)) as { active?: unknown; account_id?: unknown; scopes?: unknown } | null;
    if (!body || typeof body.active !== 'boolean') return 'unavailable';
    if (!body.active || typeof body.account_id !== 'string' || !body.account_id) return 'inactive';
    if (!Array.isArray(body.scopes) || !body.scopes.includes(ENGINE_DATA_SCOPE)) return 'no-right';
    if (memo.size > 500) memo.clear();
    memo.set(key, now + POSITIVE_TTL_MS);
    return 'ok';
}

/** The whole answer to one request under ENGINE_DATA_PREFIX. */
export async function serveEngineData(request: Request, env: EngineDataEnv, deps: EngineDataDeps = {}): Promise<Response> {
    if (request.method !== 'GET' && request.method !== 'HEAD') return answer(405, 'method_not_allowed', { allow: 'GET, HEAD' });
    const file = engineDataFile(new URL(request.url).pathname);
    if (!file) return answer(404, 'not_found');
    const verdict = await verify(request, env, deps);
    if (verdict === 'no-token' || verdict === 'inactive') return answer(401, 'unauthorized', { 'www-authenticate': 'Bearer' });
    if (verdict === 'no-right') return answer(403, 'forbidden');
    if (verdict === 'unavailable' || !env.ASSETS) return answer(503, 'unavailable');
    const asset = await env.ASSETS.fetch(new Request(new URL(`/ecu-data/${file}`, request.url), { method: request.method }));
    if (asset.status !== 200) return answer(404, 'not_found');
    return new Response(request.method === 'HEAD' ? null : asset.body, {
        status: 200,
        headers: { 'content-type': 'application/json', ...NO_STORE },
    });
}

/** Test seam: forget the positive answers kept. */
export function forgetEngineDataAnswers(): void {
    memo.clear();
}

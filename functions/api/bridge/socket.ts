import { json, ownerOf, unauthorized } from '../../_owner-gate/owner';

/**
 * GET /api/bridge/socket — the tab's WebSocket to the relay, passed through on this origin.
 *
 * The page's CSP is connect-src 'self' (public/_headers), so the tab cannot open the relay's
 * address itself. This passes the upgrade on as the relay asks (matrix-tsunagi 0.11.0): the
 * browser's Origin, which the relay holds to its list of tab origins, and the Sec-WebSocket-Protocol
 * it offered — `works-bridge.v1` and `t.<ticket>` — untouched, and the relay's 101 back as it came.
 * The owner's cookies stop here: the ticket is the relay's admission, and the session that minted
 * it is this origin's.
 *
 * The gate (functions/_middleware.ts) admits the request before it gets here and lets the 101 out
 * without rewrapping it.
 */

interface BridgeEnv {
    BRIDGE_TAB_URL?: string;
}

/** Headers that are this origin's business and never go to the relay. */
const KEPT_HERE = ['cookie', 'authorization'];

export const onRequestGet = async ({ request, env, data }: { request: Request; env: BridgeEnv; data: Record<string, unknown> }): Promise<Response> => {
    if (!ownerOf(data)) return unauthorized();
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return json({ error: 'upgrade_required' }, 426);
    const upstream = env.BRIDGE_TAB_URL;
    if (!upstream) return json({ error: 'bridge_unavailable' }, 503);
    const headers = new Headers(request.headers);
    for (const h of KEPT_HERE) headers.delete(h);
    // fetch speaks http(s); the runtime performs the upgrade and hands back the relay's 101. The
    // query is the tab's and goes on as it came — `takeover`, the device's `did`, `nav` — and the
    // relay is where they mean something; this used to drop it, and "switch here" with it.
    const target = new URL(upstream.replace(/^ws(s?):/, 'http$1:'));
    target.search = new URL(request.url).search;
    return fetch(target.toString(), { headers });
};

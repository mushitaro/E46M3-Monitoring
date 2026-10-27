import { json, ownerOf, unauthorized } from '../../_owner-gate/owner';

/**
 * POST /api/bridge/ticket — sixty seconds' admission to the assistant bridge, for the owner the
 * gate just verified.
 *
 * Ported from TUNER (functions/api/bridge/ticket.ts there). The bridge (TSUNAGI///Matrix,
 * matrix-tsunagi/bridge) verifies the ticket the tab hands it in the WebSocket subprotocol list
 * (never the URL):
 *
 *     v1.<base64url(JSON {o: owner id, a: 'monitoring', e: expiry, n: nonce})>.<base64url(HMAC-SHA256)>
 *
 * The copy of this format that VERIFIES is matrix-tsunagi/bridge/src/ticket.ts; change both. The
 * relay picks its secret by `a` (BRIDGE_TICKET_SECRET_MONITORING there), so a secret leaked from
 * one app cannot mint the other's tickets. BRIDGE_TICKET_SECRET is set on this project and on the
 * relay, piped, never printed.
 *
 * The socket the answer names is this origin's /api/bridge/socket (socket.ts), not the relay's
 * address: the CSP keeps connect-src 'self' (public/_headers).
 *
 * POST rather than GET so the gate's own-origin rule for writes applies: another site cannot mint
 * a ticket with the owner's cookie by putting this URL in an <img>.
 */

interface BridgeEnv {
    BRIDGE_TICKET_SECRET?: string;
    /** The relay's tab socket. A var in wrangler.jsonc; without it the bridge is off for everyone. */
    BRIDGE_TAB_URL?: string;
}

const TTL_S = 60;
export const SOCKET_PATH = '/api/bridge/socket';

const enc = new TextEncoder();
const b64url = (bytes: Uint8Array) => {
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

export async function mintTicket(secret: string, owner: string, nowSec: number): Promise<string> {
    const n = b64url(crypto.getRandomValues(new Uint8Array(9)));
    const payload = b64url(enc.encode(JSON.stringify({ o: owner, a: 'monitoring', e: Math.floor(nowSec) + TTL_S, n })));
    const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(`v1.${payload}`)));
    return `v1.${payload}.${b64url(sig)}`;
}

export const onRequestPost = async ({ env, data }: { env: BridgeEnv; data: Record<string, unknown> }): Promise<Response> => {
    const owner = ownerOf(data);
    if (!owner) return unauthorized();
    const secret = env.BRIDGE_TICKET_SECRET;
    // Not configured is said as such, so the panel can tell "this build has no bridge" from "down".
    if (!secret || secret.length < 32 || !env.BRIDGE_TAB_URL) return json({ error: 'bridge_unavailable' }, 503);
    return json({ ticket: await mintTicket(secret, owner.id, Date.now() / 1000), url: SOCKET_PATH, ttl: TTL_S });
};

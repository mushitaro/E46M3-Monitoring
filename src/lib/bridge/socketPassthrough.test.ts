import { afterEach, describe, expect, it, vi } from 'vitest';
import { onRequestGet } from '../../../functions/api/bridge/socket';

/** The same-origin socket passes the tab's query on to the relay, and keeps the owner's cookies here. */

afterEach(() => vi.restoreAllMocks());

describe('/api/bridge/socket', () => {
    it('passes takeover, did and nav on to the relay, and not the cookie', async () => {
        const seen: { url: string; headers: Headers }[] = [];
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
            seen.push({ url: String(url), headers: new Headers(init?.headers) });
            return new Response(null, { status: 200 });
        });
        const request = new Request('https://e46m3-monitoring-preview.pages.dev/api/bridge/socket?takeover=1&did=abcdefghijklmnop&nav=1', {
            headers: { upgrade: 'websocket', cookie: 'gate=secret', 'sec-websocket-protocol': 'works-bridge.v1, t.x' },
        });
        await onRequestGet({ request, env: { BRIDGE_TAB_URL: 'wss://matrix-mcp.tsunagi.app/tab' }, data: { owner: { id: 'acct-00000001', label: '#T0' } } });
        expect(seen[0].url).toBe('https://matrix-mcp.tsunagi.app/tab?takeover=1&did=abcdefghijklmnop&nav=1');
        expect(seen[0].headers.get('cookie')).toBeNull();
        expect(seen[0].headers.get('sec-websocket-protocol')).toBe('works-bridge.v1, t.x');
    });
});

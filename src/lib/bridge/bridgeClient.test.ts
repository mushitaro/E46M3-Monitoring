import { afterEach, describe, expect, it, vi } from 'vitest';
import { BRIDGE_PROTOCOL, BridgeClient, toSocketUrl, type BridgeStatus, type Hello } from './bridgeClient';

/**
 * The client against a fake socket and a fake ticket endpoint: what it offers, what it says first,
 * what it does with the relay's answer to that, and how it answers a call.
 */

class FakeSocket {
    static last: FakeSocket | null = null;
    sent: string[] = [];
    onopen: (() => void) | null = null;
    onmessage: ((ev: { data: string }) => void) | null = null;
    onclose: ((ev: { code: number; reason: string }) => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(
        readonly url: string,
        readonly protocols: string[],
    ) {
        FakeSocket.last = this;
    }
    send(s: string) {
        this.sent.push(s);
    }
    close() {}
    open() {
        this.onopen?.();
    }
    receive(o: unknown) {
        this.onmessage?.({ data: JSON.stringify(o) });
    }
}

const hello: Hello = {
    build: '1.abc',
    variant: 'preview',
    device: 'ナビ',
    tools: [{ name: 'monitoring_status', description: 'The tab now.', inputSchema: { type: 'object' }, scope: 'read' }],
    guide: { version: 'deadbeef', index: '# MONITORING', topics: { drive: '## drive' } },
};

function client(handlers: Record<string, (a: Record<string, unknown>) => Promise<unknown>> = {}) {
    const statuses: BridgeStatus[] = [];
    const c = new BridgeClient({
        ticketUrl: '/api/bridge/ticket',
        base: 'https://e46m3-monitoring-preview.pages.dev/',
        handlers: () => handlers,
        hello: async () => hello,
        onStatus: (s) => statuses.push(s),
        fetch: (async () => new Response(JSON.stringify({ ticket: 'v1.abc.def', url: '/api/bridge/socket' }))) as unknown as typeof fetch,
        WebSocket: FakeSocket as unknown as typeof WebSocket,
    });
    return { c, statuses };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
    vi.useRealTimers();
});

describe('the bridge client', () => {
    it('opens this origin’s socket, offering the protocol and the ticket', async () => {
        const { c } = client();
        c.start();
        await flush();
        const ws = FakeSocket.last!;
        expect(ws.url).toBe('wss://e46m3-monitoring-preview.pages.dev/api/bridge/socket');
        expect(ws.protocols).toEqual([BRIDGE_PROTOCOL, 't.v1.abc.def']);
        expect(BRIDGE_PROTOCOL).toBe('works-bridge.v1');
        c.stop();
    });

    it('says hello with proto 2, the app, the tools and the guide', async () => {
        const { c } = client();
        c.start();
        await flush();
        const ws = FakeSocket.last!;
        ws.open();
        await flush();
        const h = JSON.parse(ws.sent[0]);
        expect(h).toMatchObject({ type: 'hello', proto: 2, app: 'monitoring', device: 'ナビ', guide: { version: 'deadbeef' } });
        expect(h.tools[0].name).toBe('monitoring_status');
        c.stop();
    });

    it('carries the relay’s refusal of a hello in its status', async () => {
        const { c, statuses } = client();
        c.start();
        await flush();
        const ws = FakeSocket.last!;
        ws.open();
        ws.receive({ type: 'hello_refused', reason: 'Topic name "Drive" is not allowed.' });
        expect(statuses.at(-1)!.catalog).toEqual({ accepted: false, reason: 'Topic name "Drive" is not allowed.' });
        ws.receive({ type: 'hello_accepted', tools: 1, guide: 'deadbeef', hash: '0a1b2c3d' });
        expect(statuses.at(-1)!.catalog).toEqual({ accepted: true, hash: '0a1b2c3d' });
        c.stop();
    });

    it('answers a call with the handler’s result, and a throw as ok: false', async () => {
        const { c } = client({
            monitoring_status: async () => ({ device: 'ナビ' }),
            monitoring_stop_log: async () => {
                throw new Error('Read the request back first.');
            },
        });
        c.start();
        await flush();
        const ws = FakeSocket.last!;
        ws.open();
        ws.receive({ type: 'call', id: 'c1', tool: 'monitoring_status', args: {} });
        ws.receive({ type: 'call', id: 'c2', tool: 'monitoring_stop_log', args: {} });
        ws.receive({ type: 'call', id: 'c3', tool: 'monitoring_flash', args: {} });
        await flush();
        const answers = ws.sent.map((s) => JSON.parse(s)).filter((m) => m.type === 'result');
        expect(answers.find((a) => a.id === 'c1')).toMatchObject({ ok: true, result: { device: 'ナビ' } });
        expect(answers.find((a) => a.id === 'c2')).toMatchObject({ ok: false, error: 'Read the request back first.' });
        expect(answers.find((a) => a.id === 'c3')).toMatchObject({ ok: false });
        c.stop();
    });

    it('waits, held, when another device’s tab has the assistant', async () => {
        vi.useFakeTimers();
        const { c, statuses } = client();
        c.start();
        await vi.advanceTimersByTimeAsync(0);
        FakeSocket.last!.onclose?.({ code: 4002, reason: 'held:ラップトップ' });
        expect(statuses.at(-1)).toMatchObject({ state: 'held', holder: 'ラップトップ' });
        c.stop();
    });
});

describe('the socket URL', () => {
    it('takes the page’s scheme and host for a path', () => {
        expect(toSocketUrl('/api/bridge/socket', 'https://x.pages.dev/app')).toBe('wss://x.pages.dev/api/bridge/socket');
        expect(toSocketUrl('/api/bridge/socket', 'http://localhost:8788/')).toBe('ws://localhost:8788/api/bridge/socket');
        expect(toSocketUrl('wss://matrix-mcp.tsunagi.app/tab')).toBe('wss://matrix-mcp.tsunagi.app/tab');
    });
});

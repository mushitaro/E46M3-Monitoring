import { afterEach, describe, expect, it, vi } from 'vitest';
import { BRIDGE_PROTOCOL, BridgeClient, MISSED_PONGS, toSocketUrl, type BridgeStatus, type Hello, type Net } from './bridgeClient';

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
    closed: number | null = null;
    close(code?: number) {
        this.closed = code ?? 1000;
    }
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

/** A network the test switches on and off, as the window's online/offline events would. */
function fakeNet(initially = true) {
    let online = initially;
    const listeners = new Set<(o: boolean) => void>();
    const net: Net = {
        online: () => online,
        subscribe: (cb) => {
            listeners.add(cb);
            return () => listeners.delete(cb);
        },
    };
    return { net, set: (o: boolean) => { online = o; listeners.forEach((cb) => cb(o)); } };
}

function client(handlers: Record<string, (a: Record<string, unknown>) => Promise<unknown>> = {}, extra: { net?: Net; device?: () => { id: string; nav: boolean } } = {}) {
    const statuses: BridgeStatus[] = [];
    const c = new BridgeClient({
        ticketUrl: '/api/bridge/ticket',
        base: 'https://e46m3-monitoring-preview.pages.dev/',
        handlers: () => handlers,
        hello: async () => hello,
        onStatus: (s) => statuses.push(s),
        fetch: (async () => new Response(JSON.stringify({ ticket: 'v1.abc.def', url: '/api/bridge/socket' }))) as unknown as typeof fetch,
        WebSocket: FakeSocket as unknown as typeof WebSocket,
        net: extra.net ?? fakeNet().net,
        device: extra.device,
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

describe('a socket the network dropped', () => {
    it('is taken for dead after two pongs missed in a row, and replaced', async () => {
        vi.useFakeTimers();
        const { c, statuses } = client();
        c.start();
        await vi.advanceTimersByTimeAsync(0);
        const first = FakeSocket.last!;
        first.open();
        expect(statuses.at(-1)!.state).toBe('live');
        // Each ping answered: the socket stands.
        for (let i = 0; i < 3; i++) {
            await vi.advanceTimersByTimeAsync(25_000);
            first.onmessage?.({ data: 'pong' });
        }
        expect(first.closed).toBeNull();
        // Then silence: MISSED_PONGS pings go unanswered, and the next tick drops it.
        await vi.advanceTimersByTimeAsync(25_000 * (MISSED_PONGS + 1));
        expect(first.closed).toBe(4100);
        expect(statuses.at(-1)!.state).toBe('retrying');
        await vi.advanceTimersByTimeAsync(1_000);
        expect(FakeSocket.last).not.toBe(first);
        c.stop();
    });

    it('says offline while the browser is, and connects the moment it is back', async () => {
        vi.useFakeTimers();
        const n = fakeNet();
        const { c, statuses } = client({}, { net: n.net });
        c.start();
        await vi.advanceTimersByTimeAsync(0);
        const first = FakeSocket.last!;
        first.open();
        n.set(false);
        expect(statuses.at(-1)!.state).toBe('offline');
        expect(first.closed).toBe(4100);
        await vi.advanceTimersByTimeAsync(120_000);
        expect(FakeSocket.last).toBe(first);
        n.set(true);
        await vi.advanceTimersByTimeAsync(0);
        expect(FakeSocket.last).not.toBe(first);
        c.stop();
    });

    it('does not start a socket while offline', async () => {
        const n = fakeNet(false);
        const { c, statuses } = client({}, { net: n.net });
        FakeSocket.last = null;
        c.start();
        await flush();
        expect(FakeSocket.last).toBeNull();
        expect(statuses.at(-1)!.state).toBe('offline');
        c.stop();
    });
});

describe('the device a socket names', () => {
    it('carries its id, and nav=1 on the head unit', async () => {
        const { c } = client({}, { device: () => ({ id: 'a'.repeat(22), nav: true }) });
        c.start();
        await flush();
        const u = new URL(FakeSocket.last!.url);
        expect(u.searchParams.get('did')).toBe('a'.repeat(22));
        expect(u.searchParams.get('nav')).toBe('1');
        c.stop();
    });

    it('carries no nav off the head unit, and takeover beside the id', async () => {
        const { c } = client({}, { device: () => ({ id: 'b'.repeat(22), nav: false }) });
        c.takeover();
        await flush();
        const u = new URL(FakeSocket.last!.url);
        expect(u.searchParams.get('nav')).toBeNull();
        expect(u.searchParams.get('takeover')).toBe('1');
        expect(u.searchParams.get('did')).toBe('b'.repeat(22));
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

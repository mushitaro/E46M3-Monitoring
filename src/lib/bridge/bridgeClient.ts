/**
 * The tab's end of the assistant bridge: one socket to the bridge Worker, kept open while ASSISTANT
 * is on, answering the calls that arrive on it.
 *
 * Ported from TUNER (src/lib/bridge/bridgeClient.ts there) and kept in its shape, so the two tabs
 * behave alike in the car. What differs for MONITORING (matrix-tsunagi 0.11.0):
 *
 *   - the socket is this origin's /api/bridge/socket, which the function passes through to the
 *     relay — the CSP keeps connect-src 'self' (public/_headers);
 *   - it offers `works-bridge.v1`, and the ticket says `a: 'monitoring'`;
 *   - the hello is proto 2: it declares the tools (tools.ts) and the guide (public/guide), and the
 *     relay answers `hello_accepted` or `hello_refused` with a reason, which the status carries.
 *
 *   1. POST /api/bridge/ticket on this origin — the owner gate vouches for the owner, the function
 *      mints sixty seconds' admission (functions/api/bridge/ticket.ts)
 *   2. open the socket the answer names, offering `works-bridge.v1` and the ticket as subprotocols
 *   3. say hello (build, variant, device, tools, guide), then answer each `call`
 *
 * It must never become the reason something else fails, so the same rules as the cues and the error
 * records: nothing here throws into the page, nothing here awaits on the poll loop's path, and a
 * handler that throws becomes an `ok: false` answer with its message. A dropped socket reconnects on
 * its own (1, 2, 5, 10, then every 30 s), with a fresh ticket each time — on a head unit the network
 * comes and goes with the car, and the owner turned this on to not think about it.
 *
 * One assistant reaches one tab, and a live tab keeps it (2026-10-21). Opened on a second device —
 * a laptop at home while the head unit logs on the road — this tab is refused (4002) and waits,
 * 'held', naming the device that has it; so is a tab another one took the bridge from (4000). A held
 * tab asks again once a minute and gets the bridge when the holder has gone quiet (asleep, closed),
 * or at once when the owner presses "switch here" on it (`takeover`). Two live tabs never trade it.
 *
 * Two corrections from a drive (2026-10-28). A socket the network dropped under it used to stay
 * 'live': the tab sent pings and never listened for the pongs. It now closes a socket that misses
 * two pongs running and opens a new one, and the browser's `online` event brings that forward;
 * while the browser says it is offline the status says so instead of 'live'. And each socket names
 * its device — a random id kept per device, and whether this is the head unit — so the relay can
 * replace this device's own stale socket at once rather than refuse it as another device's, and
 * give the head unit the bridge (`did`, `nav`; matrix-tsunagi's relay keeps one tab per device).
 */
import type { Handler } from './handlers';
import type { HelloGuide } from './guide';
import type { ToolScope } from './tools';

export type BridgeState =
    /** ASSISTANT is off (or this build has no bridge). */
    | 'off'
    /** Getting a ticket or opening the socket. */
    | 'connecting'
    /** Connected: the assistant can reach this tab. */
    | 'live'
    /** Not connected, will try again on its own. */
    | 'retrying'
    /** Another device's tab has the assistant. Asks again each minute; takes it when that one is
     *  quiet, or at once with takeover(). */
    | 'held'
    /** The browser says there is no network. Tries again the moment it comes back. */
    | 'offline'
    /** Not connected, and will not try again until ASSISTANT is switched off and on. */
    | 'stopped';

export interface BridgeStatus {
    state: BridgeState;
    /** Why, in a sentence, for the panel. */
    detail: string | null;
    /** Calls answered since it was switched on. */
    calls: number;
    /** 'held': the name of the device that has the assistant ('' when it has none, null when not
     *  known — a tab that lost it to another cannot tell which). */
    holder?: string | null;
    /** What the relay said to the last hello: kept the tools and guide, or refused them and why
     *  (it then keeps the previous ones). */
    catalog?: { accepted: true; hash: string } | { accepted: false; reason: string };
}

export interface Hello {
    build: string | null;
    variant: string | null;
    device?: string | null;
    tools: ReadonlyArray<{ name: string; description: string; inputSchema: object; scope: ToolScope }>;
    guide: HelloGuide;
}

export interface BridgeClientOptions {
    ticketUrl: string;
    handlers: () => Record<string, Handler>;
    hello: () => Promise<Hello>;
    onStatus: (s: BridgeStatus) => void;
    /** Where a relative socket path is resolved; the page's location otherwise. */
    base?: string;
    /** This device: a random id it keeps, and whether it is the head unit. Read for each socket. */
    device?: () => { id: string; nav: boolean } | null;
    /** Injectable for the tests; the browser's own otherwise. */
    fetch?: typeof fetch;
    WebSocket?: typeof WebSocket;
    /** Whether the browser is online, and its online/offline events; the window's otherwise. */
    net?: Net;
}

export interface Net {
    online(): boolean;
    /** Calls back on every change; returns the unsubscribe. */
    subscribe(onChange: (online: boolean) => void): () => void;
}

/** The window's network state, or always-online where there is no window (tests, the prerender). */
const browserNet: Net = {
    online: () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false),
    subscribe: (onChange) => {
        if (typeof window === 'undefined') return () => {};
        const on = () => onChange(true);
        const off = () => onChange(false);
        window.addEventListener('online', on);
        window.addEventListener('offline', off);
        return () => {
            window.removeEventListener('online', on);
            window.removeEventListener('offline', off);
        };
    },
};

export const BRIDGE_PROTOCOL = 'works-bridge.v1';
export const HELLO_PROTO = 2;
export const BRIDGE_APP = 'monitoring';
const BACKOFF_S = [1, 2, 5, 10, 30];
/** How often a held tab asks again: long enough not to churn, short enough that the head unit has
 *  the assistant back within a minute of the laptop going to sleep. */
const HELD_RETRY_S = 60;
/** The relay's refusal: another device's live tab has the assistant. */
export const HELD_CLOSE_CODE = 4002;
/** The relay's replacement: a newer socket from this same device (another tab of it) took over. */
export const REPLACED_CLOSE_CODE = 4003;
const PING_MS = 25_000;
/** Pongs missed in a row before the socket is taken for dead and replaced. */
export const MISSED_PONGS = 2;
/** A handler that has not answered by now is reported as failed; the bridge itself waits 20 s. */
const HANDLER_TIMEOUT_MS = 15_000;
/** Largest answer sent; the bridge refuses anything over 2 MB. */
const MAX_ANSWER_CHARS = 1_500_000;

export class BridgeClient {
    private ws: WebSocket | null = null;
    private running = false;
    private attempt = 0;
    private timer: ReturnType<typeof setTimeout> | null = null;
    private ping: ReturnType<typeof setInterval> | null = null;
    /** Pings sent on the open socket since its last pong. */
    private unanswered = 0;
    private unsubscribeNet: (() => void) | null = null;
    private status: BridgeStatus = { state: 'off', detail: null, calls: 0 };
    /** The next socket asks the relay to take the assistant from a live tab — the owner's press. */
    private takeoverNext = false;
    private readonly o: BridgeClientOptions;

    // A plain field, not a parameter property: Node's type stripping (the verify scripts) refuses those.
    constructor(options: BridgeClientOptions) {
        this.o = options;
    }

    start(): void {
        if (this.running) return;
        this.running = true;
        this.attempt = 0;
        this.status = { state: 'connecting', detail: null, calls: 0 };
        this.emit();
        this.unsubscribeNet = this.net().subscribe((online) => (online ? this.backOnline() : this.wentOffline()));
        void this.connect();
    }

    stop(): void {
        this.running = false;
        this.unsubscribeNet?.();
        this.unsubscribeNet = null;
        if (this.timer) clearTimeout(this.timer);
        this.timer = null;
        this.clearPing();
        const ws = this.ws;
        this.ws = null;
        try { ws?.close(1000, 'ASSISTANT switched off'); } catch { /* already closed */ }
        this.set('off', null);
    }

    /** "Switch here": take the assistant from whichever device has it now. */
    takeover(): void {
        if (!this.running) this.running = true;
        this.takeoverNext = true;
        if (this.timer) clearTimeout(this.timer);
        this.timer = null;
        const ws = this.ws;
        this.ws = null;
        this.clearPing();
        try { ws?.close(1000, 'switching'); } catch { /* already closed */ }
        void this.connect();
    }

    private net(): Net {
        return this.o.net ?? browserNet;
    }

    /** Drop the socket in hand, whatever state it is in, without its close deciding anything. */
    private drop(reason: string) {
        const ws = this.ws;
        this.ws = null;
        this.clearPing();
        try { ws?.close(4100, reason); } catch { /* already closed */ }
    }

    /** The network is back: whatever this tab was waiting for, connect now with a fresh socket. */
    private backOnline() {
        if (!this.running || this.status.state === 'held') return;
        if (this.timer) clearTimeout(this.timer);
        this.timer = null;
        this.drop('network back');
        this.attempt = 0;
        void this.connect();
    }

    /** No network: say so, and wait for it rather than count retries against nothing. */
    private wentOffline() {
        if (!this.running) return;
        if (this.timer) clearTimeout(this.timer);
        this.timer = null;
        this.drop('offline');
        this.set('offline', 'No network. Connecting again the moment it is back.');
    }

    /** Held by another device: wait, and ask again in a minute — or, `again: false`, only when asked. */
    private hold(holder: string | null, detail: string, again = true) {
        if (!this.running) return;
        this.status = { ...this.status, state: 'held', detail, holder };
        this.emit();
        if (again) this.timer = setTimeout(() => { this.timer = null; void this.connect(); }, HELD_RETRY_S * 1000);
    }

    private emit() {
        try { this.o.onStatus({ ...this.status }); } catch { /* a listener's problem is not the bridge's */ }
    }

    private set(state: BridgeState, detail: string | null) {
        this.status = { ...this.status, state, detail, holder: state === 'held' ? this.status.holder : undefined };
        this.emit();
    }

    private clearPing() {
        if (this.ping) clearInterval(this.ping);
        this.ping = null;
    }

    private retry(detail: string, slow = false) {
        if (!this.running) return;
        const s = slow ? 60 : BACKOFF_S[Math.min(this.attempt, BACKOFF_S.length - 1)];
        this.attempt++;
        this.set('retrying', `${detail} Trying again in ${s} s.`);
        this.timer = setTimeout(() => { this.timer = null; void this.connect(); }, s * 1000);
    }

    private async connect(): Promise<void> {
        if (!this.running) return;
        if (!this.net().online()) {
            this.wentOffline();
            return;
        }
        this.set('connecting', null);
        const doFetch = this.o.fetch ?? fetch;
        let ticket: string;
        let url: string;
        try {
            const res = await doFetch(this.o.ticketUrl, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: '{}' });
            if (res.status === 401) { this.retry('This device is signed out of WORKS; sign in again.', true); return; }
            if (res.status === 503) {
                const body = await res.json().catch(() => null) as { error?: string } | null;
                if (body?.error === 'bridge_unavailable') { this.running = false; this.set('stopped', 'This build has no assistant bridge configured.'); return; }
                this.retry('WORKS sign-in could not be checked.');
                return;
            }
            if (!res.ok) { this.retry(`The ticket was refused (${res.status}).`); return; }
            const body = await res.json() as { ticket?: string; url?: string };
            if (!body.ticket || !body.url) { this.retry('The ticket answer was incomplete.'); return; }
            ticket = body.ticket;
            // The function answers with a path on this origin; a socket needs the ws(s) scheme.
            url = toSocketUrl(body.url, this.o.base);
            if (this.takeoverNext) url = withParam(url, 'takeover', '1');
            this.takeoverNext = false;
            const device = this.o.device?.() ?? null;
            if (device) {
                url = withParam(url, 'did', device.id);
                if (device.nav) url = withParam(url, 'nav', '1');
            }
        } catch {
            if (!this.net().online()) this.wentOffline();
            else this.retry('No network.');
            return;
        }
        if (!this.running) return;

        const WS = this.o.WebSocket ?? WebSocket;
        let ws: WebSocket;
        try {
            ws = new WS(url, [BRIDGE_PROTOCOL, `t.${ticket}`]);
        } catch (e) {
            this.retry(`The socket could not be opened: ${(e as Error).message}`);
            return;
        }
        this.ws = ws;
        ws.onopen = () => {
            if (this.ws !== ws) return;
            this.attempt = 0;
            this.set('live', null);
            void this.o
                .hello()
                .then((h) => {
                    if (this.ws !== ws) return;
                    ws.send(JSON.stringify({ type: 'hello', proto: HELLO_PROTO, app: BRIDGE_APP, ...h }));
                })
                .catch((e: unknown) => {
                    // Without its guide the tab still answers; the relay keeps the guide it had.
                    this.status = { ...this.status, catalog: { accepted: false, reason: `The guide could not be read: ${(e as Error).message}` } };
                    this.emit();
                });
            this.clearPing();
            this.unanswered = 0;
            this.ping = setInterval(() => {
                if (this.ws !== ws) return;
                // A socket the network dropped under it never says so; its silence does.
                if (this.unanswered >= MISSED_PONGS) {
                    this.drop('no pong');
                    this.retry('The bridge stopped answering.');
                    return;
                }
                this.unanswered++;
                try { ws.send('ping'); } catch { /* close handler */ }
            }, PING_MS);
        };
        ws.onmessage = (ev: MessageEvent) => {
            if (this.ws !== ws || typeof ev.data !== 'string') return;
            if (ev.data === 'pong') {
                this.unanswered = 0;
                return;
            }
            let msg: { type?: unknown; id?: unknown; tool?: unknown; args?: unknown; hash?: unknown; reason?: unknown };
            try { msg = JSON.parse(ev.data); } catch { return; }
            if (msg.type === 'hello_accepted' || msg.type === 'hello_refused') {
                this.status = {
                    ...this.status,
                    catalog: msg.type === 'hello_accepted'
                        ? { accepted: true, hash: typeof msg.hash === 'string' ? msg.hash : '' }
                        : { accepted: false, reason: typeof msg.reason === 'string' ? msg.reason : 'refused' },
                };
                this.emit();
                return;
            }
            if (msg.type !== 'call' || typeof msg.id !== 'string' || typeof msg.tool !== 'string') return;
            void this.answer(ws, msg.id, msg.tool, (msg.args && typeof msg.args === 'object' ? msg.args : {}) as Record<string, unknown>);
        };
        ws.onclose = (ev: CloseEvent) => {
            if (this.ws !== ws) return;
            this.ws = null;
            this.clearPing();
            if (!this.running) return;
            if (ev.code === HELD_CLOSE_CODE) {
                const holder = typeof ev.reason === 'string' && ev.reason.startsWith('held:') ? ev.reason.slice(5) : null;
                this.hold(holder, `Another device${holder ? ` ("${holder}")` : ''} has the assistant. This tab takes it when that one goes quiet, or now with "switch here".`);
                return;
            }
            if (ev.code === 4000) {
                this.hold(null, 'Another device took the assistant. This tab takes it back when that one goes quiet, or now with "switch here".');
                return;
            }
            // Another tab of this same device opened a newer socket. Asking again would take it back
            // from that tab a minute later, and the two would trade it all drive; this one waits for
            // "switch here".
            if (ev.code === REPLACED_CLOSE_CODE) {
                this.hold(null, 'Another tab on this device has the assistant now. "Switch here" brings it back to this one.', false);
                return;
            }
            this.retry('The bridge connection closed.');
        };
        ws.onerror = () => { /* onclose follows and decides */ };
    }

    private async answer(ws: WebSocket, id: string, tool: string, args: Record<string, unknown>): Promise<void> {
        let reply: { type: 'result'; id: string; ok: boolean; result?: unknown; error?: string };
        try {
            const handler = this.o.handlers()[tool];
            if (!handler) throw new Error(`This tab does not answer "${tool}".`);
            const result = await Promise.race([
                handler(args),
                new Promise((_, reject) => setTimeout(() => reject(new Error('The tab took too long to answer.')), HANDLER_TIMEOUT_MS)),
            ]);
            reply = { type: 'result', id, ok: true, result };
        } catch (e) {
            reply = { type: 'result', id, ok: false, error: e instanceof Error ? e.message : String(e) };
        }
        let text = JSON.stringify(reply);
        if (text.length > MAX_ANSWER_CHARS) text = JSON.stringify({ type: 'result', id, ok: false, error: 'The answer was too large to send; ask for a narrower window.' });
        try { ws.send(text); } catch { /* the socket went; the bridge times the call out */ }
        this.status = { ...this.status, calls: this.status.calls + 1 };
        this.emit();
    }
}

/** `url` with one query parameter set. */
function withParam(url: string, key: string, value: string): string {
    const u = new URL(url);
    u.searchParams.set(key, value);
    return u.toString();
}

/** A path on this origin, or an absolute URL, as a WebSocket URL. */
export function toSocketUrl(url: string, base?: string): string {
    const u = new URL(url, base ?? (typeof location !== 'undefined' ? location.href : 'http://localhost/'));
    if (u.protocol === 'https:') u.protocol = 'wss:';
    else if (u.protocol === 'http:') u.protocol = 'ws:';
    return u.toString();
}

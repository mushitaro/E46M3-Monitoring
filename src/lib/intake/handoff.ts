/**
 * SEND: the intake report to the store's E46 /// MAINTENANCE tab that opened this one, in the
 * background (operator, 2026-11-10, D6: MAINTENANCE is not brought to the front; the person stays
 * at the car, and MONITORING says "received" on its own hub).
 *
 * ## Why postMessage to the opener, and not BroadcastChannel
 *
 * The two tabs are on different origins — MONITORING on e46m3-monitoring-preview.pages.dev, the
 * store's MAINTENANCE on its own (gren-blue-auto-admin.pages.dev) — and, pages.dev being a public
 * suffix, on different sites too. A BroadcastChannel joins only contexts of one origin, and is
 * partitioned by the top-level site besides, so no channel can join these two, nor could a frame
 * of the store's origin inside this page relay to one (and this page's CSP frames nothing).
 * `postMessage` crosses origins with both ends named: this side posts with the store's registered
 * origin as `targetOrigin`, so the bytes go nowhere else even if the opener has navigated away, and
 * reads only messages whose `origin` is registered and whose `source` is its own opener. Posting to
 * a window does not focus it. The window it can reach without opening one is `window.opener`: the
 * MAINTENANCE tab that opened MONITORING from the car's page (`MONITORING ↗`). Opening MAINTENANCE
 * from here instead would bring it to the front, which D6 rules out.
 *
 * That opener survives only where MONITORING's document does not cut it: public/_headers keeps
 * `Cross-Origin-Opener-Policy: same-origin` on every path but `/intake`, the address MAINTENANCE
 * opens, so a MONITORING opened any other way (the head unit, the M menu, a bookmark) keeps the
 * stricter policy and simply has no opener, and SEND saves the file instead.
 *
 * ## The handshake
 *
 * `hello` to each registered origin, then wait for `ready` (the tab is there and accepts the
 * schema); only then the report, and wait for `received` or `refused` (./intakeCheck has the
 * messages). No opener, no `ready`: `no-tab`. A `ready` and then silence: `no-answer`. Either way
 * the caller saves the same JSON as a file, which the store can drop in instead.
 *
 * Pure apart from the window it is handed, so the rules hold in a test with a fake one.
 */
import { handoffAnswer, INTAKE_CHECK_SCHEMA, INTAKE_HANDOFF_PROTOCOL, type HandoffAnswer, type HandoffRefusal } from './intakeCheck';

export interface Mainstay {
    id: string;
    /** As the hub says it: 「GREN BLUE が受け取りました」. */
    name: string;
    /** Exact origin; nothing else is posted to or listened to. */
    origin: string;
}

/**
 * The stores whose MAINTENANCE may receive a report (operator, 2026-11-10). A new Mainstay is a
 * line here, reviewed like any other change to where data goes (privacy policy first).
 */
export const MAINSTAYS: readonly Mainstay[] = [{ id: 'gren-blue', name: 'GREN BLUE', origin: 'https://gren-blue-auto-admin.pages.dev' }];

/** The path MAINTENANCE opens MONITORING at: the one whose document keeps its opener (public/_headers). */
export const INTAKE_PATH = '/intake';

export interface MessageLike {
    origin: string;
    source: unknown;
    data: unknown;
}

export interface OpenerLike {
    closed?: boolean;
    postMessage(message: unknown, targetOrigin: string): void;
}

/** What of `window` the handshake uses. */
export interface HandoffWindow {
    opener: OpenerLike | null;
    addEventListener(type: 'message', listener: (e: MessageLike) => void): void;
    removeEventListener(type: 'message', listener: (e: MessageLike) => void): void;
}

export type HandoffOutcome =
    | { kind: 'received'; mainstay: Mainstay; sha256: string }
    | { kind: 'refused'; mainstay: Mainstay; reason: HandoffRefusal }
    /** No MAINTENANCE opened this tab, or none answered `hello`. */
    | { kind: 'no-tab' }
    /** It answered `ready` and then said nothing about the report. */
    | { kind: 'no-answer'; mainstay: Mainstay };

export interface HandoffOptions {
    nonce: string;
    mainstays?: readonly Mainstay[];
    /** How long a tab has to say `ready`. A tab that is there answers in milliseconds. */
    readyMs?: number;
    /** How long the store has to check the report and match the VIN on its server. */
    receivedMs?: number;
    timer?: (fn: () => void, ms: number) => unknown;
    clearTimer?: (id: unknown) => void;
}

/** A nonce for one SEND. */
export function newNonce(): string {
    return crypto.randomUUID().replace(/-/g, '');
}

export function handOff(win: HandoffWindow, json: string, sha256: string, opts: HandoffOptions): Promise<HandoffOutcome> {
    const mainstays = opts.mainstays ?? MAINSTAYS;
    const timer = opts.timer ?? ((fn, ms) => setTimeout(fn, ms));
    const clearTimer = opts.clearTimer ?? ((id) => clearTimeout(id as ReturnType<typeof setTimeout>));
    const opener = win.opener;
    if (!opener || opener.closed) return Promise.resolve({ kind: 'no-tab' });

    return new Promise((resolve) => {
        let peer: Mainstay | null = null;
        let pending: unknown = null;
        const finish = (o: HandoffOutcome) => {
            win.removeEventListener('message', onMessage);
            if (pending !== null) clearTimer(pending);
            resolve(o);
        };
        const wait = (ms: number, then: () => HandoffOutcome) => {
            if (pending !== null) clearTimer(pending);
            pending = timer(() => finish(then()), ms);
        };
        const post = (to: Mainstay, message: unknown): boolean => {
            try {
                opener.postMessage(message, to.origin);
                return true;
            } catch {
                return false;
            }
        };

        function onMessage(e: MessageLike) {
            if (e.source !== opener) return;
            const from = mainstays.find((m) => m.origin === e.origin);
            if (!from || (peer && peer.origin !== from.origin)) return;
            const parsed = handoffAnswer.safeParse(e.data);
            if (!parsed.success || parsed.data.protocol !== INTAKE_HANDOFF_PROTOCOL || parsed.data.nonce !== opts.nonce) return;
            const m: HandoffAnswer = parsed.data;
            if (m.type === 'ready' && peer === null) {
                if (!m.accepts.includes(INTAKE_CHECK_SCHEMA)) return finish({ kind: 'no-tab' });
                peer = from;
                const to = from;
                if (!post(to, { protocol: INTAKE_HANDOFF_PROTOCOL, type: 'report', nonce: opts.nonce, ref: m.ref ?? null, sha256, json })) return finish({ kind: 'no-answer', mainstay: to });
                wait(opts.receivedMs ?? 8000, () => ({ kind: 'no-answer', mainstay: to }));
            } else if (m.type === 'received' && peer !== null) {
                // The store names what it kept by its hash: anything else is not this report.
                if (m.sha256 !== sha256) return;
                finish({ kind: 'received', mainstay: peer, sha256 });
            } else if (m.type === 'refused' && peer !== null) {
                finish({ kind: 'refused', mainstay: peer, reason: m.reason });
            }
        }

        win.addEventListener('message', onMessage);
        const hello = { protocol: INTAKE_HANDOFF_PROTOCOL, type: 'hello', nonce: opts.nonce };
        // To each registered origin: the opener receives only the one that is its own origin.
        const sent = mainstays.map((m) => post(m, hello)).some(Boolean);
        if (!sent) return finish({ kind: 'no-tab' });
        wait(opts.readyMs ?? 1500, () => ({ kind: 'no-tab' }));
    });
}

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PREVIEW_NOTICE_KEY } from './previewNotice';
import {
    REPASS_AFTER_DISCONNECTED_MS,
    REPASS_GUARD_MS,
    STATUS_EVERY_MS,
    keepSignIn,
    lapseAction,
    markRepass,
    repassAllowed,
    signInOf,
} from './signInLapse';

const base = {
    signIn: 'lapsed' as const,
    linkState: 'disconnected',
    disconnectedSince: 0,
    now: REPASS_AFTER_DISCONNECTED_MS,
    unsaved: false,
    updating: false,
    online: true,
    guardOpen: true,
};

/** An answer from the origin, stamped by a server whose clock reads `serverTime`. */
const answer = (status: number, serverTime?: Date) =>
    new Response(null, { status, headers: serverTime ? { date: serverTime.toUTCString() } : {} });

describe('what the update check hears about the sign-in', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('a 401 from a server whose clock agrees: lapsed', () => {
        expect(signInOf(answer(401, new Date()))).toBe('lapsed');
    });

    it('a 401 while this device reads 2006, as the head unit does at boot: the clock', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2006-12-18T09:00:00Z'));
        expect(signInOf(answer(401, new Date('2026-10-29T09:00:00Z')))).toBe('clock');
        // And without a Date to compare against, agreement cannot be shown either.
        expect(signInOf(answer(401))).toBe('clock');
    });

    it('a 2xx: the sign-in holds. Anything else says nothing — m3 out of reach is not a lapse', () => {
        expect(signInOf(answer(200, new Date()))).toBe('ok');
        expect(signInOf(answer(503, new Date()))).toBeNull();
        expect(signInOf(answer(404, new Date()))).toBeNull();
        expect(signInOf(answer(403, new Date()))).toBeNull();
    });
});

describe('the app goes through the gate by itself only when nothing is lost', () => {
    it('goes once the link has been down a while, nothing is unsaved, and the clock agrees', () => {
        expect(lapseAction(base)).toBe('repass');
    });

    it('does nothing while nothing has lapsed', () => {
        expect(lapseAction({ ...base, signIn: 'ok' })).toBe('none');
        expect(lapseAction({ ...base, signIn: 'ok', linkState: 'logging', unsaved: true })).toBe('none');
    });

    it('with the clock out, says so instead, however idle the app is', () => {
        expect(lapseAction({ ...base, signIn: 'clock' })).toBe('notice-clock');
        expect(lapseAction({ ...base, signIn: 'clock', linkState: 'connected' })).toBe('notice-clock');
    });

    it('never while the link is up — connected, busy, recording or running PROBE', () => {
        for (const linkState of ['connected', 'connecting', 'busy', 'logging']) {
            expect(lapseAction({ ...base, linkState }), linkState).toBe('notice-signin');
        }
    });

    it('not for a cable that blinks: the link must have been down long enough', () => {
        expect(lapseAction({ ...base, now: REPASS_AFTER_DISCONNECTED_MS - 1 })).toBe('notice-signin');
        expect(lapseAction({ ...base, disconnectedSince: null })).toBe('notice-signin');
    });

    it('not with something unsaved, an update running, no network, or a trip in the last ten minutes', () => {
        expect(lapseAction({ ...base, unsaved: true })).toBe('notice-signin');
        expect(lapseAction({ ...base, updating: true })).toBe('notice-signin');
        expect(lapseAction({ ...base, online: false })).toBe('notice-signin');
        expect(lapseAction({ ...base, guardOpen: false })).toBe('notice-signin');
    });
});

function memoryStorage() {
    const m = new Map<string, string>();
    return {
        getItem: (k: string) => (m.has(k) ? (m.get(k) as string) : null),
        setItem: (k: string, v: string) => void m.set(k, String(v)),
        removeItem: (k: string) => void m.delete(k),
    };
}

describe('one trip per tab in ten minutes', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('allows the first, then none until ten minutes have passed', () => {
        vi.stubGlobal('sessionStorage', memoryStorage());
        const t0 = Date.parse('2026-10-29T09:00:00Z');
        expect(repassAllowed(t0)).toBe(true);
        expect(markRepass(t0)).toBe(true);
        expect(repassAllowed(t0 + REPASS_GUARD_MS - 1)).toBe(false);
        expect(repassAllowed(t0 + REPASS_GUARD_MS)).toBe(true);
    });

    it('does not hold a stamp from under another clock against the tab', () => {
        vi.stubGlobal('sessionStorage', memoryStorage());
        markRepass(Date.parse('2026-10-29T09:00:00Z'));
        expect(repassAllowed(Date.parse('2006-12-18T09:00:00Z'))).toBe(true);
    });

    it('allows none where storage cannot keep the stamp: nothing would stop the next one', () => {
        const no = () => {
            throw new DOMException('The operation is insecure.', 'SecurityError');
        };
        vi.stubGlobal('sessionStorage', { getItem: no, setItem: no, removeItem: no });
        expect(repassAllowed(0)).toBe(false);
        expect(markRepass(0)).toBe(false);
    });
});

describe('the daily extension, without SESSIONS', () => {
    /** The document's one tag this reads: which build this is. */
    const documentOf = (variant: string | null) => ({
        querySelector: (sel: string) =>
            sel === 'meta[name="app-variant"]' && variant !== null ? { getAttribute: () => variant } : null,
    });
    const gate = () =>
        vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(
            async () => new Response(JSON.stringify({ state: 'active', account_label: '#T0' }), { status: 200 }),
        );
    const asked = (fetch: ReturnType<typeof gate>) => fetch.mock.calls.map(([url]) => String(url).replace(/\?t=\d+$/, '?t'));

    let storage: ReturnType<typeof memoryStorage>;
    beforeEach(() => {
        storage = memoryStorage();
        vi.stubGlobal('localStorage', storage);
    });
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('asks the gate once a day after a 2xx, with the clock, so the gate can extend the sign-in', async () => {
        vi.stubGlobal('document', documentOf('preview'));
        storage.setItem(PREVIEW_NOTICE_KEY, '2026-10-29T00:00:00.000Z');
        const fetch = gate();
        vi.stubGlobal('fetch', fetch);
        const t0 = Date.now();

        await keepSignIn(answer(200, new Date()), t0);
        expect(asked(fetch)).toEqual(['/_gate/status?t']);
        await keepSignIn(answer(200, new Date()), t0 + STATUS_EVERY_MS - 1);
        expect(fetch).toHaveBeenCalledTimes(1);
        await keepSignIn(answer(200, new Date()), t0 + STATUS_EVERY_MS);
        expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('asks nothing before the owner has acknowledged what the WORKS build sends', async () => {
        vi.stubGlobal('document', documentOf('preview'));
        const fetch = gate();
        vi.stubGlobal('fetch', fetch);
        await keepSignIn(answer(200, new Date()));
        expect(fetch).not.toHaveBeenCalled();
    });

    it('asks nothing in production, even on a device that once acknowledged a WORKS notice', async () => {
        vi.stubGlobal('document', documentOf(null));
        storage.setItem(PREVIEW_NOTICE_KEY, '2026-10-29T00:00:00.000Z');
        const fetch = gate();
        vi.stubGlobal('fetch', fetch);
        await keepSignIn(answer(200, new Date()));
        expect(fetch).not.toHaveBeenCalled();
    });

    it('asks nothing after a 401, nor with the clock out, where the gate would extend nothing', async () => {
        vi.stubGlobal('document', documentOf('preview'));
        storage.setItem(PREVIEW_NOTICE_KEY, '2026-10-29T00:00:00.000Z');
        const fetch = gate();
        vi.stubGlobal('fetch', fetch);
        await keepSignIn(answer(401, new Date()));
        await keepSignIn(answer(200, new Date(Date.now() - 2 * 86_400_000)));
        await keepSignIn(answer(200));
        expect(fetch).not.toHaveBeenCalled();
    });
});

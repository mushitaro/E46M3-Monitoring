/**
 * When the WORKS build's sign-in has lapsed, and what the app does about it.
 *
 * ## Why the app has to notice at all
 *
 * The service worker answers every navigation from its cache — that is what opens the app in a
 * garage with no signal — so a lapsed sign-in never brings up the gate's sign-in page. The app just
 * goes on running the build it has, and the update check, the one request that would have brought a
 * newer build, is answered 401 instead. That is what happened on the car's head unit on 2026-10-29:
 * its cookies went when its clock was put right (it boots at 2006-12-18), and the WORKS build ran an
 * old build in silence, RELOAD reloading the same one, for as long as nobody looked.
 *
 * So the update check publishes what it heard (`signInOf`, hooks/useAppUpdate) and the shell acts
 * on it (`lapseAction`):
 *
 *     repass         go through the gate again by itself (owner-sync `reauthHref`). m3 sends an
 *                    owner who is still signed in there straight back, and the app opens again with
 *                    a sign-in. Only when that costs nothing: the state lib/adoptBuild waits for
 *                    before it swaps a build (the link down a minute, nothing unsaved, no update
 *                    running), a network, and a clock the server agrees with.
 *     notice-signin  otherwise, say so in the header, with SIGN IN AGAIN.
 *     notice-clock   the device's clock is out. Going through the gate now would only show its page
 *                    that waits for the clock, and the app would be off the screen until the head
 *                    unit put its clock right. So say that, and decide again at the next check (two
 *                    minutes), which will find the clock right. Nothing to press.
 *     none           nothing has said the sign-in lapsed.
 *
 * At most one trip per tab in ten minutes (`repassAllowed`), kept in sessionStorage, which lasts as
 * long as the tab and survives the trip through m3. If m3 sends the owner back still without a
 * sign-in that holds, the next 401 shows the notice rather than starting a loop that keeps the
 * screen bouncing through m3.
 *
 * Production never gets here. It makes no request of its own, so it never hears a 401
 * (THIRD-PARTY-NOTICES.md §1), and nothing stands in front of it to answer one.
 */
import { ADOPT_AFTER_DISCONNECTED_MS } from './adoptBuild';
import { canSync } from './sync/cloud';
import { clockAgrees, gateStatus } from './sync/owner-sync';

/**
 * The sign-in, as this origin last answered.
 *
 *     ok       nothing has said otherwise: a 2xx, or no answer yet
 *     lapsed   a 401, from a server whose clock agrees with this device's
 *     clock    a 401, and this device's clock is more than a day from the server's
 */
export type SignIn = 'ok' | 'lapsed' | 'clock';

export type LapseAction = 'repass' | 'notice-signin' | 'notice-clock' | 'none';

/** The link down this long first, as before a build swap: a cable that blinks mid-drive does not count. */
export const REPASS_AFTER_DISCONNECTED_MS = ADOPT_AFTER_DISCONNECTED_MS;

/** At most one trip through the gate per tab in this long. */
export const REPASS_GUARD_MS = 10 * 60_000;

/**
 * What a response from this origin says about the sign-in, or null when it says nothing.
 *
 * A 401 is the gate: every request it cannot match to a session gets one. A 503 is m3 out of reach,
 * which is not a lapse (owner-sync `gateStatus` reads it the same way), and a 404 is about the path.
 */
export function signInOf(res: Response): SignIn | null {
    if (res.status === 401) return clockAgrees(res) ? 'lapsed' : 'clock';
    return res.ok ? 'ok' : null;
}

export function lapseAction(s: {
    signIn: SignIn;
    linkState: string;
    /** When the link was last seen go down, or null while it is up. */
    disconnectedSince: number | null;
    now: number;
    unsaved: boolean;
    /** An update reload is running: it ends in a reload of its own. */
    updating: boolean;
    online: boolean;
    /** `repassAllowed`: no trip from this tab in the last ten minutes, and storage to say so. */
    guardOpen: boolean;
}): LapseAction {
    if (s.signIn === 'ok') return 'none';
    if (s.signIn === 'clock') return 'notice-clock';
    if (s.unsaved || s.updating || !s.online || !s.guardOpen) return 'notice-signin';
    if (s.linkState !== 'disconnected' || s.disconnectedSince === null) return 'notice-signin';
    return s.now - s.disconnectedSince >= REPASS_AFTER_DISCONNECTED_MS ? 'repass' : 'notice-signin';
}

const REPASS_KEY = 'sign-in:repassed-at';

/**
 * Whether this tab may go through the gate by itself now. False where storage cannot be read: then
 * nothing could stop the trip after it, and the notice is the safe answer.
 *
 * Either side of `now`, because the clock this was stamped under may since have moved. The stamp is
 * only written with the clock agreeing to within a day, but a day is wider than the guard.
 */
export function repassAllowed(now: number): boolean {
    try {
        const raw = sessionStorage.getItem(REPASS_KEY);
        if (raw === null) return true;
        const at = Number(raw);
        return !Number.isFinite(at) || Math.abs(now - at) >= REPASS_GUARD_MS;
    } catch {
        return false;
    }
}

/** Stamps the trip. False when it could not be kept, and then the trip is not made, for the same reason. */
export function markRepass(now: number): boolean {
    try {
        sessionStorage.setItem(REPASS_KEY, String(now));
        return true;
    } catch {
        return false;
    }
}

const STATUS_KEY = 'sign-in:status-at';

/** How often the sign-in is offered its extension: the gate extends it at most this often anyway. */
export const STATUS_EVERY_MS = 86_400_000;

/**
 * Keep the sign-in from lapsing on a device that never opens SESSIONS.
 *
 * The gate extends its cookie in one place only, `/_gate/status?t` (owner-sync `gateStatus`),
 * because only there does the request say what time the device thinks it is; re-stamped under a
 * clock years out, the cookie would die the moment the clock was put right. Until now the app asked
 * there only from SESSIONS and when records were sent, and the head unit may open neither for
 * months: its sign-in would lapse 180 days after it was given, however often the car was driven.
 *
 * So the update check hands every answer here, and this asks the gate at most once a day, under
 * three conditions:
 *
 *   - the answer was a 2xx: the sign-in holds, so there is something to extend;
 *   - this device's clock agrees with the server's: the gate would decline to extend under any
 *     other, and the day would have been spent on nothing;
 *   - `canSync()`: the WORKS build, with the owner's acknowledgement of what it sends. Before that
 *     acknowledgement nothing is asked, "not even whether the owner is signed in" (lib/sync/cloud),
 *     and `gateStatus()` is that question. Production fails the first half and asks nothing.
 *
 * Stamped before it asks, so two checks that overlap ask once, and a stamp that cannot be kept
 * means no asking at all: nothing would hold it to once a day. One that fails is tried again the
 * next day, which is early enough for a sign-in that lasts 180.
 */
export async function keepSignIn(res: Response, now = Date.now()): Promise<void> {
    if (!res.ok || !clockAgrees(res) || !canSync()) return;
    try {
        const raw = localStorage.getItem(STATUS_KEY);
        const at = raw === null ? NaN : Number(raw);
        if (Number.isFinite(at) && Math.abs(now - at) < STATUS_EVERY_MS) return;
        localStorage.setItem(STATUS_KEY, String(now));
    } catch {
        return;
    }
    await gateStatus();
}

/**
 * The head unit's address bar (owner, 2026-11-13: "sometimes, when I open the app on the head unit,
 * the address bar shows at the top — why only sometimes?").
 *
 * The launcher (E46M3-Launcher) opens this build as a Trusted Web Activity. Chrome draws a TWA with
 * no toolbar only after it has verified the origin against `/.well-known/assetlinks.json`; when that
 * check fails it does not report an error anywhere — it opens the same page as a Custom Tab, toolbar
 * and all. On this head unit the check can fail for a reason of its own: it boots with its clock at
 * 2006-12-18 (functions/_owner-gate/gate.ts, "The device's clock"), and while the clock is years out
 * no certificate is valid yet, so the fetch of assetlinks.json fails while the page itself still
 * comes up from the service worker. Whether the clock is right by the time the launcher opens the
 * tool is what makes it "sometimes". The other way the bar appears is by design: the gate's sign-in
 * goes through m3.tsunagi.app, another origin, and a TWA shows its bar while it is away.
 *
 * Neither cause is this page's to fix (the launcher and the gate are other repositories), but the
 * page can tell when it happened — the launcher opened it, yet it is being shown as a browser tab
 * (`display-mode: browser`; a verified TWA reports `standalone`) — and can take the screen back:
 * the Fullscreen API hides a Custom Tab's toolbar too. It needs a tap, so the next tap on the page
 * does it. Not a tap on a control: entering full screen spends the tap's user activation, and the
 * control's own handler (the cable chooser, above all) needs it.
 */

/** What the decision needs to know about the page, read by the component. */
export interface FullscreenEnv {
    /** The launcher opened this page (`OPENED_BY_LAUNCHER`). */
    openedByLauncher: boolean;
    /** `matchMedia('(display-mode: browser)').matches` — the page is shown as a browser tab. */
    displayModeBrowser: boolean;
    /** `document.fullscreenEnabled`. */
    fullscreenEnabled: boolean;
    /** `document.fullscreenElement !== null`. */
    inFullscreen: boolean;
}

/** Whether the next plain tap should take the page full screen. */
export function shouldTakeScreen(env: FullscreenEnv): boolean {
    return env.openedByLauncher && env.displayModeBrowser && env.fullscreenEnabled && !env.inFullscreen;
}

/** Elements whose own handler may need the tap's user activation. */
const CONTROLS = 'button, a, input, select, textarea, label, summary, [role="button"], [role="link"], [role="switch"], [role="tab"], [role="menuitem"], [contenteditable=""], [contenteditable="true"]';

/** Whether a tap landed on nothing that acts on it — the only taps that may be spent on full screen. */
export function isPlainTap(target: EventTarget | null): boolean {
    const el = target as { closest?: (s: string) => unknown } | null;
    if (!el || typeof el.closest !== 'function') return false;
    return el.closest(CONTROLS) === null;
}

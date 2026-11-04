/**
 * The app's clock: one that does not jump, and that tells the time the server does.
 *
 * The head unit's own clock is not the owner's to set. It boots at 2006, GPS may leave it in 2007
 * (a week-number rollover), and it can be put right in the middle of a drive (functions/_lib/
 * deviceClock.ts puts it right on the way into the account). A clock that jumps under a running page
 * reorders what the page records: on 2026-11-04 a fault read and a recording landed outside the
 * episode SAVE kept, because their times sat years before it, and a speed read "5 s ago" can be
 * years old or in the future.
 *
 * So the page keeps its own: `performance.now()` from the page's start, which never jumps, set to
 * the server's time once the origin has answered with a `Date` header (the kill list is fetched at
 * open and every ten minutes). Until then it is the device's clock as it stood when the page opened.
 * Within one page the times only ever go forward; the one step is when the server's time is first
 * learnt, and only when the two disagree by more than a minute.
 */

/** A difference under this is not corrected: the step would reorder more than it fixes. */
const STEP_MS = 60_000;

let offset = 0;

const mono = (): number =>
    typeof performance !== 'undefined' && typeof performance.now === 'function' && Number.isFinite(performance.timeOrigin)
        ? performance.timeOrigin + performance.now()
        : Date.now();

/** Now, in ms since the epoch: monotonic within the page, on the server's time once learnt. */
export function appNow(): number {
    return Math.round(mono() + offset);
}

/**
 * Learn the server's time from a response's `Date` header. `sentAt` and `receivedAt` are `appNow()`
 * around the request; the server's second falls between them. Returns the step taken, 0 for none.
 */
export function learnServerTime(dateHeader: string | null, sentAt: number, receivedAt: number): number {
    if (!dateHeader) return 0;
    const server = Date.parse(dateHeader);
    if (!Number.isFinite(server)) return 0;
    // The header has whole seconds: the server's moment is somewhere in [server, server + 1 s).
    const step = server + 500 - (sentAt + receivedAt) / 2;
    if (Math.abs(step) < STEP_MS) return 0;
    offset += step;
    return step;
}

/** For tests: forget what was learnt. */
export function resetClock(): void {
    offset = 0;
}

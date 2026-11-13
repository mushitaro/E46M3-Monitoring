/**
 * When the WORKS build swaps itself to a newer build it has already downloaded.
 *
 * A swap is a reload, and a reload drops the cable link, the assistant's socket and the screen.
 * Done while the car is in use, it would end a recording or a PROBE run in the middle — and "speed
 * 0" is not "parked for the day": a red light reads the same. So the swap waits for the one state
 * in which nothing is lost:
 *
 *   - a newer build is downloaded and waiting (hooks/useAppUpdate primes it);
 *   - the link has been down for a while, so a cable that blinks mid-drive does not count;
 *   - nothing on the screen is unsaved (MEMORY's own test of that);
 *   - no update is already running.
 *
 * Production never calls this: it makes no request of its own, so it never knows a build waits
 * (THIRD-PARTY-NOTICES.md §1). There a person presses RELOAD, as before.
 */
export const ADOPT_AFTER_DISCONNECTED_MS = 60_000;

/** What still holds a waiting build's swap, said on the screen and to the assistant. */
export type UpdateHold = 'link' | 'unsaved' | 'minute';

/**
 * Why a waiting build has not been taken yet: the cable is connected, something on the screen is
 * unsaved (it waits for MEMORY's save, for as long as that takes), or neither and the idle minute
 * is running. Before, only "waiting" was said, and with a fault read unsaved it waited forever while
 * the assistant told the driver it would go a minute after the cable was let go.
 */
export function updateHold(s: { linkState: string; unsaved: boolean }): UpdateHold {
    if (s.linkState !== 'disconnected') return 'link';
    return s.unsaved ? 'unsaved' : 'minute';
}

export function shouldAdoptBuild(s: {
    waiting: boolean;
    linkState: string;
    /** When the link was last seen go down, or null while it is up. */
    disconnectedSince: number | null;
    now: number;
    unsaved: boolean;
    updating: boolean;
}): boolean {
    if (!s.waiting || s.updating || s.unsaved) return false;
    if (s.linkState !== 'disconnected' || s.disconnectedSince === null) return false;
    return s.now - s.disconnectedSince >= ADOPT_AFTER_DISCONNECTED_MS;
}

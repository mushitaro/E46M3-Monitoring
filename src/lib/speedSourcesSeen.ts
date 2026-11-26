/**
 * The DMEs (not the MSS54) whose own speed job this device has seen above 0 km/h on a car (owner,
 * 2026-11-26, docs/NO-STOP.md D3). The link takes such a DME's 0 as stationary only once it has, so a
 * reading that never moves cannot open a parked-only run. Kept by module id; wrapped so a private
 * window or blocked storage only means the drive is needed again.
 */
export const SPEED_SOURCES_SEEN_KEY = 'monitoring.speedSourcesSeen';

export function readSpeedSourcesSeen(storage: Pick<Storage, 'getItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): string[] {
    try {
        const v = JSON.parse(storage?.getItem(SPEED_SOURCES_SEEN_KEY) ?? '[]') as unknown;
        return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
    } catch {
        return [];
    }
}

export function writeSpeedSourcesSeen(ids: readonly string[], storage: Pick<Storage, 'setItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): void {
    try {
        storage?.setItem(SPEED_SOURCES_SEEN_KEY, JSON.stringify([...new Set(ids)]));
    } catch {
        /* kept for this page only */
    }
}

/**
 * The head unit's settings, reached through the launcher (owner, 2026-11-09: "a button in the header
 * that goes straight to the head unit's Wi-Fi settings, and one to its clock settings").
 *
 * A web page cannot open Android's settings: Chrome launches only activities that declare themselves
 * BROWSABLE, and Settings does not. The launcher (E46M3-Launcher) does, from the version that says so
 * by putting `doors=settings` on the URL it opens a tool with — so a launcher without the door never
 * gets a button that does nothing. Read once, as the module loads; kept in memory only.
 */
import { useSyncExternalStore } from 'react';

export const LAUNCHER_PACKAGE = 'app.tsunagi.e46m3.launcher';

export type SettingsDoor = 'wifi' | 'datetime';

export const LAUNCHER_DOORS: ReadonlySet<string> =
    typeof location === 'undefined' ? new Set() : new Set((new URLSearchParams(location.search).get('doors') ?? '').split(',').filter(Boolean));

/** Whether the launcher that opened this page has the settings door. */
export const hasSettingsDoor = () => LAUNCHER_DOORS.has('settings');

const never = () => () => {};

/**
 * The same, for a component: false on the server and while hydrating, then the URL's answer. Read in
 * render directly, the page built on the server (no URL) and the head unit's first render (a URL with
 * `doors=settings`) disagreed, and the hydration that failed took the header's WORKS badge and AI
 * switch with it (2026-11-10, on the head unit).
 */
export function useSettingsDoor(): boolean {
    return useSyncExternalStore(never, hasSettingsDoor, () => false);
}

/** The link Chrome hands to the launcher's door, which opens that settings screen and steps aside. */
export function settingsDoorUrl(door: SettingsDoor): string {
    return `intent://settings/${door}#Intent;scheme=manifold;package=${LAUNCHER_PACKAGE};end`;
}

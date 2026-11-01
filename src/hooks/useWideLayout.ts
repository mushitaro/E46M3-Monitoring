'use client';

import { useSyncExternalStore } from 'react';

/**
 * Whether all three windows are on screen at once — the same 900px the layout splits at.
 *
 * Needed in JS, not just CSS, because below it LIST and VISU share one grid cell and the one that is
 * not up is only `invisible`: it stays laid out, and anything mounted inside it keeps doing its work
 * where nobody can see it. Here that is the datalog trace, which the shell tells whether its picture
 * is on screen (`pictureUp` in page.tsx). In TUNER, where this was written, it was 366,561 vertices
 * of WebGL surface rebuilt on every tab change behind a `visibility: hidden`.
 *
 * `useSyncExternalStore` rather than an effect + state so the first client render already has the
 * right answer instead of painting the wrong branch and correcting it. The server snapshot is
 * `true` — the wide layout is the one the markup has always described, and it renders nothing that
 * a narrow viewport then has to tear down.
 */
const WIDE = '(min-width: 900px)';

const subscriber = (query: string) => (onChange: () => void) => {
    const mq = window.matchMedia(query);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
};
/**
 * Short and on its side — a head unit (about 683x400 in CSS pixels), or a phone held landscape.
 *
 * Not a third reading of the width: it answers a different question, whether the menu sheet has the
 * height to stack its bands, and it is the query TUNER's sheet reads for it (tsunagi-m-design §6
 * `SHORT_LANDSCAPE`). 560 is where TUNER's and SMG2's picture floor already switches.
 */
const SHORT_LANDSCAPE = '(max-height: 560px) and (orientation: landscape)';

const subscribeWide = subscriber(WIDE);
const subscribeShortLandscape = subscriber(SHORT_LANDSCAPE);

export function useWideLayout(): boolean {
    return useSyncExternalStore(
        subscribeWide,
        () => window.matchMedia(WIDE).matches,
        () => true,
    );
}

/** Server snapshot `false`: the prerender describes the wide layout, and the stacked sheet is the
 *  arrangement a narrow-and-tall phone keeps. */
export function useShortLandscape(): boolean {
    return useSyncExternalStore(
        subscribeShortLandscape,
        () => window.matchMedia(SHORT_LANDSCAPE).matches,
        () => false,
    );
}

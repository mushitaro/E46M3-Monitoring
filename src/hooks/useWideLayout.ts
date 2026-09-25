'use client';

import { useSyncExternalStore } from 'react';

/**
 * Whether both panes are on screen at once — the same 900px the layout splits at.
 *
 * Needed in JS, not just CSS, because below it the two panes share one grid cell and the one that is
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

/**
 * Narrow enough for one pane at a time AND too short to stack the picture above the controls.
 *
 * This, not the width alone, is what makes GRAPH a pane of its own. The split settles a fight over
 * vertical pixels: at 851x393 DASH has 293px between the header and the footer, and the picture's
 * 140 on top of the panel's 220 is 360. Where the height is there, nothing is fighting — at 360x800
 * DASH has 700 and shows both — and splitting would cost a tap and buy nothing.
 *
 * 560px is not a new number: it is where TUNER's and SMG2's picture floor already switches.
 *
 * The same query is written out as Tailwind variants where CSS needs it (`SPLIT_ONLY_*` in
 * page.tsx). Keep them identical — a viewport that matches one and not the other lands on a pane
 * with nothing in it.
 */
const SPLIT = '(max-width: 899px) and (max-height: 560px)';

const subscriber = (query: string) => (onChange: () => void) => {
    const mq = window.matchMedia(query);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
};
const subscribeWide = subscriber(WIDE);
const subscribeSplit = subscriber(SPLIT);

export function useWideLayout(): boolean {
    return useSyncExternalStore(
        subscribeWide,
        () => window.matchMedia(WIDE).matches,
        () => true,
    );
}

/** Server snapshot `false` for the same reason `useWideLayout` is `true`: the prerender describes the
 *  wide layout, where the picture and the panel stack in one column, before anything is measured. */
export function useSplitGraph(): boolean {
    return useSyncExternalStore(
        subscribeSplit,
        () => window.matchMedia(SPLIT).matches,
        () => false,
    );
}

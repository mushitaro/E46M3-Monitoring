/**
 * The family's plain ///M silhouette (M ICON BASE), as a control glyph — the same mark m3's own M button wears.
 *
 * NOT the app icon: the launcher icon is M ICON `monitoring` (public/icons). Copied from TUNER
 * (E46M3CSL_TuningTool `src/components/MarkIcon.tsx`), which is the family's source for it
 * (tsunagi-m-mobile references/mobile-chrome.md §4): three parallelograms — bar 215 wide, gap 115,
 * leaning 370 across a height of 1068 — so the button that opens the app's own menu wears the
 * family's mark rather than a generic hamburger. Not the wordmark's tricolor `///` (MMark.tsx),
 * which is a name; this is a control. `currentColor`, so it takes the colour of whatever it sits in.
 */
export function MarkIcon({ className }: { className?: string }) {
    return (
        <svg viewBox="0 0 1245 1068" className={className} fill="currentColor" aria-hidden="true">
            <path d="M0,1068 L215,1068 L585,0 L370,0 Z" />
            <path d="M330,1068 L545,1068 L915,0 L700,0 Z" />
            <path d="M660,1068 L875,1068 L1245,0 L1030,0 Z" />
        </svg>
    );
}

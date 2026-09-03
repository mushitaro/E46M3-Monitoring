'use client';

import { TAB_ORDER, type Tab } from '@/lib/tabs';

/**
 * Five things in one cell, one of them visible.
 *
 * `Record<Tab, …>` is what makes this safe: a tab with no pane is a compile
 * error rather than an empty column. The inactive ones are `invisible`, which
 * keeps their scroll position and their search boxes AND takes them out of the
 * tab order — `opacity-0` would leave a hidden pane's buttons reachable by
 * keyboard, and `hidden` would throw the scroll away.
 *
 * `data-active` is what the Playwright suites select on: the predecessor's
 * `.viz-pane:not(.hidden)` said what a pane was NOT, which matched anything that
 * happened not to carry that class.
 */
export function Overlaid({
    active,
    panes,
    kind,
}: {
    active: Tab;
    panes: Record<Tab, React.ReactNode>;
    /** A pane scrolls and pads; a viz fills its region and does neither. */
    kind: 'pane' | 'viz';
}) {
    // pt-2 pb-2 px-4 is the scroll-content padding from the spacing scale, not
    // a free-hand value.
    const shape = kind === 'pane' ? 'min-h-0 overflow-auto px-4 pb-2 pt-2' : 'min-h-0 overflow-hidden';
    return (
        <div className={`grid min-h-0 flex-1 grid-cols-1 grid-rows-1 ${kind === 'viz' ? 'h-full' : ''}`}>
            {TAB_ORDER.map((id) => (
                <div
                    key={id}
                    id={`${kind}-${id}`}
                    role={kind === 'pane' ? 'tabpanel' : undefined}
                    data-active={active === id}
                    aria-hidden={active === id ? undefined : true}
                    className={`[grid-area:1/1] ${shape} ${active === id ? '' : 'invisible'}`}
                >
                    {panes[id]}
                </div>
            ))}
        </div>
    );
}

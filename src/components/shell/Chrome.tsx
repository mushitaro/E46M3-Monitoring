'use client';

import { Cpu } from 'lucide-react';
import { LABEL, TextButton } from '@/components/ui';
import type { LinkState } from '@/hooks/useDs2Link';
import type { EcuIndex } from '@tsunagi/monitoring-engine';
import { CHROME } from '@/lib/i18n/chrome';
import { ALL_MODULES } from '@tsunagi/monitoring-engine';
import { useLang } from '@/lib/i18n';
import { TAB_ORDER, type Tab } from '@/lib/tabs';

/**
 * The furniture around the views: the bars, the tab strip, the module row.
 *
 * It is here rather than in the shell file because none of it is a decision —
 * the shell's job is which pane is up and what the hub is, and 300 lines of
 * chrome around that made both hard to find. Nothing in this file holds state.
 */

/**
 * The bar recipe, once. Both columns open with one, at the same height, so
 * their bottom rules form a single line across the split.
 */
export const BAR =
    'flex h-[44px] flex-none items-center border-b border-slate-900 bg-slate-900/50 px-4 backdrop-blur-sm';

/**
 * Each tab's word, once — for the tab bar and for the M menu's VIEW band, so the
 * two layouts cannot come to call a view by two names.
 */
export function useTabLabels(): Record<Tab, string> {
    const { t } = useLang();
    return {
        diagnosis: t.tab_diagnosis,
        datalog: t.tab_datalog,
        adaptation: t.tab_adaptation,
        service: t.tab_service,
        actuator: t.tab_actuator,
        memory: t.tab_memory,
        startup: t.tab_startup,
        probe: t.tab_probe,
    };
}

/**
 * The tabs.
 *
 * The order comes from `lib/tabs`, not from JSX, so the bar and the pane map
 * cannot disagree about which tabs exist. The labels are looked up per tab
 * rather than listed beside them for the same reason.
 *
 * From 900px up only. Below it the views are the M menu's VIEW band, as in
 * TUNER, whose tab row is wide-only too: a second row of the same doors at the
 * top of LIST would be two ways to one job in one layout (tsunagi-m-ux §11),
 * and LIST gets the 44px back. The comms log that sits at this bar's right goes
 * to the footer's right-hand slot (LogPopover's `openUp`).
 *
 * One tab is lit, and it changes in the same frame as the pane under it. There is no colour
 * transition: with one, the tab being left kept a fading underline for its duration, and a screen
 * the assistant had just switched showed two underlines over one pane (UX-15, four shots — the
 * headless browser does not advance a transition until something paints). The pane switches
 * instantly (Overlaid), so its tab does too.
 */
export function TabBar({
    tab,
    enabled,
    onChange,
    children,
}: {
    tab: Tab;
    /** The tabs this build may render — `enabledTabs` from lib/features. The ORDER is still TAB_ORDER's. */
    enabled: ReadonlySet<Tab>;
    onChange: (next: Tab) => void;
    /** The tools that sit right of the rule — today, the comms log. */
    children?: React.ReactNode;
}) {
    const LABELS = useTabLabels();

    return (
        <nav role="tablist" className={`${BAR} z-30 max-[900px]:hidden`}>
            <div className="no-scrollbar mr-auto flex h-full min-w-0 flex-1 gap-6 overflow-x-auto overflow-y-hidden">
                {TAB_ORDER.filter((id) => enabled.has(id)).map((id) => (
                    <button
                        key={id}
                        role="tab"
                        aria-selected={tab === id}
                        aria-controls={`pane-${id}`}
                        onClick={() => onChange(id)}
                        className={`flex h-full shrink-0 items-center whitespace-nowrap border-b-2 ${LABEL} ${
                            tab === id
                                ? 'border-blue-400 text-blue-400'
                                : 'border-transparent text-slate-500 hover:text-slate-300'
                        }`}
                    >
                        {LABELS[id]}
                    </button>
                ))}
            </div>

            {/* Tools right, fenced with a vertical rule. The comms log is a
                popover and not a tab: it has to be reachable WHILE doing the
                thing that is failing, not somewhere you navigate away to. */}
            {children && (
                <div className="ml-4 flex h-full items-center border-l border-slate-800 pl-4">{children}</div>
            )}
        </nav>
    );
}

/**
 * The status row: what is being addressed on the left — the label and, beside
 * it, the module it names — and the link's controls at the right end. Centring a
 * lone chip left the panel with no anchor and no label.
 *
 * DISCONNECT lives HERE, not in the sub-action row, because this is the row that
 * states what you are talking to. It ends the session the row is describing,
 * which is a different kind of act from the row below — those act on the current
 * run and on the workspace.
 *
 * PRACTICE is not in this row any more. It used to sit at its right end while
 * disconnected and give its slot to the link's state on connect — so the one mark
 * that tells a practice run from a car left the screen at the moment it mattered
 * most (UX-03). It lives in the hub window's top-right now, in every link state
 * (PracticeCorner, tsunagi-m-ux §16), and the practice car's ENGINE behind it.
 *
 * ## What gives when the row is short
 *
 * The row stays one 32px line. Every slot in the control panel is reserved, and a
 * row that wrapped on connect would move the hub under the thumb that had just
 * pressed it. So when the width runs out, things yield sideways, in this order:
 *
 *   1. the word MODULE. Below 1280px the glyph says it, and the word stays in the
 *      accessibility tree. 1280 and not 900, because the row lives in the right
 *      column: 489px wide at 1280 but 344 at 900, less than a 360 phone gives
 *      it. At 1280 the word, the connected readout, DISCONNECT and the default
 *      module's whole name fit on one line; at 1024 the name kept 74 of the
 *      167px it needs;
 *   2. the chip's text, which truncates inside its own box (EcuSelect). It is the
 *      one thing here whose length is open-ended — 51 names, and the widest makes
 *      the select 297px — so it is the one that takes up a short row;
 *   3. nothing else. The link's phase and DISCONNECT are always whole.
 *
 * Below 900 on its side — the head unit, a phone held landscape — HUB stands
 * beside MAIN at φ, 261px wide at 683x400, and the one line would leave the chip
 * 9px. There the row is two lines in every state: the module on the first, the
 * phase and DISCONNECT at the right end of the second. Still one reserved height,
 * only a taller one; the query is page.tsx's NARROW_GRID.
 *
 * Before this, nothing yielded. The chip was pushed out past the column's edge
 * and clipped there: at 360x800 it ran to x=413, the row overflowed by 73px
 * disconnected and by 222 connected, and the control panel scrolled 53px
 * sideways. Connected, even 1440 lost the chip's last 12px.
 */
export function ModuleRow({
    index,
    ecuId,
    connected,
    state,
    onDisconnect,
    onChangeEcu,
    allowAll = false,
    all = false,
    hidden,
}: {
    index: EcuIndex | null;
    ecuId: string;
    connected: boolean;
    state: LinkState;
    onDisconnect: () => void;
    onChangeEcu: (id: string) => void;
    /** DIAGNOSIS offers ALL MODULES (`ALL_MODULES`) above the modules; the other tabs need one. */
    allowAll?: boolean;
    /** ALL MODULES is chosen. Shown only where it is offered. */
    all?: boolean;
    /** Modules this car ruled out at their address (its IDENT, or the owner): not offered. */
    hidden?: ReadonlySet<string>;
}) {
    const { t } = useLang();
    return (
        <div className="flex h-[32px] items-center gap-3 px-2 [@media(max-width:899px)_and_(orientation:landscape)]:h-16 [@media(max-width:899px)_and_(orientation:landscape)]:flex-wrap [@media(max-width:899px)_and_(orientation:landscape)]:gap-y-0">
            <div className="flex min-w-0 items-center gap-3 [@media(max-width:899px)_and_(orientation:landscape)]:h-8 [@media(max-width:899px)_and_(orientation:landscape)]:basis-full">
                <span className={`flex shrink-0 items-center gap-1.5 ${LABEL} text-slate-500`}>
                    <Cpu className="size-3" />
                    <span className="sr-only min-[1280px]:not-sr-only">{t.module}</span>
                </span>
                <EcuSelect index={index} value={all && allowAll ? ALL_MODULES : ecuId} module={ecuId} connected={connected} allowAll={allowAll} onChange={onChangeEcu} hidden={hidden} />
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-3 [@media(max-width:899px)_and_(orientation:landscape)]:h-8">
                {connected && (
                    <>
                        <LinkReadout state={state} />
                        <TextButton onClick={onDisconnect} tone="danger">
                            {t.disconnect}
                        </TextButton>
                    </>
                )}
            </div>
        </div>
    );
}

/**
 * Every phase the connected readout can print: all of LinkState except the one
 * this row never shows. A Record, so a new phase is a type error here, not a
 * readout one word too narrow.
 */
const LIVE_PHASES: Record<Exclude<LinkState, 'disconnected'>, true> = {
    connecting: true,
    connected: true,
    busy: true,
    logging: true,
};

/**
 * The phase, one word, as wide as the longest phase, whichever phase it shows.
 * The mode is not repeated here: PRACTICE says it in the hub's top-right corner,
 * in every link state (UX-03).
 *
 * Every phase is laid out in one grid cell and all but the current one are
 * invisible, as in Overlaid. Where the row is short the chip takes whatever is
 * left, so a readout that followed its word would slide DISCONNECT sideways
 * every time a read started or ended.
 */
function LinkReadout({ state }: { state: LinkState }) {
    return (
        <span className="grid shrink-0 font-mono text-[10px] uppercase leading-3 tracking-wider text-slate-600">
            <span className="grid">
                {(Object.keys(LIVE_PHASES) as LinkState[]).map((phase) => (
                    <span key={phase} className={`[grid-area:1/1] ${phase === state ? '' : 'invisible'}`}>
                        {phase}
                    </span>
                ))}
            </span>
        </span>
    );
}

/**
 * The module selector.
 *
 * Grouped, because a flat list of 51 is a list nobody reads to the end of. The group labels
 * and the fitment hints come out of the index itself rather than a table here: two modules can
 * share a DS2 address and differ only in which cars have them — 0x56 is ASCMK20 on an early
 * car and DSC_E46 on a later one, never both — so the hint is the only thing separating two
 * otherwise identical-looking rows, and a second copy of it here would be the copy that goes
 * stale.
 */
function EcuSelect({
    index,
    value,
    module,
    connected,
    allowAll,
    onChange,
    hidden,
}: {
    hidden?: ReadonlySet<string>;
    index: EcuIndex | null;
    /** What the select shows: a module id, or ALL_MODULES. */
    value: string;
    /** The module the link is for, whatever the select shows. */
    module: string;
    connected: boolean;
    allowAll: boolean;
    onChange: (id: string) => void;
}) {
    const { lang } = useLang();
    const pick = (o: { ja: string; en: string }) => (lang === 'en' ? o.en : o.ja);
    // The fitment hint is on the rows that NEED it — the ones sharing a DS2 address with
    // another module, where the name alone cannot tell them apart. Everywhere else it is
    // noise, and noise that costs: a native select shows the selected option in the closed
    // chip, and "MSS54 (S54 / E46 M3 Engine) — standard" overflowed max-w-52 by a measured
    // 1px, so the one module a user opens on was the one with a clipped label.
    const sharesAddress = new Set(
        (index?.modules ?? [])
            .map((e) => e.address)
            .filter((a, _i, all) => all.filter((b) => b === a).length > 1),
    );

    // No label inside the chip: the status row it sits in already says MODULE,
    // and printing it twice on one 32px line is the sort of thing that makes a
    // panel look unread.
    //
    // The module's name in the reader's language — the same word the ALL MODULES
    // list, the notice line and MEMORY use. It was English in both languages, on
    // the reasoning that `MSS54 (S54 / E46 M3 Engine)` is machine identity; but most
    // of the 52 are not designations — `Radio`, `CD changer`, `Convertible top
    // module` — and the selector called ラジオ "Radio" beside a list that called it
    // ラジオ: one module, two words (UX-24).
    //
    // `min-w-0` on the chip and the select, and `truncate`: this is what yields
    // when the row is short (ModuleRow). A select is as wide as its WIDEST
    // option, not the one it shows, so without them the chip held out for its
    // full 224px and was clipped at the column's edge instead. Now it shrinks and
    // the name ends in an ellipsis inside the chip.
    return (
        <div className="flex min-w-0 items-center rounded bg-slate-800 px-2 py-0.5">
            <select
                value={value}
                // Connected, the select still moves between ALL MODULES and the module the link was
                // opened for — the scan reaches every address on the one link — and nowhere else:
                // the DS2 address is per module, so another module under an open link would
                // silently retarget it.
                disabled={!index || index.modules.length === 0 || (connected && !allowAll)}
                onChange={(e) => onChange(e.target.value)}
                className="min-w-0 max-w-52 cursor-pointer truncate bg-transparent text-[10px] font-bold text-blue-400 outline-none disabled:cursor-not-allowed disabled:opacity-60"
            >
                {allowAll && (
                    <option value={ALL_MODULES} className="bg-slate-900 text-slate-300">
                        {CHROME.module_all}
                    </option>
                )}
                {(index?.groups ?? []).map((g) => {
                    const rows = (index?.modules ?? []).filter((e) => e.group === g.key && !hidden?.has(e.id));
                    if (rows.length === 0) return null;
                    return (
                        <optgroup key={g.key} label={pick(g)} className="bg-slate-900">
                            {rows.map((e) => (
                                <option key={e.id} value={e.id} disabled={connected && e.id !== module} className="bg-slate-900 text-slate-300">
                                    {lang === 'en' ? e.name_en || e.name : e.name || e.name_en}
                                    {sharesAddress.has(e.address) && index?.fit[e.fit]
                                        ? ` — ${pick(index.fit[e.fit])}` : ''}
                                </option>
                            ))}
                        </optgroup>
                    );
                })}
            </select>
        </div>
    );
}

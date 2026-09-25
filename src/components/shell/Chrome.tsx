'use client';

import { Cpu } from 'lucide-react';
import { LABEL, TextButton } from '@/components/ui';
import type { LinkMode, LinkState } from '@/hooks/useDs2Link';
import type { EcuIndex } from '@/lib/ecuCatalog';
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
 * The tabs.
 *
 * The order comes from `lib/tabs`, not from JSX, so the bar and the pane map
 * cannot disagree about which tabs exist. The labels are looked up per tab
 * rather than listed beside them for the same reason.
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
    const { t } = useLang();
    const LABELS: Record<Tab, string> = {
        diagnosis: t.tab_diagnosis,
        datalog: t.tab_datalog,
        adaptation: t.tab_adaptation,
        service: t.tab_service,
        actuator: t.tab_actuator,
        sessions: t.tab_sessions,
    };

    return (
        <nav role="tablist" className={`${BAR} z-30`}>
            <div className="no-scrollbar mr-auto flex h-full min-w-0 flex-1 gap-6 overflow-x-auto overflow-y-hidden">
                {TAB_ORDER.filter((id) => enabled.has(id)).map((id) => (
                    <button
                        key={id}
                        role="tab"
                        aria-selected={tab === id}
                        aria-controls={`pane-${id}`}
                        onClick={() => onChange(id)}
                        className={`flex h-full shrink-0 items-center whitespace-nowrap border-b-2 ${LABEL} transition-colors ${
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
 * The status row: what is being addressed on the left, its controls on the
 * right — the same shape as the reference app's DME row. Centring a lone chip
 * left the panel with no anchor and no label.
 *
 * DISCONNECT lives HERE, not in the sub-action row, because this is the row that
 * states what you are talking to. It ends the session the row is describing,
 * which is a different kind of act from the row below — those act on the current
 * run and on the workspace.
 *
 * It also takes the slot PRACTICE vacates. The mode cannot change under an open
 * link, so the checkbox has nothing left to say; leaving it there disabled spent
 * the only free space in a 32px row on a dead control.
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
 *   3. nothing else. PRACTICE, the mode and phase, and DISCONNECT are always
 *      whole: the mode is the one mark that tells a practice run from a car
 *      (tsunagi-m-ux §16).
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
    mode,
    state,
    practiceArmed,
    onPractice,
    onDisconnect,
    onChangeEcu,
}: {
    index: EcuIndex | null;
    ecuId: string;
    connected: boolean;
    mode: LinkMode;
    state: LinkState;
    practiceArmed: boolean;
    onPractice: (v: boolean) => void;
    onDisconnect: () => void;
    onChangeEcu: (id: string) => void;
}) {
    const { t } = useLang();
    return (
        <div className="flex h-[32px] items-center justify-between gap-3 px-2">
            <span className={`flex shrink-0 items-center gap-1.5 ${LABEL} text-slate-500`}>
                <Cpu className="size-3" />
                <span className="sr-only min-[1280px]:not-sr-only">{t.module}</span>
            </span>
            <div className="flex min-w-0 items-center gap-3">
                {!connected ? (
                    <PracticeToggle checked={practiceArmed} disabled={false} onChange={onPractice} />
                ) : (
                    <>
                        <LinkReadout mode={mode} state={state} />
                        <TextButton onClick={onDisconnect} tone="danger">
                            {t.disconnect}
                        </TextButton>
                    </>
                )}
                <EcuSelect
                    index={index}
                    value={ecuId}
                    // The DS2 address is per module, so switching one under an
                    // open link would silently retarget it.
                    disabled={connected}
                    onChange={onChangeEcu}
                />
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
 * Mode over phase, as wide as the longest phase, whichever phase it shows.
 *
 * Stacked, because side by side "PRACTICE · CONNECTING" is 137px, and with
 * DISCONNECT next to it a 360 phone's chip had room for its arrow and none of
 * its name. Two 12px lines fit inside the 32px row.
 *
 * Every phase is laid out in one grid cell and all but the current one are
 * invisible, as in Overlaid. Where the row is short the chip takes whatever is
 * left, so a readout that followed its word would slide DISCONNECT sideways
 * every time a read started or ended.
 */
function LinkReadout({ mode, state }: { mode: LinkMode; state: LinkState }) {
    return (
        <span className="grid shrink-0 font-mono text-[10px] uppercase leading-3 tracking-wider text-slate-600">
            <span>{mode}</span>
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
 * PRACTICE as a checkbox, not a second connect button.
 *
 * It is a MODE — which link the one CONNECT verb will open — and a button beside
 * CONNECT made it a fork with no stated default, so the app had two primary
 * actions and told you nothing about which one you were about to take. As a
 * checkbox the hub reads CONNECT either way and the box states which link you
 * get. It is a checkbox rather than a switch on purpose: a switch is for a mode
 * that changes what the app DOES to the car, and this changes whether there is a
 * car at all.
 *
 * Disabled once a session is open, because the session already IS one or the
 * other and a control that cannot take effect must not read as available.
 */
function PracticeToggle({
    checked,
    disabled,
    onChange,
}: {
    checked: boolean;
    disabled: boolean;
    onChange: (v: boolean) => void;
}) {
    const { t } = useLang();
    return (
        <label
            className={`flex shrink-0 items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider ${
                disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'
            } ${checked && !disabled ? 'text-indigo-400' : 'text-slate-500'}`}
            title={t.mode_practice}
        >
            <input
                type="checkbox"
                checked={checked}
                disabled={disabled}
                onChange={(e) => onChange(e.target.checked)}
                className="size-3 accent-indigo-500"
            />
            {t.practice}
        </label>
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
    disabled,
    onChange,
}: {
    index: EcuIndex | null;
    value: string;
    disabled: boolean;
    onChange: (id: string) => void;
}) {
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
    // English in both languages, so this takes no `lang`. `MSS54`, `SMG II` and
    // `DSC` are the ECUs' own designations and `S54 / E46 M3` is a chassis code —
    // the whole string is machine identity, not prose, and it sits in a row of
    // English chrome tokens (MODULE, PRACTICE) under English tabs. The Japanese
    // variant only ever translated the one common noun in it (エンジン / 変速機),
    // which bought nothing and broke the row's vocabulary.
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
                disabled={disabled || !index || index.modules.length === 0}
                onChange={(e) => onChange(e.target.value)}
                className="min-w-0 max-w-52 cursor-pointer truncate bg-transparent text-[10px] font-bold text-blue-400 outline-none disabled:cursor-not-allowed disabled:opacity-60"
            >
                {(index?.groups ?? []).map((g) => {
                    const rows = (index?.modules ?? []).filter((e) => e.group === g.key);
                    if (rows.length === 0) return null;
                    return (
                        <optgroup key={g.key} label={g.en} className="bg-slate-900">
                            {rows.map((e) => (
                                <option key={e.id} value={e.id} className="bg-slate-900 text-slate-300">
                                    {e.name_en || e.name}
                                    {sharesAddress.has(e.address) && index?.fit[e.fit]
                                        ? ` — ${index.fit[e.fit].en}` : ''}
                                </option>
                            ))}
                        </optgroup>
                    );
                })}
            </select>
        </div>
    );
}

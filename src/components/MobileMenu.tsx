'use client';

import { useEffect, useRef, useState } from 'react';
import { Download, Medal, RefreshCw, Shield, X } from 'lucide-react';
import { Field, LABEL } from './ui';
import type { LinkMode, LinkState } from '@/hooks/useDs2Link';
import type { InstallState } from '@/hooks/useInstallPrompt';
import { useShortLandscape } from '@/hooks/useWideLayout';
import { useBuildId } from '@/lib/build-variant';
import { useLang } from '@/lib/i18n';
import type { Tab } from '@/lib/tabs';
import { APP_VERSION } from '@/lib/version';

/**
 * The M menu: what this app keeps behind the footer's M button below 900px.
 *
 * Copied from TUNER (E46M3CSL_TuningTool `src/components/MobileMenu.tsx`, feat/develop), which is
 * the family's source for it — tsunagi-m-mobile references/mobile-chrome.md §5 says to copy it and
 * change only what the bands hold. Its reasons are TUNER's and are kept here in short; what differs
 * in this app is said where it differs.
 *
 * **Bands, outward from the thumb.** The sheet opens from the bottom centre, so VIEW is nearest it,
 * the readouts above that, and the header's links furthest away. Close sits on the spot the opening
 * press landed on. Press, slide up, release: one gesture, no second aim.
 *
 *   - The strip is the header's right-hand group, in its order (tsunagi-m-chrome §1): PRIVACY (the
 *     WORKS build only, as in the header) | CREDITS | RELOAD, then INSTALL, which has no desk twin
 *     because a desk does not install this. No GITHUB — the repository is private, so there is no
 *     page to open — and no GUIDE, which this app has no destination for. The family does not keep
 *     an empty slot for a link a tool lacks.
 *   - VEHICLE is the module being addressed and what it said its identity was: the header's IDENT
 *     and LEN, which the desk shows beside the wordmark.
 *   - SESSION is this connection's work: the link and its mode, and what a SAVE would hold (the
 *     fault read and the datalog). Readouts only. SAVE and SYNC are not repeated here as TUNER's
 *     cells are: in this app they are the SESSIONS view's own controls, with the one fact SYNC needs
 *     said beside it, and VIEW below reaches that view in one sweep — a second SAVE in the narrow
 *     layout would be two doors to one job (tsunagi-m-ux §11). Production has no sessions at all.
 *   - VIEW is the tab row, which below 900 is not drawn anywhere else.
 *
 * Deliberately NOT in here: anything that is sent to the car, and anything that connects. CONNECT,
 * CLEAR FAULTS, the actuator controls and DISCONNECT stay on DASH, one tap apart and visible
 * together (tsunagi-m-mobile §8). Changing VIEW releases an armed output first, exactly as the tab
 * row does — the shell's `changeTab` is what it calls.
 *
 * The one type change from TUNER: its 9px labels are this app's LABEL (10px). This repo's ramp has
 * no 9px step, and tools/check_ui_tokens.mjs refuses one.
 */
interface Props {
    onClose: () => void;
    /**
     * Where the press that opened this landed, while it is still down — so this mount can be the
     * middle of a drag rather than the end of a tap. The coordinates matter, not just the fact:
     * Close sits on the same spot as the button that opens the sheet, so a press that never moves
     * would otherwise release onto Close and shut what it just opened. Only a press that has
     * travelled counts as a sweep.
     */
    dragFrom?: { x: number; y: number } | null;
    /**
     * Clears `dragFrom`. Called from in here, not from the button that set it: the scrim goes up on
     * pointerdown and covers that button at once, so its own pointerup never fires and the drag
     * would stay armed after the finger had left — the next release anywhere would read as a pick.
     */
    onDragEnd?: () => void;
    tabs: { id: Tab; label: string; enabled: boolean }[];
    activeTab: Tab;
    /** Picks a view AND brings it up — the caller does both (tsunagi-m-mobile §3, trap 2). */
    onSelectTab: (id: Tab) => void;
    /** The selected module's name, or null until the module index has loaded. */
    module: string | null;
    ident: { hex: string; length: number } | null;
    mode: LinkMode;
    state: LinkState;
    /** Faults in the last read, or null if the fault memory has not been read. */
    faults: number | null;
    samples: number;
    /** The privacy policy's WORKS section, or null on a build that sends nothing (as in the header). */
    privacyUrl: string | null;
    onOpenCredits: () => void;
    /** Reloads into the newest build. The caller confirms first when something would be lost. */
    onReload: () => void;
    /** A reload has been asked for and is under way. Nothing clears it: the document is replaced. */
    reloading: boolean;
    /** Whether this device can take the app, and how. See hooks/useInstallPrompt. */
    installState: InstallState;
    onInstall: () => void;
}

/** The strip's controls — the header's group, drawn small. 40px is the target; the icons are 14px. */
const STRIP_ITEM =
    'w-10 h-10 [@media(max-height:560px)]:w-9 [@media(max-height:560px)]:h-9 flex items-center justify-center rounded transition-colors';

/** The breathing room inside a band. Halved on a short viewport, the only place the sheet is short of
 *  height — nothing here is a tap target, so nothing loses one. */
const BAND_BODY = 'px-4 pb-3 [@media(max-height:560px)]:pb-1.5';

/**
 * One column for every readout in the sheet: a stated width, not `w-fit`, so the VEHICLE block and
 * the SESSION block start at one x and the eye has a line to read down (tsunagi-m-mobile §12).
 */
const READOUT_COLUMN = 'w-[min(15rem,100%)] mx-auto';

/** A band and its heading. A plain child rather than `sticky`: each band holds its own height. */
function Band({
    title,
    className = 'shrink-0 border-b border-slate-800',
    children,
}: {
    title: string;
    className?: string;
    children: React.ReactNode;
}) {
    return (
        <div className={`flex flex-col ${className}`}>
            <h4 className={`shrink-0 px-4 pb-2 pt-3 text-center [@media(max-height:560px)]:pb-1 [@media(max-height:560px)]:pt-1.5 ${LABEL} text-slate-600`}>
                {title}
            </h4>
            {children}
        </div>
    );
}

/** One readout line. An em-dash when there is nothing to read, so the band keeps its height. */
function Readout({ label, value }: { label: string; value: string | null }) {
    return <Field column label={label} value={value ?? '—'} tone={value ? 'text-slate-300' : 'text-slate-600'} />;
}

/**
 * How wide the destination board is, from how many destinations there are: one column each up to
 * four, then four across. Production's five tabs are two rows of four or fewer; the WORKS build's
 * six likewise.
 */
const boardColumns = (count: number) => (count <= 4 ? Math.max(count, 1) : count <= 8 ? 4 : 5);

export function MobileMenu({
    onClose,
    dragFrom,
    onDragEnd,
    tabs,
    activeTab,
    onSelectTab,
    module,
    ident,
    mode,
    state,
    faults,
    samples,
    privacyUrl,
    onOpenCredits,
    onReload,
    reloading,
    installState,
    onInstall,
}: Props) {
    const { t } = useLang();
    const buildId = useBuildId();
    /**
     * Side by side rather than stacked — a head unit, or a phone on its side. Only the ARRANGEMENT
     * changes: the two readout bands become one row and VIEW's list becomes a board. Read through a
     * hook because a variant cannot restructure the DOM.
     */
    const wings = useShortLandscape();
    /** Which row the finger is over, keyed by `data-menu-key`. */
    const [hot, setHot] = useState<string | null>(null);

    useEffect(() => {
        if (!dragFrom) return;
        // 12px, about a millimetre of skin. Below it the press is a tap that happens to wobble.
        let moved = false;
        const travelled = (e: PointerEvent) =>
            moved || (moved = Math.hypot(e.clientX - dragFrom.x, e.clientY - dragFrom.y) > 12);
        // Hit-tested rather than tracked by listeners on each row: the press started on the footer's
        // button, which holds the implicit pointer capture, so the rows never see the moves.
        const at = (e: PointerEvent) => {
            const el = document.elementFromPoint(e.clientX, e.clientY);
            const row = el?.closest('[data-menu-key]') as HTMLElement | null;
            return row && row.dataset.menuDisabled !== 'true' ? row : null;
        };
        const move = (e: PointerEvent) => setHot(travelled(e) ? (at(e)?.dataset.menuKey ?? null) : null);
        const up = (e: PointerEvent) => {
            const row = travelled(e) ? at(e) : null;
            setHot(null);
            onDragEnd?.();
            // Clicking the row rather than looking its handler up: the row owns the handler for the
            // ordinary tap, and one way in means the two cannot drift apart. Released without
            // travelling, or off any row, leaves the sheet up to be read and tapped.
            row?.click();
        };
        // Named, so the cleanup can take it off: `{ once: true }` only removes a listener that fired.
        const cancel = () => {
            setHot(null);
            onDragEnd?.();
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up, { once: true });
        window.addEventListener('pointercancel', cancel, { once: true });
        return () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
            window.removeEventListener('pointercancel', cancel);
        };
    }, [dragFrom, onDragEnd]);

    /** Marks a row as sweep-selectable. The key is only for the highlight; the handler stays on the
     *  element, where the tap path reads it. */
    const row = (key: string, run: () => void, disabled = false) =>
        ({
            'data-menu-key': key,
            'data-menu-disabled': disabled ? 'true' : undefined,
            onClick: run,
            disabled,
        }) as const;

    const lit = (key: string) => (hot === key ? 'bg-slate-800' : '');

    /** VIEW opens at the end of its own scroll: the list is upside down, so the end is the first tab. */
    const tabScroller = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const el = tabScroller.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, []);

    /**
     * Ignore the dismissals for a moment after opening. On touch, letting go of the button that
     * opened this fires a compatibility `click` at the same coordinates a beat after `pointerup` —
     * and Close sits there by design, so press-and-release shut the sheet as it appeared.
     * `preventDefault` on the opening pointerdown does not reliably stop that click. Only Close and
     * the scrim wait: the sweep runs off pointerup and clicks its own row.
     */
    const [dismissable, setDismissable] = useState(false);
    useEffect(() => {
        const timer = setTimeout(() => setDismissable(true), 400);
        return () => clearTimeout(timer);
    }, []);
    const dismiss = () => {
        if (dismissable) onClose();
    };

    /** Every external destination opens in a new tab: a same-tab navigation drops the cable link and
     *  whatever has not been saved (lib/links). */
    const away = { target: '_blank', rel: 'noopener noreferrer' } as const;

    const linked = state !== 'disconnected';
    const install: Record<InstallState, string> = {
        ready: t.install_ready,
        ios: t.install_ios,
        dismissed: t.install_dismissed,
        unavailable: t.install_unavailable,
        installed: '',
    };

    return (
        <>
            {/* No backdrop-blur: on the screen this sheet exists for the sheet covers almost all of
                what it would blur, and on a phone the class costs about a second of paint
                (tsunagi-m-mobile §16.5). */}
            <div className="fixed inset-0 z-[90] bg-slate-950/70 min-[900px]:hidden" onClick={dismiss} />
            {/* Up from the bottom, from where the finger already is. Capped short of the full height so
                the scrim above stays visible — the way out has to be on screen. */}
            <div
                className={`fixed inset-x-0 bottom-0 z-[95] ${wings ? 'h-[95svh]' : 'max-h-[95svh]'} flex touch-none flex-col rounded-t-xl border-t border-slate-800 bg-slate-900 min-[900px]:hidden`}
            >
                {/* The backstop: everything above Close can scroll as a group, and Close never can. On
                    a portrait phone this never engages — the bands fit and VIEW takes the rest. It is
                    for the case where the arithmetic does not work at all, where a band you have to
                    scroll to is still better than a Close that is not on the screen. */}
                <div className="no-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">
                    {/* The header's group, as icons. Furthest from the thumb, and outside the sweep:
                        none of these carries `data-menu-key`, so a finger travelling up can cross the
                        strip and let go without opening a legal page or reloading. Do not add one. */}
                    <div className="shrink-0 border-b border-slate-800 px-4 pt-1.5">
                        {/* `1fr auto 1fr`, so CREDITS holds the sheet's centre line whatever the groups
                            either side weigh — PRIVACY and INSTALL come and go by build and device. */}
                        <div className="grid grid-cols-[1fr_auto_1fr] items-center">
                            <div className="flex items-center justify-end gap-1">
                                {wings && (
                                    <span className="mr-auto min-w-0 truncate font-mono text-[10px] text-slate-600">
                                        {buildStamp(buildId)}
                                    </span>
                                )}
                                {privacyUrl && (
                                    <a
                                        href={privacyUrl}
                                        {...away}
                                        title={t.privacy}
                                        aria-label={t.privacy}
                                        className={`${STRIP_ITEM} text-slate-600 hover:text-slate-300`}
                                    >
                                        <Shield className="size-3.5" />
                                    </a>
                                )}
                            </div>
                            {/* A medal, centred: the one control in the strip that is not a tool but an
                                acknowledgement — whose work this app stands on. */}
                            <button
                                type="button"
                                onClick={onOpenCredits}
                                title={t.credits_open}
                                aria-label={t.credits_open}
                                className={`${STRIP_ITEM} text-slate-500 hover:text-slate-300`}
                            >
                                <Medal className="size-4" />
                            </button>
                            <div className="flex items-center justify-start gap-1">
                                {/* Spinning while the newest build is fetched: that can take seconds,
                                    and without a sign of life it reads as a missed press. */}
                                <button
                                    type="button"
                                    onClick={reloading ? undefined : onReload}
                                    title={reloading ? t.reload_running : t.reload_title}
                                    aria-label={t.reload}
                                    className={`${STRIP_ITEM} ${reloading ? 'cursor-default text-blue-400' : 'text-slate-600 hover:text-slate-300'}`}
                                >
                                    <RefreshCw className={`size-3.5 ${reloading ? 'animate-spin' : ''}`} />
                                </button>
                                {/* The unavailable case is shown, not hidden: "I looked for install and
                                    found nothing" is the report this exists to answer. Gone only once
                                    the app is already installed. */}
                                {installState !== 'installed' && (
                                    <button
                                        type="button"
                                        onClick={installState === 'ready' ? onInstall : undefined}
                                        disabled={installState !== 'ready'}
                                        title={install[installState]}
                                        aria-label={t.install}
                                        className={`${STRIP_ITEM} ${
                                            installState === 'ready'
                                                ? 'text-emerald-400 hover:text-emerald-300'
                                                : 'cursor-default text-slate-700'
                                        }`}
                                    >
                                        <Download className="size-3.5" />
                                    </button>
                                )}
                            </div>
                        </div>
                        {/* Which build this phone is running — never acted on, but the first thing
                            asked when a device behaves unlike the desk, and a phone has no other way
                            to say it. Beside the strip instead on a short landscape screen. */}
                        {!wings && (
                            <p className="break-all pb-1 text-center font-mono text-[10px] leading-none text-slate-600">
                                {buildStamp(buildId)}
                            </p>
                        )}
                    </div>

                    {/* VEHICLE and SESSION: stacked on a phone, side by side where the height is not
                        there. `contents` makes the wrapper vanish in the stacked case. */}
                    <div className={wings ? 'grid shrink-0 grid-cols-2 border-b border-slate-800' : 'contents'}>
                        {/* Laid out to fit and never scrolled. Every field always drawn, so the band's
                            height does not move with what has been read. */}
                        <Band title={t.menu_vehicle} className={wings ? 'min-h-0' : undefined}>
                            <div className={BAND_BODY}>
                                <div className={READOUT_COLUMN}>
                                    <Readout label={t.module} value={module} />
                                    <Readout label={t.field_ident} value={ident?.hex ?? null} />
                                    <Readout label={t.field_len} value={ident ? String(ident.length) : null} />
                                </div>
                            </div>
                        </Band>

                        <Band title={t.menu_session} className={wings ? 'min-h-0 border-l border-slate-800' : undefined}>
                            <div className={BAND_BODY}>
                                <div className={READOUT_COLUMN}>
                                    <Readout label={t.field_link} value={linked ? `${mode} · ${state}` : null} />
                                    <Readout label={t.field_faults} value={faults === null ? null : String(faults)} />
                                    <Readout label={t.field_log} value={samples > 0 ? String(samples) : null} />
                                </div>
                            </div>
                        </Band>
                    </div>

                    {/* The only band that gives ground, and — stacked — the only one that scrolls. */}
                    <Band
                        title={t.menu_view}
                        className={wings ? 'min-h-0 flex-1' : 'min-h-[88px] flex-1 border-b border-slate-800'}
                    >
                        {wings ? (
                            /* The destinations as a board: on a head unit the sheet is short and wide,
                               and a list climbing away from the thumb had no height to climb. Rows are
                               `minmax(44px, 1fr)` — 44 is what a finger needs. Same `row()` as the
                               list, so press-slide-release still picks. */
                            <div
                                className="grid min-h-0 flex-1 gap-1.5 px-4 pb-2 [@media(max-height:560px)]:pb-1.5"
                                style={{
                                    gridTemplateColumns: `repeat(${boardColumns(tabs.length)}, minmax(0, 1fr))`,
                                    gridAutoRows: 'minmax(44px, 1fr)',
                                }}
                            >
                                {tabs.map((tab) => {
                                    const isActive = activeTab === tab.id;
                                    const isHot = hot === `tab:${tab.id}`;
                                    // Each decided once: two classes for one property are settled by
                                    // the order the compiler emitted them, not the order written here.
                                    const fill = isHot ? 'bg-slate-800' : tab.enabled ? 'bg-slate-800/40' : 'bg-transparent';
                                    const tone = isActive
                                        ? 'text-blue-400'
                                        : tab.enabled
                                          ? 'text-slate-400'
                                          : 'cursor-default text-slate-700';
                                    // The footer's 2px indicator, on the edge a footer-born sheet reads from.
                                    const edge = isActive ? 'border-blue-400' : 'border-transparent';
                                    return (
                                        <button
                                            key={tab.id}
                                            type="button"
                                            {...row(`tab:${tab.id}`, () => {
                                                onSelectTab(tab.id);
                                                onClose();
                                            }, !tab.enabled)}
                                            className={`flex items-center justify-center rounded border-t-2 px-1.5 text-center leading-tight transition-colors ${LABEL} ${fill} ${tone} ${edge}`}
                                        >
                                            {tab.label}
                                        </button>
                                    );
                                })}
                            </div>
                        ) : (
                            <div
                                ref={tabScroller}
                                className="no-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-2"
                            >
                                {/* The tab row, unrolled and turned upside down: the first tab sits
                                    closest to the button that opened this, and the list climbs away
                                    from the thumb. A disabled entry stays listed. */}
                                <div className="flex flex-col">
                                    {[...tabs].reverse().map((tab) => (
                                        <button
                                            key={tab.id}
                                            type="button"
                                            {...row(`tab:${tab.id}`, () => {
                                                onSelectTab(tab.id);
                                                onClose();
                                            }, !tab.enabled)}
                                            className={`-mx-2 flex min-h-[44px] items-center justify-center rounded px-2 py-3 text-center transition-colors ${LABEL} ${lit(`tab:${tab.id}`)} ${
                                                activeTab === tab.id
                                                    ? 'text-blue-400'
                                                    : tab.enabled
                                                      ? 'text-slate-400'
                                                      : 'cursor-default text-slate-700'
                                            }`}
                                        >
                                            {tab.label}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}
                    </Band>
                </div>

                {/* Close, on the spot the opening press landed on: same height and centre as the
                    footer's M button, so a second tap closes what the first opened.

                    53, not TUNER's 52: the row's 1px rule is inside its height, so at 52 the 52px
                    button overflowed a 51px content box and sat half a pixel low — its centre at
                    774.5 against M's 774 at 360x800, and its bottom 0.5px past the screen.
                    52 + 1 is the footer's own arithmetic (a 52px row under a 1px rule), so the two
                    now land on the same pixel. */}
                <div className="flex h-[53px] shrink-0 items-center justify-center border-t border-slate-800">
                    <button
                        type="button"
                        {...row('close', dismiss)}
                        aria-label={t.menu_close}
                        className={`flex h-[52px] w-[52px] cursor-pointer items-center justify-center rounded text-slate-400 hover:text-slate-200 ${lit('close')}`}
                    >
                        <X className="size-6" />
                    </button>
                </div>
            </div>
        </>
    );
}

/** The version, and the build stamp when there is one — a dev server is never stamped. */
function buildStamp(buildId: string): string {
    return buildId ? `${APP_VERSION} · ${buildId}` : APP_VERSION;
}

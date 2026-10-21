'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { Download, Terminal, Trash2, X } from 'lucide-react';
import { LABEL } from './ui';
import type { CommsLogLine } from '@/hooks/useDs2Link';
import { useLang } from '@/lib/i18n';

/**
 * The comms log as an on-demand popover, not a tab.
 *
 * It was a tab in my rebuild, which was wrong twice: it spent one of four tab
 * slots on a diagnostic, and it made the log something you navigate AWAY from
 * your work to read. The point of a comms log is that it is available while you
 * are doing the thing that is failing.
 *
 * Full-screen invisible backdrop to catch outside clicks, then an absolutely
 * positioned panel — the same idiom the modal uses, expressed as a sibling
 * rather than a wrapper.
 *
 * ## Two instances, one per layout
 *
 * From 900px up the trigger sits in the tab bar and the panel hangs below it.
 * Below 900 there is no tab bar — the views are the M menu's — so the trigger
 * is in the footer's right-hand slot, where the family puts the triggers of an
 * app's panels (tsunagi-m-mobile references/mobile-chrome.md §2), and it is
 * reachable from LIST and DASH alike. Hung off the bottom edge, `top-10` would
 * open the panel off the screen, so `openUp` pins it to the viewport above the
 * footer instead (tsunagi-m-mobile §13): `bottom-[60px]` is the 53px footer
 * and a gap, and `100svh - 72px` keeps a 12px gap at the top too. 420 is the
 * panel's height on the desk, kept where it fits: at 683x400 it is 328.
 *
 * Opened up, the panel and its backdrop are portalled together. The footer is a
 * z-30 flex item, which makes it a stacking context, so a panel left inside it
 * would sit under the portalled z-40 backdrop and every tap on it would close
 * it. The backdrop is tinted there, and closes on pointerDOWN: an invisible open
 * state on a phone looks like a frozen app, and the swipe that tries to scroll
 * should dismiss rather than be swallowed (tsunagi-m-mobile §13).
 */
export function LogPopover({
    log,
    onClear,
    onExport,
    openUp = false,
}: {
    log: CommsLogLine[];
    onClear: () => void;
    onExport: () => void;
    /** The footer's instance below 900px. */
    openUp?: boolean;
}) {
    const { t } = useLang();
    const [open, setOpen] = useState(false);
    const bodyRef = useRef<HTMLDivElement>(null);

    // Follow the tail while open. A log you have to scroll to see the newest
    // line of is a log you stop reading.
    useEffect(() => {
        if (open && bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }, [open, log.length]);

    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setOpen(false);
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open]);

    const errors = log.filter((l) => l.kind === 'error').length;

    const panel = (place: string) => (
        <div className={`${place} z-50 flex flex-col rounded-lg border border-slate-700 bg-slate-900 shadow-xl duration-200 animate-in fade-in zoom-in-95`}>
            <div className="flex h-[44px] shrink-0 items-center gap-3 border-b border-slate-800 px-4">
                <span className={`${LABEL} text-slate-400`}>
                    {t.tab_log}
                </span>
                <span className="font-mono text-[10px] text-slate-600">{log.length}</span>
                <span className="ml-auto flex items-center gap-4">
                    <button
                        type="button"
                        onClick={onExport}
                        disabled={log.length === 0}
                        title={t.exportLog}
                        className="text-slate-500 transition-colors hover:text-blue-400 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:text-slate-500"
                    >
                        <Download className="size-3.5" />
                    </button>
                    <button
                        type="button"
                        onClick={onClear}
                        disabled={log.length === 0}
                        title={t.clearLog}
                        // Muted below its harmless neighbour: danger
                        // shouldn't shout until you reach for it, and
                        // at the same brightness nothing separates
                        // "save this" from "destroy this".
                        className="text-slate-600 transition-colors hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:text-slate-600"
                    >
                        <Trash2 className="size-3.5" />
                    </button>
                    <button
                        type="button"
                        onClick={() => setOpen(false)}
                        className="text-slate-500 transition-colors hover:text-slate-300"
                    >
                        <X className="size-3.5" />
                    </button>
                </span>
            </div>

            <div ref={bodyRef} className="min-h-0 flex-1 overflow-auto px-4 py-3">
                {log.length === 0 ? (
                    <p className="text-[11px] text-slate-600">—</p>
                ) : (
                    <pre className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed">
                        {log.map((l, i) => (
                            <div key={i} className={LINE[l.kind]}>
                                <span className="text-slate-600">
                                    {new Date(l.t).toLocaleTimeString(undefined, { hour12: false })}{' '}
                                </span>
                                {l.text}
                            </div>
                        ))}
                    </pre>
                )}
            </div>
        </div>
    );

    return (
        <div className="relative">
            <button
                type="button"
                onClick={() => setOpen(!open)}
                title={t.tab_log}
                aria-expanded={open}
                className={`relative rounded p-2 text-slate-400 transition-colors hover:text-blue-400 ${
                    open ? 'bg-slate-800 text-blue-400' : 'hover:bg-slate-800'
                }`}
            >
                <Terminal className="size-4" />
                {/* A count, not a dot: "3 errors" is actionable, a dot is not. */}
                {errors > 0 && (
                    <span className="absolute right-0 top-0 min-w-3 rounded-full bg-red-500 px-1 text-center font-mono text-[10px] leading-3 text-red-100">
                        {errors}
                    </span>
                )}
            </button>

            {open &&
                (openUp ? (
                    <Portal>
                        <div className="fixed inset-0 z-40 bg-slate-950/60" onPointerDown={() => setOpen(false)} />
                        {panel('fixed inset-x-3 bottom-[60px] h-[min(calc(100svh-72px),420px)]')}
                    </Portal>
                ) : (
                    <>
                        <Portal>
                            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
                        </Portal>
                        {panel('absolute right-0 top-10 h-[420px] w-[min(560px,90vw)]')}
                    </>
                ))}
        </div>
    );
}

/**
 * Portalled to the body: the click-outside catcher always, and the panel too
 * when it opens up.
 *
 * The catcher cannot be a plain child. On the desk this popover's trigger lives
 * in the 44px bar, and the bar carries `backdrop-blur-sm` — a backdrop-filter
 * makes an element a containing block for its `position: fixed` descendants, so
 * `fixed inset-0` resolved against the bar instead of the viewport. Measured:
 * the "full-screen" backdrop was 926x43. Click-outside-to-dismiss only ever
 * worked if you clicked inside the tab bar; everywhere else the click fell
 * through to whatever was under it — including the hub, so trying to close the
 * log could drop the link.
 *
 * The desk's panel stays in place: it is `absolute` against its own `relative`
 * wrapper, which is the behaviour we want, and the bar's z-30 already carries it
 * over the right column's z-20. The footer's panel cannot (see LogPopover).
 */
function Portal({ children }: { children: React.ReactNode }) {
    const mounted = useSyncExternalStore(
        () => () => {},
        () => true,
        () => false,
    );
    if (!mounted) return null;
    return createPortal(children, document.body);
}

const LINE: Record<CommsLogLine['kind'], string> = {
    error: 'text-red-400',
    warn: 'text-amber-400',
    tx: 'text-blue-400',
    rx: 'text-slate-300',
    info: 'text-slate-500',
};

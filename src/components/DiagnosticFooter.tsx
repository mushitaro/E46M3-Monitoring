'use client';

import type { ComponentProps } from 'react';
import { LogPopover } from './LogPopover';
import { MarkIcon } from './MarkIcon';
import { LABEL } from './ui';
import { useLang } from '../lib/i18n';

/** The narrow WORKS instrument footer. The host supplies its pane IDs and the current connection. */
export function DiagnosticFooter({ pane, setPane, listId, visuId, menuOpen, openMenu, log, onClear, onExport }: {
    pane: 'list' | 'visu'; setPane(pane: 'list' | 'visu'): void; listId: string; visuId: string;
    menuOpen: boolean; openMenu(from: { x: number; y: number } | null): void;
} & Pick<ComponentProps<typeof LogPopover>, 'log' | 'onClear' | 'onExport'>) {
    const { t } = useLang();
    return (
        <div className="z-30 flex-none border-t border-slate-900 bg-slate-950/80 min-[900px]:hidden">
            <div className="relative flex h-[52px] items-center px-4">
                {/* Dressed as the tab row — same label, same 2px indicator — with the
                    indicator on TOP, on the button itself: the bottom edge is the screen's.

                    The `after:` box is the hit area. With the indicator on the button, the
                    button is as wide as its word, so it is widened by an invisible box 12px
                    either side rather than by padding, which would widen the indicator too.
                    12 is half the 24px gap, so neighbours meet and do not overlap. */}
                <div className="flex h-full shrink-0 space-x-6">
                    {(
                        [
                            ['list', t.pane_list, listId],
                            ['visu', t.pane_visu, visuId],
                        ] as const
                    ).map(([id, label, controls]) => (
                        <button
                            key={id}
                            type="button"
                            aria-pressed={pane === id}
                            aria-controls={controls}
                            onClick={() => setPane(id)}
                            className={`relative flex h-full shrink-0 items-center whitespace-nowrap border-t-2 after:absolute after:-inset-x-3 after:inset-y-0 ${LABEL} transition-colors ${
                                pane === id ? 'border-blue-400 text-blue-400' : 'border-transparent text-slate-500 hover:text-slate-300'
                            }`}
                        >
                            {label}
                        </button>
                    ))}
                </div>

                {/* The M button. Centred absolutely rather than by flex order, so it stays on
                    the screen's centre line whatever the groups either side weigh: it is reached
                    for without looking. It opens on pointerDOWN, not click, so the same press can
                    carry on into the sheet and pick a row on the way back up; `touch-none` stops
                    the browser claiming that press as a scroll first. The release is not handled
                    here: the sheet's scrim covers this button on this very pointerdown, so its
                    own pointerup never arrives — the sheet ends the drag from the window. */}
                <button
                    type="button"
                    onPointerDown={(e) => {
                        e.preventDefault();
                        openMenu({ x: e.clientX, y: e.clientY });
                    }}
                    aria-label={t.menu_open}
                    onClick={e => { if (e.detail === 0) openMenu(null); }}
                    aria-expanded={menuOpen}
                    className="absolute left-1/2 top-0 z-10 flex h-[52px] w-[52px] -translate-x-1/2 cursor-pointer touch-none items-center justify-center text-slate-400 hover:text-slate-200"
                >
                    <MarkIcon className="h-7 w-8" />
                </button>

                {/* The triggers of this app's panels, opening up: the comms log, which the desk
                    keeps at the tab bar's right. `ml-auto` holds the box at the right edge
                    whatever it holds. */}
                <div className="ml-auto flex items-center gap-2">
                    <LogPopover
                        log={log}
                        onClear={onClear}
                        onExport={onExport}
                        openUp
                    />
                </div>
            </div>
        </div>
    );
}

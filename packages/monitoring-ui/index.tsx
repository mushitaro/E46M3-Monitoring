'use client';

import type { ReactNode } from 'react';
import { Lock } from 'lucide-react';
import { TAB_ORDER, type Mode, type Tab } from './tabs.ts';
export * from './tabs.ts';
const BAR = 'flex h-[44px] flex-none items-center border-b border-slate-900 bg-slate-900/50 px-4 backdrop-blur-sm';
const LABEL = 'text-[10px] font-bold uppercase tracking-widest';
const HUB_LABEL = 'text-[8px] font-bold uppercase tracking-widest';

export function MonitoringTabBar({
    labels, tab,
    enabled,
    onChange,
    children,
}: {
    labels: Record<Tab, string>;
    tab: Tab;
    /** The tabs this build may render — `enabledTabs` from lib/features. The ORDER is still TAB_ORDER's. */
    enabled: ReadonlySet<Tab>;
    onChange: (next: Tab) => void;
    /** The tools that sit right of the rule — today, the comms log. */
    children?: ReactNode;
}) {

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
                        className={`flex h-full shrink-0 items-center whitespace-nowrap border-b-2 ${LABEL} transition-colors ${
                            tab === id
                                ? 'border-blue-400 text-blue-400'
                                : 'border-transparent text-slate-500 hover:text-slate-300'
                        }`}
                    >
                        {labels[id]}
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

const MODES: readonly Mode[] = ['manual', 'probe'];

/**
 * MODE — MANUAL or PROBE, in HUB's bottom-left corner (operator, 2026-11-02): TUNER's MODE corner,
 * in the same place and the same small type, so the two apps qualify their hub the same way.
 *
 * Two words rather than TUNER's sheet: with two modes, both are the choice, and a tap on the other
 * one is the whole of switching. Either can be chosen at any time — a mode is the screen's, not a
 * session's — so nothing here locks for a recording or a run.
 *
 * PROBE is the assistant's mode, and from the screen it is chosen only with AI on (`probeLocked`).
 * The lock is drawn, not hidden behind a hover: pressed, the shell says why in the notice line.
 * The assistant switches to it itself when it places a part or opens a session.
 */
export function MonitoringModeCorner({ mode, onChange, probeLocked, t }: { t: { mode_corner: string; mode_manual: string; mode_probe: string }; mode: Mode; onChange: (m: Mode) => void; probeLocked: boolean }) {
    return (
        <div className="flex h-7 flex-none items-center gap-3" role="group" aria-label={t.mode_corner}>
            <span className={`${HUB_LABEL} ${mode === 'manual' ? 'text-slate-600' : 'text-blue-400'}`}>{t.mode_corner}</span>
            {MODES.map((m) => (
                <button
                    key={m}
                    type="button"
                    data-mode={m}
                    onClick={() => onChange(m)}
                    aria-pressed={mode === m}
                    className={`-my-3 inline-flex items-center gap-1 py-3 font-mono text-[10px] uppercase tracking-wider transition-colors ${
                        mode === m ? 'text-blue-400' : 'text-slate-500 hover:text-slate-300'
                    }`}
                >
                    {m === 'manual' ? t.mode_manual : t.mode_probe}
                    {m === 'probe' && probeLocked && mode !== 'probe' && <Lock className="size-2.5 text-slate-700" />}
                </button>
            ))}
        </div>
    );
}

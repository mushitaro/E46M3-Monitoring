'use client';

import { useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { useLang } from '@/lib/i18n';

/**
 * PRACTICE — the hub window's top-right corner, in every link state (tsunagi-m-ux §16, UX-03).
 *
 * It used to live at the right end of the status row while disconnected and give its slot to the
 * link's state on connect, so the one mark that tells a practice run from a car left the screen at the
 * moment it mattered most. Here it stays where it is: ticked or not, connected or not. Under an open
 * link it cannot change (the session already IS one or the other), so it is locked — drawn, not
 * hidden — and its tick says which link is open, not what was ticked before.
 *
 * A checkbox, not a switch: it states what the next CONNECT opens, it sends nothing.
 *
 * The practice car's ENGINE is behind it (the slider glyph), not beside it as a second checkbox in
 * the same mode-mark dress: it is a setting of the practice car, not a mode of the app, so it is
 * shown only while PRACTICE is ticked, and only when asked for.
 */
export function PracticeCorner({
    checked,
    locked,
    onChange,
    engine,
}: {
    /** Ticked: what the next CONNECT opens, or the link that is open. */
    checked: boolean;
    /** A link is open: the mode cannot change under it. */
    locked: boolean;
    onChange: (v: boolean) => void;
    /** The practice car's engine, running or stopped: what a job asking for the engine off or on is practised against. */
    engine?: { running: boolean; onChange: (v: boolean) => void };
}) {
    const { t } = useLang();
    const [open, setOpen] = useState(false);
    const car = checked && engine;
    return (
        // One 16px line, in the panel's top padding: it adds no height to a panel whose every slot is
        // reserved. The practice car's ENGINE opens to its left, on the same line.
        <div className="flex h-4 items-center gap-3">
            {car && open && (
                <label
                    id="practice-car"
                    className={`flex shrink-0 cursor-pointer items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider ${engine.running ? 'text-slate-300' : 'text-slate-500'}`}
                    title={t.practice_engine_title}
                >
                    <input type="checkbox" checked={engine.running} onChange={(e) => engine.onChange(e.target.checked)} className="size-3 accent-indigo-500" />
                    {t.practice_engine}
                </label>
            )}
            <label
                className={`flex shrink-0 items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider ${
                    locked ? 'cursor-not-allowed' : 'cursor-pointer'
                } ${checked ? 'text-indigo-400' : 'text-slate-500'}`}
                title={t.mode_practice}
            >
                {/* Locked, not `disabled`: a disabled box is painted grey, and the tick that says a
                    practice link is open would read as no tick at all. */}
                <input
                    type="checkbox"
                    checked={checked}
                    aria-disabled={locked}
                    onChange={(e) => {
                        if (!locked) onChange(e.target.checked);
                    }}
                    className={`size-3 accent-indigo-500 ${locked ? 'pointer-events-none opacity-70' : ''}`}
                />
                {t.practice}
            </label>
            {/* Reserved: the door to the practice car keeps its width whether or not it is drawn. */}
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                aria-expanded={open}
                aria-controls="practice-car"
                aria-label={t.practice_car}
                title={t.practice_car}
                disabled={!car}
                className={`-m-2 p-2 text-slate-500 transition-colors hover:text-slate-300 ${car ? '' : 'invisible'}`}
            >
                <SlidersHorizontal className="size-3" />
            </button>
        </div>
    );
}

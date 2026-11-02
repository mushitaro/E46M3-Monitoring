'use client';

import { Lock } from 'lucide-react';
import { HUB_LABEL } from '@/components/ui';
import { useLang } from '@/lib/i18n';
import type { Mode } from '@/lib/tabs';

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
export function ModeCorner({ mode, onChange, probeLocked }: { mode: Mode; onChange: (m: Mode) => void; probeLocked: boolean }) {
    const { t } = useLang();
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

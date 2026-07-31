'use client';

import { useEffect } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { useLang } from '@/lib/i18n';

/**
 * What software cannot fix.
 *
 * The whole point of classifying an echo mismatch is that the two kinds need
 * OPPOSITE advice. A corruption that is exclusively 1→0 with a held-low tail is
 * something pulling the line down while we transmit — no settle duration, retry
 * count or drain policy prevents it. So when the classifier says `electrical`
 * the app offers this instead of RETRY, because retry is the one action that
 * cannot work and a mitigation must not imply it might.
 *
 * ## Why this is a dialog and not a strip
 *
 * It used to render inline between the app header and the columns. `main` is
 * `flex-1`, so the five-step checklist took ~200px off the whole workspace: both
 * columns lost that height, the 38.2% split was recomputed on a shorter box, the
 * visualization visibly shrank, and the hub slid up under the pointer at the
 * exact moment the user reached for the button. A reserved slot has to be a
 * CONSTANT height and a checklist is not one — so the condition goes in the
 * control panel's 14px notice line, and the detail opens over the top, changing
 * nothing underneath.
 */
export function ElectricalFaultDialog({ message, onClose }: { message: string; onClose: () => void }) {
    const { t } = useLang();

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    return (
        <>
            <div className="fixed inset-0 z-40 bg-slate-950/70 backdrop-blur-sm" onClick={onClose} />
            <div
                role="dialog"
                aria-modal="true"
                aria-label={t.error_electrical_title}
                className="fixed left-1/2 top-1/2 z-50 flex max-h-[80vh] w-[560px] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-slate-700 bg-slate-900 p-4 shadow-xl duration-200 animate-in fade-in zoom-in-95"
            >
                <div className="mb-4 flex shrink-0 items-center gap-2 border-b border-slate-800 pb-2">
                    <AlertTriangle className="size-4 shrink-0 text-red-400" />
                    <h3 className="text-xs font-bold uppercase tracking-widest text-slate-300">
                        {t.error_electrical_title}
                    </h3>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label={t.cancel}
                        className="ml-auto shrink-0 text-slate-500 transition-colors hover:text-slate-300"
                    >
                        <X className="size-4" />
                    </button>
                </div>

                <div className="min-h-0 flex-1 overflow-auto">
                    <p className="text-xs text-slate-400">{t.error_electrical_body}</p>
                    {/* The steps come from the copy module, not from ds2-core's
                        ELECTRICAL_FAULT_CHECKLIST. That constant stays the
                        English source of truth for logs; rendering it here put
                        five English sentences under a Japanese heading on the one
                        screen whose whole job is to stop an afternoon of futile
                        retries. Ordered cheapest-discriminator-first. */}
                    <ol className="mt-3 list-decimal space-y-2 pl-5 text-xs text-slate-400">
                        {t.error_electrical_steps.map((step) => (
                            <li key={step}>{step}</li>
                        ))}
                    </ol>
                    {message && (
                        <p className="mt-4 break-words border-t border-slate-800 pt-3 font-mono text-[11px] text-slate-600">
                            {message}
                        </p>
                    )}
                </div>
            </div>
        </>
    );
}

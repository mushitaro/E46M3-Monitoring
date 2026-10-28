'use client';

import { AlertTriangle } from 'lucide-react';
import { DialogFrame } from '@/components/DialogFrame';
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
 *
 * In the shared frame (DialogFrame): it asks nothing, so the X and Escape close it.
 */
export function ElectricalFaultDialog({ message, onClose }: { message: string; onClose: () => void }) {
    const { t } = useLang();
    return (
        <DialogFrame title={t.error_electrical_title} Icon={AlertTriangle} tone="danger" onClose={onClose}>
            <p className="text-xs leading-relaxed text-slate-300">{t.error_electrical_body}</p>
            {/* The steps come from the copy module, not from ds2-core's
                ELECTRICAL_FAULT_CHECKLIST. That constant stays the
                English source of truth for logs; rendering it here put
                five English sentences under a Japanese heading on the one
                screen whose whole job is to stop an afternoon of futile
                retries. Ordered cheapest-discriminator-first. */}
            <ol className="mt-3 list-decimal space-y-2 pl-5 text-xs leading-relaxed text-slate-300">
                {t.error_electrical_steps.map((step) => (
                    <li key={step}>{step}</li>
                ))}
            </ol>
            {message && (
                <p className="mt-4 break-words border-t border-slate-800 pt-3 font-mono text-[11px] text-slate-600">
                    {message}
                </p>
            )}
        </DialogFrame>
    );
}

'use client';

import { ShieldAlert } from 'lucide-react';
import { DialogFrame } from '@/components/DialogFrame';
import { TextButton, emphasise } from '@/components/ui';
import { useLang } from '@/lib/i18n';

/**
 * What this tool is, said once, with one way out.
 *
 * ## One exit
 *
 * No `onClose` is passed. That is not an omission — `DialogFrame`'s contract is
 * that a dialog without one cannot be dismissed by Escape or by the backdrop,
 * so AGREE is the only way forward and nobody can add a second exit without
 * adding a prop. The other dialogs in this app ask you to decide something and
 * take CANCEL for an answer; this one is not a decision.
 *
 * ## What is NOT in here
 *
 * The attribution. Credits go in their own dialog, reachable from the header,
 * because an acknowledgement that is shown once and then remembered is the worst
 * possible home for a statement that must remain available — the moment it is
 * acknowledged, the attribution would be gone from the app.
 *
 * Nor is there a "do not show this again" checkbox. There is nothing to opt out
 * of: agreeing IS the opt-out, and it lasts until the text says something
 * materially different. `lib/disclaimer` holds that rule and the version it
 * turns on.
 *
 * ## Why the copy is a list of four
 *
 * Each line is a thing the app actually does, stated so it can be checked
 * against the app rather than believed: reads only with one named exception,
 * unconfirmed things labelled and refused, PRACTICE talking to a simulator, and
 * the car itself still being dangerous. A paragraph of general caution would be
 * shorter and would say nothing a reader could verify.
 */
export function DisclaimerDialog({ onAgree }: { onAgree: () => void }) {
    const { t } = useLang();

    return (
        <DialogFrame
            title={t.disclaimer_title}
            Icon={ShieldAlert}
            footer={
                <TextButton onClick={onAgree} tone="primary">
                    {t.disclaimer_agree}
                </TextButton>
            }
        >
            <p className="text-xs leading-relaxed text-slate-300">{emphasise(t.disclaimer_lede)}</p>
            <ul className="mt-4 space-y-2.5">
                {t.disclaimer_points.map((point) => (
                    <li key={point} className="flex gap-2.5 text-[11px] leading-relaxed text-slate-400">
                        <span aria-hidden className="mt-1.5 size-1 shrink-0 rounded-full bg-slate-600" />
                        <span>{emphasise(point)}</span>
                    </li>
                ))}
            </ul>
        </DialogFrame>
    );
}

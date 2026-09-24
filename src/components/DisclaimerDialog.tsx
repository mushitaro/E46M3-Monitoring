'use client';

import { ExternalLink, ShieldAlert } from 'lucide-react';
import { DialogFrame } from '@/components/DialogFrame';
import { MicroLabel, TextButton, emphasise } from '@/components/ui';
import { useLang, type Localised } from '@/lib/i18n';
import { PRIVACY_PREVIEW } from '@/lib/links';

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
 *
 * ## The preview adds what it sends
 *
 * `preview` is the branded build's bit (page.tsx), and with it the same dialog
 * carries one more section — `PreviewNotice`, below the points — and AGREE
 * records that too (`lib/previewNotice`). Without it the dialog is exactly what
 * it was before the preview existed; `DisclaimerDialog.test.ts` pins that
 * markup. One dialog rather than a second one after it: the owner reads what the
 * tool is and what this build sends in one place, and answers once.
 *
 * The preview's card is 560px, the ///M modal width, where production keeps
 * DialogFrame's 448: the notice more than doubles the text. Measured at
 * 1280×860, at 448 the card hit the window's height with the policy link below
 * the fold; at 560 the whole of it fits.
 */
export function DisclaimerDialog({ onAgree, preview = false }: { onAgree: () => void; preview?: boolean }) {
    const { lang, t } = useLang();

    return (
        <DialogFrame
            title={t.disclaimer_title}
            Icon={ShieldAlert}
            width={preview ? 'max-w-[560px]' : undefined}
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
            {preview && <PreviewNotice copy={t.disclaimer_preview} policyHref={PRIVACY_PREVIEW[lang]} />}
        </DialogFrame>
    );
}

/**
 * What this preview sends, when, what for, who can see it, and how it goes away —
 * in front of the owner before the first of it leaves the device.
 *
 * m3 used to show this on a page of its own (/preview-notice) on the way in; it
 * is here now because the operator decided the confirmation belongs in the app
 * (2026-09-24). The copy is m3's, verbatim (`disclaimer_preview` in the
 * catalog), in m3's order: what is sent, then its purpose, where it is kept and
 * how to delete it, then the policy that says all of it at length.
 *
 * A rule above it, and nothing around it: the section is the second half of one
 * dialog, not a card inside it. The link opens a new tab, like every link out of
 * this app — a same-tab navigation would drop the cable and anything unsaved.
 */
export function PreviewNotice({ copy: n, policyHref }: { copy: Localised['disclaimer_preview']; policyHref: string }) {
    return (
        <section className="mt-4 border-t border-slate-800 pt-4">
            <p className="text-xs leading-relaxed text-slate-300">{n.lead}</p>
            <div className="mt-3 space-y-2.5">
                <Sent title={n.sessionsTitle} what={n.sessions} when={n.sessionsWhen} />
                <Sent title={n.recordsTitle} what={n.records} when={n.recordsWhen} />
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-slate-500">{n.alsoSent}</p>
            <div className="mt-3 space-y-2">
                {(
                    [
                        [n.purposeTitle, n.purpose],
                        [n.whereTitle, n.where],
                        [n.deleteTitle, n.deleteBody],
                    ] as const
                ).map(([title, body]) => (
                    <div key={title}>
                        <MicroLabel>{title}</MicroLabel>
                        <p className="mt-0.5 text-[11px] leading-relaxed text-slate-400">{body}</p>
                    </div>
                ))}
            </div>
            <a
                href={policyHref}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-blue-400 transition-colors hover:text-blue-300"
            >
                <ExternalLink className="size-3 shrink-0" />
                {n.policy}
            </a>
        </section>
    );
}

/** One kind of thing that is sent: its name, what it holds, and when it goes. */
function Sent({ title, what, when }: { title: string; what: string; when: string }) {
    return (
        <div>
            <MicroLabel>{title}</MicroLabel>
            <p className="mt-0.5 text-[11px] leading-relaxed text-slate-300">{what}</p>
            <p className="text-[11px] leading-relaxed text-slate-500">{when}</p>
        </div>
    );
}

'use client';

import { useState } from 'react';
import { AlertTriangle, Check } from 'lucide-react';
import { DialogFrame } from '@/components/DialogFrame';
import { DialogButton, emphasise } from '@/components/ui';
import { useLang, type Localised } from '@/lib/i18n';
import { PRIVACY_PREVIEW } from '@/lib/links';

/**
 * What this tool is, said once, with one way out.
 *
 * ## The family's disclaimer
 *
 * TUNER's (`DisclaimerDialog.tsx`), part for part, so the gate into either tool
 * is the same object (tsunagi-m-ux §6): the shared frame with a red caution
 * glyph, the statements as a dash list in the body's own size, the sentence that
 * says what the press means, and one filled answer — in the reader's language,
 * because pressing it is the agreement.
 *
 * ## One exit
 *
 * No `onClose` is passed. That is not an omission — `DialogFrame`'s contract is
 * that a dialog without one cannot be dismissed by Escape, an X or the backdrop,
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
 * ## Don't show again
 *
 * TUNER's checkbox, beside the answer: the owner chooses whether the gate comes
 * back. Ticked, the agreement is stored and lasts until the text says something
 * materially different (`lib/disclaimer` holds that rule and the version it turns
 * on); unticked, it lasts for this page and the gate is there on the next visit.
 * The operator kept it in TUNER and put it in every tool (2026-10-28).
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
 * carries one more section — `PreviewNotice`, below the agree note — and AGREE
 * records that too (`lib/previewNotice`). Below the note, not above it: the note
 * says the press accepts "the above", and the above stays the four statements.
 * The notice is something the owner is told and the same press confirms having
 * seen. Without it the dialog is exactly the production one;
 * `DisclaimerDialog.test.ts` pins that markup.
 */
export function DisclaimerDialog({
    onAgree,
    preview = false,
}: {
    /** The one press; `dontShowAgain` is the checkbox beside it. */
    onAgree: (dontShowAgain: boolean) => void;
    preview?: boolean;
}) {
    const { lang, t } = useLang();
    const [dontShowAgain, setDontShowAgain] = useState(false);

    return (
        <DialogFrame
            title={t.disclaimer_title}
            Icon={AlertTriangle}
            tone="danger"
            footer={
                <>
                    <label className="mr-auto flex cursor-pointer select-none items-center gap-2 text-[11px] text-slate-400">
                        <input
                            type="checkbox"
                            checked={dontShowAgain}
                            onChange={(e) => setDontShowAgain(e.target.checked)}
                            className="size-3 accent-blue-500"
                        />
                        <span>{t.disclaimer_dontShow}</span>
                    </label>
                    <DialogButton onClick={() => onAgree(dontShowAgain)} tone="solid" Icon={Check}>
                        {t.disclaimer_agree}
                    </DialogButton>
                </>
            }
        >
            <div className="space-y-3 text-xs leading-relaxed text-slate-300">
                <p>{emphasise(t.disclaimer_lede, 'plain')}</p>
                <ul className="space-y-2">
                    {t.disclaimer_points.map((point) => (
                        <Item key={point}>{emphasise(point, 'plain')}</Item>
                    ))}
                </ul>
                <p className="text-[11px] text-slate-500">{t.disclaimer_agreeNote}</p>
                {preview && <PreviewNotice copy={t.disclaimer_preview} policyHref={PRIVACY_PREVIEW[lang]} />}
            </div>
        </DialogFrame>
    );
}

/** One statement: an em dash, then the line. The dash is TUNER's, and the list's only mark. */
function Item({ children }: { children: React.ReactNode }) {
    return (
        <li className="flex gap-2">
            <span aria-hidden="true" className="shrink-0 text-slate-600">
                —
            </span>
            <span>{children}</span>
        </li>
    );
}

/**
 * What this preview sends, when, what for, who can see it, and how it goes away —
 * in front of the owner before the first of it leaves the device.
 *
 * m3 used to show this on a page of its own (/preview-notice) on the way in; it
 * is here now because the operator decided the confirmation belongs in the app
 * (2026-09-24). The copy is m3's (`disclaimer_preview` in the catalog, which
 * says which two lines were made true of this app), in m3's order: what is sent,
 * then its purpose, where it is kept and how to delete it, then the policy that
 * says all of it at length.
 *
 * Built from the dialog's own parts, as TUNER's is, so it reads as the same dialog and not a second
 * page: the dash list, a bold title per item, the grey small print for when each is sent. The one
 * rule above it is the line between the two things this dialog says. The link opens a new tab, like
 * every link out of this app — a same-tab navigation would drop the cable and anything unsaved.
 */
export function PreviewNotice({ copy: n, policyHref }: { copy: Localised['disclaimer_preview']; policyHref: string }) {
    return (
        <section className="space-y-2 border-t border-slate-800 pt-3">
            <p>{n.lead}</p>
            <ul className="space-y-2">
                <Sent title={n.sessionsTitle} when={n.sessionsWhen}>
                    {n.sessions}
                </Sent>
                <Sent title={n.recordsTitle} when={n.recordsWhen}>
                    {n.records}
                </Sent>
                <Sent title={n.readsTitle} when={n.readsWhen}>
                    {n.reads}
                </Sent>
                <Sent title={n.investigationsTitle} when={n.investigationsWhen}>
                    {n.investigations}
                </Sent>
            </ul>
            <p className="text-[11px] text-slate-500">{n.alsoSent}</p>
            <ul className="space-y-2">
                <Sent title={n.purposeTitle}>{n.purpose}</Sent>
                <Sent title={n.whereTitle}>{n.where}</Sent>
                <Sent title={n.deleteTitle}>{n.deleteBody}</Sent>
            </ul>
            <p>
                <a
                    href={policyHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[11px] text-blue-400 underline underline-offset-2 transition-colors hover:text-blue-300"
                >
                    {n.policy}
                </a>
            </p>
        </section>
    );
}

/** One kind of thing that is sent: its name, what it holds, and when it goes. */
function Sent({ title, when, children }: { title: string; when?: string; children: React.ReactNode }) {
    return (
        <Item>
            <span className="block font-bold text-slate-100">{title}</span>
            {children}
            {when && <span className="block text-[11px] text-slate-500">{when}</span>}
        </Item>
    );
}

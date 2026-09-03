'use client';

import { Heart } from 'lucide-react';
import { DialogFrame } from '@/components/DialogFrame';
import { MicroLabel, TextButton, emphasise } from '@/components/ui';
import { useLang } from '@/lib/i18n';

/**
 * Who this is built on.
 *
 * ## Why it is a dialog of its own
 *
 * Somebody who installs this as a PWA never reads the README, and the licence
 * of the work in `THIRD-PARTY-NOTICES.md` §3.2 asks that attribution and
 * project links stay intact. A link in a file nobody opens is not intact in any
 * sense the asker meant.
 *
 * ## And why it is NOT inside the disclaimer
 *
 * The disclaimer is acknowledged once and stores that it was — it is designed to
 * go away. Putting the attribution inside it would mean the credit disappears
 * permanently the moment the operator agrees, which is the worst possible home
 * for something that has to remain available. This one is reachable from the
 * header at any time and has nothing to dismiss.
 *
 * ## What is in it
 *
 * Names, what each thing gave this app, and where to find it. Not a licence
 * dump: the full position on each is in `THIRD-PARTY-NOTICES.md`, and a wall of
 * legal text in a dialog is read exactly as often as a wall of legal text in a
 * file.
 */
export function CreditsDialog({ onClose }: { onClose: () => void }) {
    const { t } = useLang();

    return (
        <DialogFrame
            title={t.credits_title}
            Icon={Heart}
            width="max-w-lg"
            onClose={onClose}
            footer={<TextButton onClick={onClose}>{t.wiz_close}</TextButton>}
        >
            <p className="text-[11px] leading-relaxed text-slate-400">{t.credits_lede}</p>

            {t.credits_entries.map((e) => (
                <section key={e.name} className="mt-4">
                    <MicroLabel>{e.name}</MicroLabel>
                    <p className="mt-1 text-[11px] leading-relaxed text-slate-300">{emphasise(e.what)}</p>
                    {/* A LINK only when there is somewhere to go.
                        `docs/REFERENCES.md` is a path inside the repository, and
                        an <a href> would resolve it against the deployment and
                        offer the operator a 404. A path is printed as a path. */}
                    {e.url.startsWith('http') ? (
                        // `rel="noreferrer"`: the app makes no requests of its own
                        // and the CSP says so, but a link the operator follows is
                        // their navigation, and it should not carry our URL along.
                        <a
                            href={e.url}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-0.5 block break-all font-mono text-[10px] text-blue-400 hover:text-blue-300"
                        >
                            {e.url}
                        </a>
                    ) : (
                        <p className="mt-0.5 break-all font-mono text-[10px] text-slate-600">{e.url}</p>
                    )}
                    {e.licence && (
                        <p className="mt-0.5 font-mono text-[10px] text-slate-600">{e.licence}</p>
                    )}
                </section>
            ))}

            <p className="mt-5 border-t border-slate-800 pt-3 text-[11px] leading-relaxed text-slate-500">
                {t.credits_notices}
            </p>
        </DialogFrame>
    );
}

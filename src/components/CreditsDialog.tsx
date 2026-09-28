'use client';

import { useState } from 'react';
import { Heart } from 'lucide-react';
import { DialogFrame } from '@/components/DialogFrame';
import { MicroLabel, TextButton, emphasise } from '@/components/ui';
import { useBuildLabel } from '@/lib/build-variant';
import { useLang } from '@/lib/i18n';
import { APP_VERSION } from '@/lib/version';
import { MESH } from '@/lib/links';
import { readSupporters } from '@/lib/supporters';

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
 *
 * ## The colophon
 *
 * Last and dim, as in TUNER: where the work continues (MESH, linked from here
 * and nowhere else) and the people who carry it — those who bought MILE for
 * this tool on MESH and agreed to be named, most MILE first, names only. The
 * list is written into the page at build time (scripts/inject-supporters.mjs),
 * so reading it is no request: the CSP's connect-src 'self' and the promise that
 * production sends nothing both stay true. A dev server has no list and shows
 * only the MESH line.
 */
export function CreditsDialog({ onClose }: { onClose: () => void }) {
    const { lang, t } = useLang();
    const buildLabel = useBuildLabel();
    // Read once, when the dialog opens: the list is in the page, not the bundle.
    const [supporters] = useState(readSupporters);
    const named = supporters && (supporters.names.length > 0 || supporters.others);

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

            {/* Which build this is. The header drops the version below 900px,
                and this is the dialog someone opens when they are about to write
                to the author about something — so it is here at every width, and
                on a phone it is the only place it is. Under the notices' rule
                rather than a second one: two rules on one edge draw a box. */}
            <p className="mt-2 font-mono text-[10px] text-slate-600">
                {APP_VERSION}
                {buildLabel && ` · ${buildLabel}`}
            </p>

            {/* The colophon, under the same rule as the notices and the version —
                a second rule on the same edge would draw a box. Neutral: it states
                no machine state, so it borrows no accent. */}
            <div className="mt-4 text-[10px] leading-relaxed text-slate-600">
                <span className="font-mono uppercase tracking-widest">integrated by tsunagi</span>
                {supporters && named && (
                    <div className="mt-2">
                        <p className="text-slate-500">{t.credits_supportersLead}</p>
                        {supporters.names.length > 0 && (
                            <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-400">
                                {supporters.names.map((n, i) => (
                                    <span key={`${i}:${n}`}>{n}</span>
                                ))}
                            </p>
                        )}
                        {supporters.others && <p className="mt-1">{t.credits_supportersOthers}</p>}
                        <p className="mt-1 font-mono text-[9px] tracking-wider">{t.credits_supportersAsOf(supporters.asOf)}</p>
                    </div>
                )}
                <p className="mt-2">
                    {t.credits_meshLead}{' '}
                    <a
                        href={MESH[lang]}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-slate-500 underline underline-offset-2 hover:text-slate-300"
                    >
                        MESH
                    </a>
                    {t.credits_meshTail}
                </p>
            </div>
        </DialogFrame>
    );
}

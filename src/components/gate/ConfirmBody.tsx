'use client';

import { Info } from 'lucide-react';
import { useId, useState } from 'react';
import { Explain, LABEL } from '@/components/ui';
import { useLang } from '@/lib/i18n';

/**
 * The body every confirmation in this app reads the same way (docs/UX-DESIGN.md §5,
 * tsunagi-m-design §4 modal family): what happens, until when, what pressing does — three lines,
 * in that order, and nothing between them. The title above already names the thing that moves or
 * goes, so the first line does not repeat it as a heading.
 *
 * A confirmation used to carry six blocks here — the SGBD's quotation, the call lines, the frame,
 * how sure the frame is, an after-note — before the owner reached the answer. They are all still
 * true and still on the dialog, under `ConfirmDetails`, which the reader opens when they want them.
 */
export function ConfirmSteps({ what, until, press }: { what: React.ReactNode; until: React.ReactNode; press: React.ReactNode }) {
    return (
        <div className="flex flex-col gap-1.5">
            <p className="text-sm leading-relaxed text-slate-100">{what}</p>
            <p className="text-xs leading-relaxed text-slate-300">{until}</p>
            <p className="text-xs leading-relaxed text-slate-400">{press}</p>
        </div>
    );
}

/**
 * 詳細 ⓘ: the SGBD's own words, the frames and the job names, drawn only when asked for — the
 * dialog's equivalent of a `Section`'s info. The label and the glyph are one control, so a thumb
 * on a head unit does not have to find a 12px icon. Opening it moves what is below; the reader
 * asked for that, and the answers stay where they are (they are the frame's, not the body's).
 */
export function ConfirmDetails({ children, label }: { children: React.ReactNode; /** Where the details are one thing (送る電文), its name; else 詳細. */ label?: string }) {
    const { t } = useLang();
    const [open, setOpen] = useState(false);
    const id = useId();
    return (
        <div className="mt-4">
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                aria-expanded={open}
                aria-controls={id}
                title={open ? t.info_hide : t.info_show}
                className={`-my-2 inline-flex items-center gap-1.5 py-2 ${LABEL} transition-colors ${
                    open ? 'text-blue-400' : 'text-slate-500 hover:text-slate-300'
                }`}
            >
                {label ?? t.conf_details}
                <Info className="size-3" />
            </button>
            {open && <Explain id={id}>{children}</Explain>}
        </div>
    );
}

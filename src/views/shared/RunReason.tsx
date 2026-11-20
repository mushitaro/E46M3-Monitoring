'use client';

import { useState } from 'react';
import { LABEL } from '@/components/ui';
import { useLang } from '@/lib/i18n';
import type { RunBlockKey, RunVerdict } from '@tsunagi/monitoring-engine';

/**
 * Why a row cannot run, said where its control is — in a word or two.
 *
 * The reason has to be drawn, not left to a `title`: a phone has no hover, and a refusal that only a
 * mouse can read is a refusal nobody in the car can (tsunagi-m-mobile §10). But drawn as the whole
 * sentence it was the same two lines under every one of eighty-five ACTUATOR rows — a wall that
 * says one thing, which is what the operator called this app's look (2026-10-28). So the row names
 * the reason and the sentence is said once: in the list's ⓘ (`ReasonGlossary`), and in full in the
 * job's own detail where there is one. `title` keeps it for a mouse as well.
 */
export function ReasonTag({ reason, label }: { reason: RunBlockKey; /** The word, where the row says it its own way. */ label?: string }) {
    const { t } = useLang();
    // Touching the word says the sentence (SC06 F25: a head unit has no mouse, so `title` alone said
    // nothing). The bubble floats over the rows below: nothing in the list moves when it opens (U7).
    const [open, setOpen] = useState(false);
    return (
        <span className="relative shrink-0">
            <button
                type="button"
                title={t.runBlock[reason]}
                aria-expanded={open}
                onClick={() => setOpen((v) => !v)}
                onBlur={() => setOpen(false)}
                className={`${LABEL} cursor-help text-slate-500 underline decoration-dotted underline-offset-2`}
            >
                {label ?? t.runBlockShort[reason]}
            </button>
            {open && (
                <span role="tooltip" className="absolute right-0 top-full z-30 mt-1 block w-64 rounded bg-slate-800 px-2 py-1.5 text-left text-[11px] normal-case leading-relaxed tracking-normal text-slate-200 shadow-lg">
                    {t.runBlock[reason]}
                </span>
            )}
        </span>
    );
}

/**
 * A list's explanation: what it is, then each reason its rows carry, word and sentence, once. Only
 * the reasons that are on screen — a glossary of refusals nobody is seeing is noise.
 */
export function ReasonGlossary({ lead, reasons }: { lead: string; reasons: (RunVerdict | null | undefined)[] }) {
    const { t } = useLang();
    const present = [...new Set(reasons.flatMap((v) => (v && !v.allowed ? [v.reason] : [])))];
    return (
        <>
            <p>{lead}</p>
            {present.length > 0 && (
                <dl className="mt-2 space-y-1.5">
                    {present.map((r) => (
                        <div key={r}>
                            <dt className={`${LABEL} text-slate-500`}>{t.runBlockShort[r]}</dt>
                            <dd>{t.runBlock[r]}</dd>
                        </div>
                    ))}
                </dl>
            )}
        </>
    );
}

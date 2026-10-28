'use client';

import { LABEL } from '@/components/ui';
import { useLang } from '@/lib/i18n';
import type { RunBlockKey, RunVerdict } from '@/lib/runGate';

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
export function ReasonTag({ reason }: { reason: RunBlockKey }) {
    const { t } = useLang();
    return (
        <span title={t.runBlock[reason]} className={`shrink-0 ${LABEL} text-slate-600`}>
            {t.runBlockShort[reason]}
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

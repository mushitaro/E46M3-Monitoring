'use client';

import { RotateCcw } from 'lucide-react';
import { ELECTRICAL_FAULT_CHECKLIST, type Ds2ErrorKind } from '@tsunagi/ds2-core';
import { TextButton } from '@/components/ui';
import { useLang } from '@/lib/i18n';

/**
 * Failure surface.
 *
 * The whole point of classifying an echo mismatch is that the two kinds need
 * OPPOSITE advice. Offering "retry" for an electrical fault sends the user into
 * an afternoon of retries that cannot succeed; showing the physical checklist
 * for a desync sends them to check a cable that is fine.
 *
 * So this branches on `kind`, which arrives as data on the error — never by
 * matching on the message text.
 */
export function LinkError({
    message,
    kind,
    onRetry,
}: {
    message: string;
    kind: Ds2ErrorKind | null;
    onRetry?: () => void;
}) {
    const { t } = useLang();
    const electrical = kind === 'electrical';

    return (
        // A full-width strip separated by its own bottom rule, like every other
        // bar — not a card floating on a gutter. Tint carries the severity; the
        // outline it used to have carried nothing.
        <div
            role="alert"
            className={`flex-none border-b border-slate-900 px-4 py-3 ${
                electrical ? 'bg-red-950/40' : 'bg-slate-900/50'
            }`}
        >
            <p className={`text-xs font-semibold ${electrical ? 'text-red-400' : 'text-slate-300'}`}>
                {electrical ? t.error_electrical_title : message}
            </p>

            {electrical && (
                <>
                    <p className="mt-1 text-xs text-slate-400">{t.error_electrical_body}</p>
                    <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs text-slate-400">
                        {ELECTRICAL_FAULT_CHECKLIST.map((step) => (
                            <li key={step}>{step}</li>
                        ))}
                    </ol>
                    <p className="mt-2 font-mono text-[11px] text-slate-600">{message}</p>
                </>
            )}

            {kind === 'desync' && <p className="mt-1 text-xs text-slate-400">{t.error_desync_body}</p>}

            {/* Retry is offered for everything EXCEPT an electrical fault, where
                it is the one action that cannot help. */}
            {onRetry && !electrical && (
                <div className="mt-2">
                    <TextButton onClick={onRetry} tone="primary" Icon={RotateCcw}>
                        {t.retry}
                    </TextButton>
                </div>
            )}
        </div>
    );
}

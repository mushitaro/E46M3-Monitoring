'use client';

/**
 * Confirmation for something that cannot be taken back.
 *
 * Not `window.confirm`: that renders in the browser's language, not the
 * reader's, and this app resolves language in exactly one place. It also cannot
 * state a consequence in more than one line, and the consequence is the entire
 * reason the dialog exists.
 *
 * The rule this follows: say what will happen, in concrete terms, before asking.
 * "Are you sure?" is not a confirmation — it moves the decision to the operator
 * without giving them anything new to decide with.
 */

import { AlertTriangle } from 'lucide-react';
import { LABEL, TextButton } from '@/components/ui';
import { useLang } from '@/lib/i18n';

export function ConfirmDialog({
    title,
    consequence,
    confirmLabel,
    onConfirm,
    onCancel,
}: {
    title: string;
    /** What this does that cannot be undone. Concrete — bytes, memory, values. */
    consequence: string;
    confirmLabel: string;
    onConfirm: () => void;
    onCancel: () => void;
}) {
    const { t } = useLang();
    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-6"
            role="dialog"
            aria-modal="true"
            onClick={onCancel}
        >
            <div
                className="w-full max-w-md bg-slate-900 p-5"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-baseline gap-2">
                    <AlertTriangle className="size-3.5 shrink-0 self-center text-red-400" />
                    <span className={`${LABEL} text-red-400`}>{title}</span>
                </div>
                <p className="mt-3 text-xs leading-relaxed text-slate-300">{consequence}</p>
                {/* Cancel first and plain, confirm second and red: the dangerous
                    one should not be where the thumb already is. */}
                <div className="mt-5 flex items-center justify-end gap-4">
                    <TextButton onClick={onCancel}>{t.cancel}</TextButton>
                    <TextButton onClick={onConfirm} tone="danger" Icon={AlertTriangle}>
                        {confirmLabel}
                    </TextButton>
                </div>
            </div>
        </div>
    );
}

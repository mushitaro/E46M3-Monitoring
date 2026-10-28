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
 *
 * In the one frame every dialog here wears (DialogFrame, TUNER's MessageDialog):
 * CANCEL plain and first, the confirm tinted red and last — the dangerous answer
 * is not where the thumb already is. No X and no backdrop: there is no honest
 * default for "erase this", so the two labelled answers are the only ways out,
 * and Escape is CANCEL (`onEscape`, which draws no X).
 */

import { AlertTriangle } from 'lucide-react';
import { DialogFrame } from '@/components/DialogFrame';
import { DialogButton } from '@/components/ui';
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
        <DialogFrame
            title={title}
            Icon={AlertTriangle}
            tone="danger"
            onEscape={onCancel}
            footer={
                <>
                    <DialogButton onClick={onCancel} tone="neutral">
                        {t.cancel}
                    </DialogButton>
                    <DialogButton onClick={onConfirm} tone="danger">
                        {confirmLabel}
                    </DialogButton>
                </>
            }
        >
            <p className="text-xs leading-relaxed text-slate-300">{consequence}</p>
        </DialogFrame>
    );
}


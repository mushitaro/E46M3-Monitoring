'use client';

import { useEffect, useRef } from 'react';
import { LABEL } from '@/components/ui';
import { tid, type TestId } from '@/lib/testIds';

/**
 * The one modal shell. Backdrop, card, title row, and the rules about how a
 * dialog can be left.
 *
 * ## A stray tap on the backdrop closes nothing
 *
 * Every dialog in this app asks for a decision — run this, agree to that, clear
 * those. A backdrop is the easiest thing in the layout to hit by accident,
 * especially one-handed under a car, and "the dialog vanished and I do not know
 * whether I answered it" is the worst outcome available. Escape closes, and the
 * dialog's own CANCEL closes; the backdrop is inert on purpose.
 *
 * ## No `onClose` means there is no way out but the answer
 *
 * The disclaimer has exactly one exit — AGREE — and the way that is expressed is
 * that nothing hands this component an `onClose`. Escape then does nothing,
 * because there is nothing for it to do. That is a mechanism, not a convention:
 * a dialog that must not be dismissible cannot accidentally become dismissible
 * without someone adding a prop.
 *
 * ## Focus
 *
 * The card takes focus on open. Escape is a keydown on the card rather than a
 * window listener, so two stacked dialogs cannot both act on one press, and the
 * screen reader announces the dialog rather than leaving focus behind it.
 */
export function DialogFrame({
    title,
    tone = 'neutral',
    Icon,
    onClose,
    children,
    footer,
    width = 'max-w-md',
    testId,
}: {
    title: string;
    tone?: 'neutral' | 'danger';
    Icon?: React.ComponentType<{ className?: string }>;
    /** Escape and CANCEL. Omit it entirely when the dialog has one exit. */
    onClose?: () => void;
    children: React.ReactNode;
    footer?: React.ReactNode;
    width?: string;
    /** A declared hook, never a loose string — see `lib/testIds`. */
    testId?: TestId;
}) {
    const card = useRef<HTMLDivElement>(null);

    useEffect(() => {
        card.current?.focus();
    }, []);

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-6"
            // The backdrop is not a control. It carries no handler at all rather
            // than a handler that decides not to act — there is nothing here for
            // a later edit to make "just close it" out of.
            aria-hidden={false}
        >
            <div
                ref={card}
                role="dialog"
                aria-modal="true"
                aria-label={title}
                tabIndex={-1}
                {...(testId ? tid(testId) : {})}
                className={`flex max-h-full w-full ${width} flex-col bg-slate-900 outline-none`}
                onKeyDown={(e) => {
                    if (e.key === 'Escape' && onClose) {
                        e.stopPropagation();
                        onClose();
                    }
                }}
            >
                <div className="flex flex-none items-center gap-2 border-b border-slate-800 px-5 py-4">
                    {Icon && (
                        <Icon
                            className={`size-3.5 shrink-0 ${tone === 'danger' ? 'text-red-400' : 'text-blue-400'}`}
                        />
                    )}
                    <span className={`${LABEL} ${tone === 'danger' ? 'text-red-400' : 'text-slate-300'}`}>
                        {title}
                    </span>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
                {/* Reserved. The row keeps its height with or without buttons, so
                    a dialog whose actions appear late does not jump. */}
                <div className="flex h-[52px] flex-none items-center justify-end gap-4 border-t border-slate-800 px-5">
                    {footer}
                </div>
            </div>
        </div>
    );
}

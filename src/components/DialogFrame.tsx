'use client';

import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { LABEL } from '@/components/ui';
import { useLang } from '@/lib/i18n';
import { tid, type TestId } from '@/lib/testIds';

const ICON_TONE = {
    neutral: 'text-slate-400',
    primary: 'text-blue-400',
    danger: 'text-red-400',
} as const;

/**
 * The one modal shell. Backdrop, card, title row, and the rules about how a
 * dialog can be left.
 *
 * ## The family's geometry
 *
 * TUNER's (`DialogFrame.tsx`, `DisclaimerDialog.tsx`), so a dialog opened in
 * either tool is the same object: a 560px card capped to the viewport, one
 * outline, a shadow, rounded corners, the title over a rule, the answers under
 * one. This app had four shells of its own — this one flat and unbordered at
 * 448, the confirmation another, the assistant's notice a third, the electrical
 * fault the only one that matched — and a reader learns a dialog by its shape.
 *
 * On the overlay layer, `z-[100]` scrim and `z-[110]` card (tsunagi-m-design
 * §5.8). At `z-50` they shared a step with the popovers, and a popover opened
 * before a dialog could sit over it.
 *
 * `max-h-[min(84dvh,560px)]`: the body scrolls inside the frame and the answers
 * are part of the frame, so however long the text grows the buttons cannot leave
 * the screen — on the head unit's 683×400 too (tsunagi-m-mobile §11). `dvh`, not
 * `vh`: on Android `vh` is the largest viewport and would reach under the
 * browser's own bar. The blur only from 900px: on a phone it costs about a
 * second of paint (tsunagi-m-mobile §16.5).
 *
 * ## A stray tap on the backdrop closes nothing
 *
 * Every dialog in this app asks for a decision — run this, agree to that, clear
 * those. A backdrop is the easiest thing in the layout to hit by accident,
 * especially one-handed under a car, and "the dialog vanished and I do not know
 * whether I answered it" is the worst outcome available. Escape, the X and the
 * dialog's own CANCEL close; the backdrop is inert on purpose.
 *
 * ## No `onClose` means there is no way out but the answer
 *
 * The disclaimer has exactly one exit — AGREE — and the way that is expressed is
 * that nothing hands this component an `onClose`. Then there is no X and Escape
 * does nothing, because there is nothing for either to do. That is a mechanism,
 * not a convention: a dialog that must not be dismissible cannot accidentally
 * become dismissible without someone adding a prop.
 *
 * A confirmation wants Escape without an X — two labelled answers and no third
 * way out — so it passes `onEscape` alone.
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
    onEscape = onClose,
    children,
    footer,
    testId,
}: {
    title: string;
    /** The icon's colour. The title stays slate-300: a heading names, it does not warn. */
    tone?: keyof typeof ICON_TONE;
    Icon?: React.ComponentType<{ className?: string }>;
    /** Escape, the X and CANCEL. Omit it entirely when the dialog has one exit. */
    onClose?: () => void;
    /** Escape alone, for a dialog whose way out is its CANCEL rather than an X. Defaults to `onClose`. */
    onEscape?: () => void;
    children: React.ReactNode;
    /** The answers, right-aligned under a rule. */
    footer?: React.ReactNode;
    /** A declared hook, never a loose string — see `lib/testIds`. */
    testId?: TestId;
}) {
    const { t } = useLang();
    const card = useRef<HTMLDivElement>(null);

    useEffect(() => {
        card.current?.focus();
    }, []);

    return (
        <>
            {/* The backdrop is not a control. It carries no handler at all rather
                than a handler that decides not to act — there is nothing here for
                a later edit to make "just close it" out of. */}
            <div className="fixed inset-0 z-[100] bg-slate-950/70 min-[900px]:backdrop-blur-sm" />
            <div
                ref={card}
                role="dialog"
                aria-modal="true"
                aria-label={title}
                tabIndex={-1}
                {...(testId ? tid(testId) : {})}
                className="fixed left-1/2 top-1/2 z-[110] flex max-h-[min(84dvh,560px)] w-[min(560px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-slate-700 bg-slate-900 p-4 shadow-xl outline-none duration-200 animate-in fade-in zoom-in-95"
                onKeyDown={(e) => {
                    if (e.key === 'Escape' && onEscape) {
                        e.stopPropagation();
                        onEscape();
                    }
                }}
            >
                <div className="mb-4 flex shrink-0 items-center gap-2 border-b border-slate-800 pb-2">
                    {Icon && <Icon className={`size-3.5 shrink-0 ${ICON_TONE[tone]}`} />}
                    <h3 className={`min-w-0 flex-1 truncate ${LABEL} text-slate-300`}>{title}</h3>
                    {onClose && (
                        <button
                            type="button"
                            onClick={onClose}
                            aria-label={t.menu_close}
                            className="shrink-0 text-slate-500 transition-colors hover:text-slate-300"
                        >
                            <X className="size-4" />
                        </button>
                    )}
                </div>
                {/* The one scrolling region, and it is the text — never the answers below it. */}
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">{children}</div>
                {footer && (
                    <div className="mt-3 flex shrink-0 items-center justify-end gap-2 border-t border-slate-800 pt-3">
                        {footer}
                    </div>
                )}
            </div>
        </>
    );
}

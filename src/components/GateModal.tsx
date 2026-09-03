'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Play, X } from 'lucide-react';
import { MicroLabel, TextButton, Well } from '@/components/ui';
import { useLang } from '@/lib/i18n';
import type { Risk } from '@/lib/ecuCatalog';

/**
 * The confirmation gate for anything that commands the car.
 *
 * Every precondition must be ticked before the run button enables, and the
 * dialog states the CONCRETE consequence — which job, at which address, with
 * which arguments — rather than a generic "are you sure".
 *
 * Two properties the old app had and I had dropped entirely:
 *   - the run button is disabled until every box is checked
 *   - the exact telegram/job call is previewed, so what you approve is what is
 *     sent
 *
 * And two it did not have:
 *   - focus is trapped and Escape cancels (its modals had none of
 *     role="dialog", initial focus, a trap, or a key handler)
 *   - the ledger verdict is restated here, so the last thing seen before a run
 *     is why it is or is not allowed
 */
interface GateProps {
    title: string;
    subtitle?: string;
    /** The German original, always shown — the translation may be wrong. */
    original?: string;
    risk: Risk;
    preconditions: string[];
    /** What will actually go out on the wire. */
    plan: string;
    /** Non-null when the ledger refuses. The run button never enables. */
    blockedReason: string | null;
    onCancel: () => void;
    onRun: () => void;
}

export function GateModal({ open, ...rest }: GateProps & { open: boolean }) {
    // Split so the dialog MOUNTS fresh on each open. Resetting the checkbox set
    // from an effect works but cascades a render, and React now flags it; a new
    // instance per open is both simpler and impossible to get out of sync.
    if (!open) return null;
    return <GateDialog {...rest} />;
}

function GateDialog({
    title,
    subtitle,
    original,
    risk,
    preconditions,
    plan,
    blockedReason,
    onCancel,
    onRun,
}: GateProps) {
    const { t } = useLang();
    const [checked, setChecked] = useState<Set<string>>(new Set());
    const dialogRef = useRef<HTMLDivElement>(null);
    const firstRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        firstRef.current?.focus();
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                onCancel();
                return;
            }
            if (e.key !== 'Tab' || !dialogRef.current) return;
            const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
                'button:not([disabled]), input, [tabindex]:not([tabindex="-1"])',
            );
            if (focusable.length === 0) return;
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (e.shiftKey && document.activeElement === first) {
                e.preventDefault();
                last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault();
                first.focus();
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onCancel]);

    const allChecked = preconditions.every((c) => checked.has(c));
    const canRun = allChecked && !blockedReason;

    return (
        <>
            {/* Backdrop at 40, the floating card at 50 — the z ladder, not
                invented values. */}
            <div className="fixed inset-0 z-40 bg-slate-950/70 backdrop-blur-sm" onClick={onCancel} />
            <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-label={title}
                // The ONE outline in here. A modal is detached from the page, so
                // it earns an edge; nothing inside it does, and every inner block
                // below is a surface instead.
                className="fixed left-1/2 top-1/2 z-50 flex max-h-[80vh] w-[560px] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-slate-700 bg-slate-900 shadow-xl duration-200 animate-in fade-in zoom-in-95"
            >
                <div className="flex h-[44px] shrink-0 items-center gap-2 border-b border-slate-800 px-4">
                    {risk === 'high' && <AlertTriangle className="size-4 shrink-0 text-red-400" />}
                    <span className="truncate font-mono text-xs text-slate-200">{title}</span>
                    <button
                        ref={firstRef}
                        type="button"
                        onClick={onCancel}
                        className="ml-auto shrink-0 rounded p-1 text-slate-500 transition-colors hover:text-slate-300"
                        aria-label={t.cancel}
                    >
                        <X className="size-4" />
                    </button>
                </div>

                <div className="min-h-0 flex-1 space-y-4 overflow-auto px-4 py-4">
                    <div>
                        {subtitle && <p className="text-xs text-slate-300">{subtitle}</p>}
                        {original && original !== subtitle && (
                            <p className="mt-1 font-mono text-[10px] text-slate-600">{original}</p>
                        )}
                    </div>

                    {blockedReason && (
                        <Well>
                            <p className="text-[11px] text-amber-400">{blockedReason}</p>
                        </Well>
                    )}

                    <div>
                        <MicroLabel>{t.gate_plan}</MicroLabel>
                        <code className="mt-1.5 block whitespace-pre-wrap break-all rounded bg-slate-950 p-2 font-mono text-[11px] text-blue-400">
                            {plan}
                        </code>
                    </div>

                    <div>
                        <MicroLabel>{t.gate_preconditions}</MicroLabel>
                        <div className="mt-1.5 space-y-1.5">
                            {preconditions.map((c) => (
                                <label key={c} className="flex cursor-pointer items-center gap-2 text-xs text-slate-300">
                                    <input
                                        type="checkbox"
                                        checked={checked.has(c)}
                                        onChange={(e) =>
                                            setChecked((prev) => {
                                                const next = new Set(prev);
                                                if (e.target.checked) next.add(c);
                                                else next.delete(c);
                                                return next;
                                            })
                                        }
                                        className="size-3 accent-blue-500"
                                    />
                                    {/* `?? c` matches JobDetail and ServicePane, and matters
                                        more here than in either: without it an unknown token
                                        renders as nothing, and `allChecked` above still requires
                                        the operator to tick the resulting blank box before RUN
                                        enables — a confirmation of a condition the dialog never
                                        states. The raw token is a poor label; an empty one is a
                                        worse thing than a poor label. */}
                                    {(t[`precond_${c}` as keyof typeof t] as string) ?? c}
                                </label>
                            ))}
                        </div>
                    </div>
                </div>

                <div className="flex h-[52px] shrink-0 items-center justify-end gap-6 border-t border-slate-800 px-4">
                    <TextButton onClick={onCancel} tone="neutral">
                        {t.cancel}
                    </TextButton>
                    {/* Red text, not a red box. The confirm in a gate dialog is
                        already the thing you came here to press; boxing it makes
                        it the brightest object on screen, which is the opposite
                        of what a destructive default should be. */}
                    <TextButton onClick={onRun} disabled={!canRun} Icon={Play} tone="destructive">
                        {t.run}
                    </TextButton>
                </div>
            </div>
        </>
    );
}

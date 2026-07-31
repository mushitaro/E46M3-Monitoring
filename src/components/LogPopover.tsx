'use client';

import { useEffect, useRef, useState } from 'react';
import { Download, Terminal, Trash2, X } from 'lucide-react';
import type { CommsLogLine } from '@/hooks/useDs2Link';
import { useLang } from '@/lib/i18n';

/**
 * The comms log as an on-demand popover, not a tab.
 *
 * It was a tab in my rebuild, which was wrong twice: it spent one of four tab
 * slots on a diagnostic, and it made the log something you navigate AWAY from
 * your work to read. The point of a comms log is that it is available while you
 * are doing the thing that is failing.
 *
 * Full-screen invisible backdrop to catch outside clicks, then an absolutely
 * positioned panel — the same idiom the modal uses, expressed as a sibling
 * rather than a wrapper.
 */
export function LogPopover({
    log,
    onClear,
    onExport,
}: {
    log: CommsLogLine[];
    onClear: () => void;
    onExport: () => void;
}) {
    const { t } = useLang();
    const [open, setOpen] = useState(false);
    const bodyRef = useRef<HTMLDivElement>(null);

    // Follow the tail while open. A log you have to scroll to see the newest
    // line of is a log you stop reading.
    useEffect(() => {
        if (open && bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }, [open, log.length]);

    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setOpen(false);
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open]);

    const errors = log.filter((l) => l.kind === 'error').length;

    return (
        <div className="relative">
            <button
                type="button"
                onClick={() => setOpen(!open)}
                title={t.tab_log}
                aria-expanded={open}
                className={`relative flex items-center transition-colors ${
                    open ? 'text-blue-400' : 'text-slate-500 hover:text-blue-400'
                }`}
            >
                <Terminal className="size-4" />
                {/* A count, not a dot: "3 errors" is actionable, a dot is not. */}
                {errors > 0 && (
                    <span className="absolute -right-1.5 -top-1.5 min-w-3 rounded-full bg-red-500 px-1 text-center font-mono text-[8px] leading-3 text-white">
                        {errors}
                    </span>
                )}
            </button>

            {open && (
                <>
                    <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
                    <div className="absolute right-0 top-10 z-50 flex h-[420px] w-[min(560px,90vw)] flex-col rounded-lg border border-slate-700 bg-slate-900 shadow-xl">
                        <div className="flex h-[44px] shrink-0 items-center gap-3 border-b border-slate-800 px-4">
                            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                                {t.tab_log}
                            </span>
                            <span className="font-mono text-[10px] text-slate-600">{log.length}</span>
                            <span className="ml-auto flex items-center gap-4">
                                <button
                                    type="button"
                                    onClick={onExport}
                                    disabled={log.length === 0}
                                    title={t.exportLog}
                                    className="text-slate-500 transition-colors hover:text-blue-400 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:text-slate-500"
                                >
                                    <Download className="size-3.5" />
                                </button>
                                <button
                                    type="button"
                                    onClick={onClear}
                                    disabled={log.length === 0}
                                    title={t.clearLog}
                                    className="text-slate-500 transition-colors hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:text-slate-500"
                                >
                                    <Trash2 className="size-3.5" />
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setOpen(false)}
                                    className="text-slate-500 transition-colors hover:text-slate-300"
                                >
                                    <X className="size-3.5" />
                                </button>
                            </span>
                        </div>

                        <div ref={bodyRef} className="min-h-0 flex-1 overflow-auto px-4 py-3">
                            {log.length === 0 ? (
                                <p className="text-[11px] text-slate-600">—</p>
                            ) : (
                                <pre className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed">
                                    {log.map((l, i) => (
                                        <div key={i} className={LINE[l.kind]}>
                                            <span className="text-slate-700">
                                                {new Date(l.t).toLocaleTimeString(undefined, { hour12: false })}{' '}
                                            </span>
                                            {l.text}
                                        </div>
                                    ))}
                                </pre>
                            )}
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}

const LINE: Record<CommsLogLine['kind'], string> = {
    error: 'text-red-400',
    warn: 'text-amber-400',
    tx: 'text-blue-400',
    rx: 'text-slate-300',
    info: 'text-slate-500',
};

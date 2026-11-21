'use client';

import { Info } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { Explain, LABEL } from '@/components/ui';
import type { MeasuredPrecondition, Measurement } from '@/lib/gateChecks';
import { TEST_ID, tid } from '@/lib/testIds';
import { useLang } from '@/lib/i18n';
import { MIN_RUN_VOLTAGE, appNow } from '@tsunagi/monitoring-engine';

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
 * What a caution tells the person to do, as lines among the preconditions: aligned with the boxes'
 * labels where there are boxes, so they read as part of one list. Every confirmation that has them (the gate, the procedure's dialog).
 */
export function Told({ lines, indent = false }: { lines: readonly string[]; indent?: boolean }) {
    return (
        <>
            {lines.map((l) => (
                <p key={l} className={`text-xs leading-relaxed text-slate-200 ${indent ? 'pl-[22px]' : ''}`}>
                    {l}
                </p>
            ))}
        </>
    );
}

/**
 * A precondition the app measures (lib/gateChecks), said as its last measurement instead of a box:
 * the value, neutral when it would pass, and red with what makes it pass when it would not (with, when
 * that reading is not from just now, that the press measures again) — or, with nothing measured
 * lately, that pressing measures it first. Never "OK" by itself: the value is a
 * reading, and the press measures again. Every confirmation that drives something (the gate, the
 * procedure's dialog).
 */
export function Measured({ label, p, m, indent = false }: { label: string; p: MeasuredPrecondition; m: Measurement; indent?: boolean }) {
    const { t } = useLang();
    const value = (n: number) => (p === 'voltage_ok' ? n.toFixed(1) : String(Math.round(n)));
    return (
        <p {...tid(TEST_ID.gateMeasured)} className={`text-xs leading-relaxed ${m.kind === 'bad' ? 'text-red-400' : 'text-slate-300'} ${indent ? 'pl-[22px]' : ''}`}>
            {m.kind === 'unmeasured' ? (
                <>
                    {label} <span className="text-slate-500">{t.conf_measureOnPress}</span>
                </>
            ) : (
                <>
                    {t.conf_measured(p, value(m.value), m.kind === 'ok', MIN_RUN_VOLTAGE)}
                    {/* Failing, but not just now: the car may have changed since; the press measures again. */}
                    {m.kind === 'bad' && !m.current && <span className="text-slate-500"> {t.conf_remeasureOnPress}</span>}
                </>
            )}
        </p>
    );
}

/** The app's clock, once a second, for how old the last measurement is (lib/gateChecks `lastMeasured`). */
export function useMeasureClock(): number {
    const [now, setNow] = useState(() => appNow());
    useEffect(() => {
        const id = setInterval(() => setNow(appNow()), 1000);
        return () => clearInterval(id);
    }, []);
    return now;
}

/**
 * 詳細 ⓘ: the SGBD's own words, the frames and the job names, drawn only when asked for — the
 * dialog's equivalent of a `Section`'s info. The label and the glyph are one control, so a thumb
 * on a head unit does not have to find a 12px icon. Opening it moves what is below; the reader
 * asked for that, and the answers stay where they are (they are the frame's, not the body's).
 */
export function ConfirmDetails({
    children,
    label,
    className = 'mt-4',
}: {
    children: React.ReactNode;
    /** Where the details are one thing (送る電文), its name; else 詳細. */
    label?: string;
    /** Its space above: a dialog's section gap, or a row's line (ADAPTATION). */
    className?: string;
}) {
    const { t } = useLang();
    const [open, setOpen] = useState(false);
    const id = useId();
    return (
        <div className={className}>
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

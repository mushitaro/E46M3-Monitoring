'use client';

/**
 * `CatalogSummary` was here: a risk-mix bar and a class breakdown, shown in the
 * visualization region whenever no job was focused. It went because that region
 * is about the job you are looking at, and module statistics are not that —
 * nobody acts on them, and filling the space with something to read is not the
 * same as answering the question. The counts it drew are still on screen, as
 * the facet chips above the list, where they filter.
 */
import { LABEL } from '@/components/ui';

/**
 * A hub-scale numeric readout: one number, one caption.
 *
 * 22px is the ceiling — the size the reference app uses for its own single
 * numeric readout, and the one arbitrary size `check_ui_tokens.mjs` names. At
 * text-6xl this was a 60px glyph, four times the largest type anywhere else and
 * six times the chrome around it: a car with three faults read as an alarm
 * poster rather than as an instrument.
 *
 * Shared so the two views that show a count show it at the same size. They had
 * drifted apart once already.
 */
export function CountReadout({
    value,
    tone,
    suffix,
    caption,
}: {
    value: number;
    tone: string;
    /** The denominator, dimmer than the value. `4` of `/12` read together. */
    suffix?: string;
    caption: string;
}) {
    return (
        <div className="flex h-full flex-col items-center justify-center">
            <div className={`font-mono text-[22px] font-bold leading-none tabular-nums ${tone}`}>
                {value}
                {suffix && <span className="text-slate-600">{suffix}</span>}
            </div>
            <div className={`mt-2 ${LABEL} text-slate-500`}>{caption}</div>
        </div>
    );
}

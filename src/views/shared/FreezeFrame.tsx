'use client';

import { Field } from '../../components/ui';
import { freezeFrameConditions } from '../../lib/faultText';
import type { EcuProfile } from '@tsunagi/monitoring-engine';

/**
 * A freeze frame, decoded: the conditions the module recorded when it stored the fault.
 *
 * This used to print `20 40 60 80` — four raw bytes with no names and no units, because the decode
 * table was not in the dump. `FUMWELTTEXTE` carries the field name, the unit and the arithmetic, and
 * `FORTTEXTE.UW_1..UW_4` says WHICH four fields this particular fault stored (lib/faultText).
 *
 * Where the fault does not name its fields, the raw bytes are still shown. A missing table means "we
 * cannot name these", not "there was nothing here". Shared by DIAGNOSIS's module view and the
 * ALL MODULES row, so a condition reads the same in both.
 */
export function FreezeFrame({
    index,
    code,
    bytes,
    counter,
    profile,
    lang,
}: {
    index: number;
    /** The fault's code (`0x2A`): which fields its freeze frames hold. */
    code: string;
    bytes: number[];
    counter: number;
    profile: EcuProfile | null;
    lang: 'ja' | 'en';
}) {
    const hex = bytes.map((b) => b.toString(16).padStart(2, '0')).join(' ');
    const decoded = freezeFrameConditions(profile, code, bytes, lang);
    return (
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <span className="font-mono text-[10px] text-slate-600">
                #{index + 1} {hex} ×{counter}
            </span>
            {decoded?.map((d, i) => d && <Field key={i} label={d.name} labelKind="data" value={d.value} unit={d.unit} />)}
        </div>
    );
}

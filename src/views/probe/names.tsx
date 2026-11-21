'use client';

import { createContext, useContext } from 'react';
import type { Judge } from '@tsunagi/monitoring-engine';
import { channelLabel, moduleShort, namesInText, type ChannelLabel, type OtherChannel } from '@/lib/channelLabel';
import { useLang } from '@/lib/i18n';
import type { FormItem } from '@/lib/probe/items';

/**
 * The other modules' channels the screen knows the names of (DATALOG's `moduleInfo`), for PROBE's
 * board, its picture and its series. A context rather than a prop through every part: the board's
 * parts, its picture and STARTUP's series all ask the same question.
 */
export const ChannelNames = createContext<((id: string) => OtherChannel | null) | null>(null);

/**
 * PROBE's names (UX-09): a channel by its name, a judgement by what it tests (「SMG 油圧（最小 40 bar
 * 以上）」), an item of a form by either. The identifiers (`19:v`, `J2`) go to the ident slot.
 */
export function useProbeNames() {
    const { lang, t } = useLang();
    const other = useContext(ChannelNames);
    const channel = (id: string): ChannelLabel => channelLabel(id, lang, t, other);
    const judge = (j: Pick<Judge, 'channel' | 'stat' | 'op' | 'value' | 'unit'>): string => {
        const c = channel(j.channel);
        const unit = j.unit ?? c.unit;
        return `${c.name}（${t.judge_stat[j.stat]} ${t.judge_op[j.op](`${j.value}${unit ? ` ${unit}` : ''}`)}）`;
    };
    /** An item a form added or removed: its name, and the identifier it is keyed by. */
    const item = (i: FormItem, judges: readonly Judge[] = []): { name: string; ident: string } => {
        if (i.kind === 'value') return { name: channel(i.label).name, ident: i.label };
        if (i.kind === 'judge') {
            const d = judges.find((j) => j.id === i.label);
            return { name: d ? judge(d) : t.channel_unnamed, ident: i.label };
        }
        // The rest are keyed `faults:<module>`, `read:<module>:<job>`, `adapt`, `capture:…`, `ram:…`.
        const [kind, mod, job] = i.key.split(':');
        if (kind === 'faults') return { name: t.item_faults(moduleShort(mod)), ident: mod };
        if (kind === 'read') return { name: t.item_read(moduleShort(mod)), ident: `${mod} · ${job}` };
        if (kind === 'adapt') return { name: t.item_adapt, ident: '' };
        if (kind === 'capture') return { name: t.item_capture, ident: i.key.slice('capture:'.length) };
        return { name: t.channel_unnamed, ident: i.label };
    };
    return { channel, judge, item, text: (s: string) => namesInText(s, lang, t, other) };
}

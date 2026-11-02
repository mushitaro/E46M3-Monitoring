/**
 * The items a PROBE form measures, and how two forms differ (operator, 2026-11-02: as a series of
 * sessions goes on and something new is learnt, items are added and items no longer needed are
 * removed — and that has to be accepted, not worked around).
 *
 * A form is a plan's steps and judgements. An item is one thing it measures: a value it samples, a
 * judgement, a fault read, a catalogue read, the learned values, a RAM read, a capture. Its key
 * says what was measured AND under what condition, so a judgement whose `where` changed, or a
 * capture whose trigger changed, is a new item and not the old one with a new number — comparing
 * the two would put two different measurements side by side as if they were one.
 *
 * The form a run took its data under never changes (CO-WORK is only added to): an item added is a
 * new plan version, and its series starts at the first run under that version; an item removed
 * stays in the runs that had it and is marked removed from the version that dropped it. Comparing
 * two runs uses the items both measured (compare.ts) and lists the rest as added or removed.
 *
 * Pure.
 */
import type { Clause, Judge, ProbeStep } from './plan';

export type ItemKind = 'value' | 'judge' | 'faults' | 'read' | 'adapt' | 'ram' | 'capture';

export interface FormItem {
    key: string;
    kind: ItemKind;
    /** How the item is named to a reader: the channel, the judgement's id, the module and job. */
    label: string;
}

/** A form: what a plan measures. */
export interface Form {
    v: number;
    steps: readonly ProbeStep[];
    judge?: readonly Judge[];
}

const clauses = (cs: readonly Clause[] | undefined) =>
    (cs ?? [])
        .map((c) => `${c.channel}${c.op}${c.value}`)
        .sort()
        .join('&');

/** A judgement's item: its channel, statistic and condition. The threshold is the verdict, not the measurement. */
export function judgeKey(j: Pick<Judge, 'channel' | 'stat' | 'where'>): string {
    return `judge:${j.channel}|${j.stat}|${clauses(j.where)}`;
}

/** Every item of a form, once each, in the order the plan names them. */
export function formItems(form: Pick<Form, 'steps' | 'judge'>): FormItem[] {
    const out = new Map<string, FormItem>();
    const add = (key: string, kind: ItemKind, label: string) => {
        if (!out.has(key)) out.set(key, { key, kind, label });
    };
    for (const s of form.steps) {
        switch (s.kind) {
            case 'sample':
                for (const c of s.channels) add(`value:${c}`, 'value', c);
                break;
            case 'faults':
                add(`faults:${s.module}`, 'faults', `${s.module} faults`);
                break;
            case 'read':
                add(`read:${s.module}:${s.job}`, 'read', `${s.module} ${s.job}`);
                break;
            case 'adapt':
                add('adapt', 'adapt', 'learned values');
                break;
            case 'ram':
                add(`ram:${s.address}:${s.bytes}`, 'ram', s.label ?? `ram:${s.address}`);
                break;
            case 'capture':
                add(`capture:${clauses(s.condition)}:${s.preS}:${s.postS}`, 'capture', `capture ${clauses(s.condition)}`);
                break;
        }
    }
    for (const j of form.judge ?? []) add(judgeKey(j), 'judge', j.id);
    return [...out.values()];
}

export interface ItemDiff {
    /** The plan versions compared, older first. */
    from: number;
    to: number;
    common: FormItem[];
    /** In the later form only: its series starts with it. */
    added: FormItem[];
    /** In the earlier form only: its history stays in the runs that had it. */
    removed: FormItem[];
}

/** What changed between the form of an earlier run and that of a later one. */
export function diffForms(a: Form, b: Form): ItemDiff {
    const ia = formItems(a);
    const ib = formItems(b);
    const ka = new Set(ia.map((i) => i.key));
    const kb = new Set(ib.map((i) => i.key));
    return {
        from: a.v,
        to: b.v,
        common: ib.filter((i) => ka.has(i.key)),
        added: ib.filter((i) => !ka.has(i.key)),
        removed: ia.filter((i) => !kb.has(i.key)),
    };
}

/**
 * Whether a channel recorded in a run is a value the form names: a sampled channel (`19:*` stands
 * for every value of block 19) or a RAM read. A block is one round trip, so a run records every
 * value of a block it reads; the ones the form did not name were read on the way, not measured.
 */
export function measures(form: Pick<Form, 'steps'>, channel: string): boolean {
    const block = /^(\d{1,3}):/.exec(channel)?.[1];
    return form.steps.some(
        (s) =>
            (s.kind === 'sample' && s.channels.some((c) => c === channel || (block !== undefined && c === `${block}:*`))) ||
            (s.kind === 'ram' && channel === `ram:${s.address}`),
    );
}

'use client';

import { DataList, DataRow, Pane, Section, humanName } from '@/components/ui';
import { useLang } from '@/lib/i18n';
import { diffForms, type Form, type FormItem } from '@/lib/probe/items';
import type { NotebookEntry } from '@/lib/notebook/rules';
import { useProbeNames } from './names';
import type { ProbeSessions } from './useProbeSessions';

const when = (ms: number) => new Date(ms).toLocaleString();
const day = (ms: number) => new Date(ms).toLocaleDateString();

/**
 * STARTUP — PROBE's sessions (operator, 2026-11-02; TUNER's STARTUP, for the assistant's mode).
 *
 * Every session on the device, newest first: the owner's words that started it, its form's version,
 * how many runs it has taken, and the session it carries on. Choosing one puts it on the screen —
 * the board shows it, PROBE runs it, and the assistant's calls that name no session mean it. NEXT
 * is the hub's ring here, NEW SESSION the sub-action under it.
 */
export function StartupView({ s }: { s: ProbeSessions }) {
    const { t } = useLang();
    const startedOf = new Map(s.sessions.map((x) => [x.id, x.startedAt]));
    return (
        <Pane>
            <Section title={t.startup_sessions} count={s.sessions.length} info={t.startup_info}>
                {s.sessions.length === 0 ? (
                    <p className="py-2 text-xs text-slate-500">{t.startup_empty}</p>
                ) : (
                    <DataList>
                        {s.sessions.map((x) => {
                            const fresh = x.words === null && x.v === null && x.runs === 0;
                            const follows = x.follows ? startedOf.get(x.follows) : undefined;
                            const detail = fresh
                                ? t.startup_freshNote
                                : [
                                      when(x.startedAt),
                                      follows !== undefined ? t.startup_follows(day(follows)) : null,
                                      x.words !== null && !x.standing ? t.startup_ended : null,
                                      x.purpose,
                                  ]
                                      .filter(Boolean)
                                      .join(' · ');
                            return (
                                <DataRow
                                    key={x.id}
                                    selected={x.id === s.current}
                                    onSelect={() => s.open(x.id)}
                                    code={x.v !== null ? `v${x.v}` : '—'}
                                    codeTone={x.id === s.current ? 'primary' : 'neutral'}
                                    name={humanName(x.words ?? t.startup_fresh)}
                                    trailing={<span className="shrink-0 font-mono text-[11px] text-slate-500">{t.startup_runs(x.runs)}</span>}
                                    detail={<p className="truncate text-[11px] text-slate-500">{detail}</p>}
                                />
                            );
                        })}
                    </DataList>
                )}
            </Section>
        </Pane>
    );
}

/** One version of a form in a series, and what it changed from the one before. */
interface SeriesForm {
    record: string;
    v: number;
    added: FormItem[];
    removed: FormItem[];
    /** The judgements of this form and the one before, so a judgement item can be named by what it tests. */
    judges: NonNullable<Form['judge']>;
}

/** The forms written along a series, in order, each with its change from the last one that differed. */
export function seriesForms(entries: readonly NotebookEntry[], series: readonly string[]): SeriesForm[] {
    const out: SeriesForm[] = [];
    let prev: Form | null = null;
    for (const record of series) {
        for (const e of entries) {
            if (e.sessionId !== record || e.body.kind !== 'plan') continue;
            const form: Form = { v: e.body.v, steps: e.body.steps, judge: e.body.judge };
            if (prev && prev.v === form.v) {
                // NEXT copies the form as it was: the same version, nothing changed.
                prev = form;
                continue;
            }
            const d = prev ? diffForms(prev, form) : null;
            out.push({ record, v: form.v, added: d ? d.added : [], removed: d ? d.removed : [], judges: [...(form.judge ?? []), ...(prev?.judge ?? [])] });
            prev = form;
        }
    }
    return out;
}

/**
 * STARTUP's MULTI: the series of the session on the screen — the sessions NEXT linked, oldest first,
 * each with its runs, and where its form's version changed, the items added and removed.
 */
export function StartupViz({ s }: { s: ProbeSessions }) {
    const { t } = useLang();
    const names = useProbeNames();
    if (!s.current || s.series.length === 0) {
        return <p className="text-xs text-slate-600">{t.series_none}</p>;
    }
    const forms = seriesForms(s.entries, s.series);
    const startedOf = new Map(s.sessions.map((x) => [x.id, x.startedAt]));
    return (
        <div className="h-full overflow-y-auto">
            <Section title={t.series} count={s.series.length} info={t.series_info}>
                <DataList>
                    {s.series.map((id) => {
                        const versions = forms.filter((f) => f.record === id);
                        const started = startedOf.get(id);
                        return (
                            <DataRow
                                key={id}
                                selected={id === s.current}
                                onSelect={() => s.open(id)}
                                name={humanName(started !== undefined ? day(started) : id.slice(0, 8))}
                                trailing={<span className="shrink-0 font-mono text-[11px] text-slate-500">{t.startup_runs(s.runsOf(id).length)}</span>}
                                detail={
                                    versions.length > 0 ? (
                                        <div className="space-y-0.5">
                                            {versions.map((f) => (
                                                // Each item by its name; the identifier is its title (UX-09).
                                                <p key={f.v} className="flex flex-wrap items-baseline gap-x-3 text-[11px] text-slate-400">
                                                    <span className="font-mono text-blue-400">v{f.v}</span>
                                                    {f.added.map((a) => {
                                                        const n = names.item(a, f.judges);
                                                        return (
                                                            <span key={`+${a.key}`} className="text-emerald-400" title={n.ident}>
                                                                +{n.name}
                                                            </span>
                                                        );
                                                    })}
                                                    {f.removed.map((r) => {
                                                        const n = names.item(r, f.judges);
                                                        return (
                                                            <span key={`-${r.key}`} className="text-slate-500 line-through" title={n.ident}>
                                                                {n.name}
                                                            </span>
                                                        );
                                                    })}
                                                </p>
                                            ))}
                                        </div>
                                    ) : undefined
                                }
                            />
                        );
                    })}
                </DataList>
            </Section>
        </div>
    );
}

'use client';

import { StartupSeries } from './StartupSeries';
import { diffForms, type Form } from '@tsunagi/monitoring-engine';
import type { NotebookEntry } from '../../lib/notebook/rules';
import type { ProbeSessions } from './useProbeSessions';


export { StartupView } from './StartupList';

/** One version of a form in a series, and what it changed from the one before. */
interface SeriesForm {
    record: string;
    v: number;
    added: string[];
    removed: string[];
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
            out.push({ record, v: form.v, added: d ? d.added.map((i) => i.label) : [], removed: d ? d.removed.map((i) => i.label) : [] });
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
    const forms = seriesForms(s.entries, s.series);
    const startedOf = new Map(s.sessions.map((x) => [x.id, x.startedAt]));
    return <StartupSeries current={s.current} open={s.open} rows={s.series.map(id => ({
        id, started: startedOf.get(id), runs: s.runsOf(id).length, versions: forms.filter(f => f.record === id),
    }))} />;
}

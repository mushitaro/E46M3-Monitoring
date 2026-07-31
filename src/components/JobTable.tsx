'use client';

import { useMemo, useState } from 'react';
import { Play } from 'lucide-react';
import { Chip, Pill, SearchInput, TextButton } from '@/components/ui';
import {
    description,
    execStyle,
    jobPreconditions,
    jobRisk,
    label,
    type CatalogJob,
    type Risk,
} from '@/lib/ecuCatalog';
import { mayRunOnVehicle, type Ledger } from '@/lib/ledger';
import { useLang } from '@/lib/i18n';

/**
 * The job list, shared by the calibration and actuator-test views.
 *
 * Restores what the old app showed — the SGBD's own job names with ja/en labels
 * and comments — with three things it did not have:
 *
 *  - Search. MSS54 alone has 77 actuator tests. Scrolling 77 German-derived
 *    identifiers at 12.5px on a laptop under a lifted car is how the wrong row
 *    gets clicked.
 *  - Per-job risk. The old version gave every calibration `risk: "medium"`, so
 *    ABGLEICHWERTE_LESEN and CODIERDATEN_SCHREIBEN looked identical.
 *  - The German original beside the translation, always. The ja/en are machine
 *    translations and at least one shipped wrong: DSC's STEUERN_DIGITAL renders
 *    as "デジタル / Digital" for a job that drives eight solenoids and a pump.
 */
export function JobTable({
    jobs,
    ledger,
    ecuId,
    connectedToVehicle,
}: {
    jobs: CatalogJob[];
    ledger: Ledger;
    ecuId: string;
    connectedToVehicle: boolean;
}) {
    const { lang, t } = useLang();
    const [query, setQuery] = useState('');
    const [riskFilter, setRiskFilter] = useState<Risk | 'all'>('all');

    const rows = useMemo(() => {
        const q = query.trim().toLowerCase();
        return jobs
            .map((job) => {
                const risk = jobRisk(job.id);
                const gate = mayRunOnVehicle(ledger, `${ecuId}:${job.id}`);
                return { job, risk, gate, d: description(job, lang) };
            })
            .filter(({ job, risk, d }) => {
                if (riskFilter !== 'all' && risk !== riskFilter) return false;
                if (!q) return true;
                return (
                    job.id.toLowerCase().includes(q) ||
                    label(job, lang).toLowerCase().includes(q) ||
                    d.original.toLowerCase().includes(q)
                );
            });
    }, [jobs, ledger, ecuId, lang, query, riskFilter]);

    if (jobs.length === 0) return <p className="py-2 font-mono text-xs uppercase text-slate-600">{t.awaiting_catalog}</p>;

    return (
        <>
            {/* The field is capped, not stretched. Given a 900px column, flex-1
                made it the single largest object on screen — a grey slab that
                says nothing — while the filters it belongs with got pushed to
                the far edge, half a metre from the text they filter. */}
            <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                <SearchInput value={query} onChange={setQuery} placeholder={t.search} className="w-full max-w-[340px]" />
                <div className="flex items-center gap-1">
                    {(['all', 'high', 'medium', 'low'] as const).map((r) => (
                        <Chip key={r} active={riskFilter === r} onClick={() => setRiskFilter(r)}>
                            {r === 'all'
                                ? t.risk_all
                                : r === 'high'
                                  ? t.risk_high
                                  : r === 'medium'
                                    ? t.risk_medium
                                    : t.risk_low}
                        </Chip>
                    ))}
                </div>
                <span className="ml-auto shrink-0 font-mono text-[11px] text-slate-600">
                    {rows.length} / {jobs.length}
                </span>
            </div>

            {/* Rows are separated by a hairline and hover, not by a box each. At
                77 rows, an outline per row plus the pills and the run control
                inside it stacks four frames deep and the eye stops resolving the
                one thing that matters — which row is under the pointer. */}
            {/* Flush with the pane's own padding. Bleeding the rows out by 8px
                to widen the hover band left every divider sticking out past the
                search field and the labels above them, which reads as broken
                alignment — a worse cost than a hover band that stops at the
                text. */}
            <ul className="divide-y divide-slate-800/50 border-t border-slate-800/50">
                {rows.map(({ job, risk, gate, d }) => (
                    <li key={job.id} className="group py-2 transition-colors hover:bg-slate-800/40">
                        <div className="flex items-baseline gap-x-3">
                            <RiskPill risk={risk} />
                            <span className="font-mono text-xs text-slate-200">{job.id}</span>
                            <span className="min-w-0 flex-1 truncate text-xs text-slate-400">{label(job, lang)}</span>
                            {job.catJa && (
                                <span className="hidden shrink-0 text-[10px] uppercase tracking-widest text-slate-600 min-[1100px]:inline">
                                    {lang === 'en' ? job.catEn : job.catJa}
                                </span>
                            )}
                            <GateBadge allowed={gate.allowed} reason={gate.reason} />
                        </div>

                        {d.text && <p className="mt-1 text-[11px] text-slate-400">{d.text}</p>}
                        {/* slate-500, not slate-700. slate-700 is #2A2A33 —
                            1.48:1 on black, a BORDER colour. The German original
                            is the one line this component's own docstring calls
                            non-negotiable (at least one translation shipped
                            wrong), and it was rendering as blank space. */}
                        {d.original && d.original !== d.text && (
                            <p className="mt-0.5 font-mono text-[10px] text-slate-500">{d.original}</p>
                        )}

                        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                                {execStyle(job)}
                            </span>
                            {jobPreconditions(job.id).map((c) => (
                                <span key={c} className="text-[10px] text-slate-500">
                                    {t[`precond_${c}` as keyof typeof t] as string}
                                </span>
                            ))}
                            {(job.args ?? []).length > 0 && (
                                <span className="font-mono text-[10px] text-amber-400">
                                    {t.args_required((job.args ?? []).map((a) => a.name).join(', '))}
                                </span>
                            )}
                            <span className="ml-auto">
                                <TextButton
                                    disabled
                                    tone={risk === 'high' ? 'danger' : 'primary'}
                                    Icon={Play}
                                    title={connectedToVehicle ? gate.reason : t.gate_practiceOnly}
                                >
                                    {t.run}
                                </TextButton>
                            </span>
                        </div>
                    </li>
                ))}
            </ul>
        </>
    );
}

function RiskPill({ risk }: { risk: Risk }) {
    const { t } = useLang();
    return (
        <Pill tone={risk === 'high' ? 'danger' : risk === 'medium' ? 'caution' : 'neutral'}>
            {risk === 'high' ? t.risk_high : risk === 'medium' ? t.risk_medium : t.risk_low}
        </Pill>
    );
}

/**
 * Default-deny, stated on every row.
 *
 * Everything is a candidate right now, so every badge reads "unverified". That
 * is the honest state and it is stronger than the old app's arrangement, which
 * hardcoded one boolean for all 131 jobs and could only ever be flipped for all
 * of them at once.
 *
 * Unverified is deliberately the QUIET one — plain muted text, no chip. It is
 * the state of every row today, and a tint on all 77 of them would be a wall of
 * colour saying nothing. Verified is what will stand out, once anything is.
 */
function GateBadge({ allowed, reason }: { allowed: boolean; reason: string }) {
    const { t } = useLang();
    if (!allowed) {
        return (
            <span title={reason} className="shrink-0 text-[9px] font-bold uppercase tracking-widest text-slate-600">
                {t.gate_unverified}
            </span>
        );
    }
    return (
        <Pill tone="ok" title={reason}>
            {t.gate_verified}
        </Pill>
    );
}

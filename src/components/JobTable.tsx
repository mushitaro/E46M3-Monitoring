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
    emptyLabel,
}: {
    jobs: CatalogJob[];
    ledger: Ledger;
    ecuId: string;
    connectedToVehicle: boolean;
    emptyLabel: string;
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

    if (jobs.length === 0) return <p className="text-xs text-slate-600">{emptyLabel}</p>;

    return (
        <>
            <div className="mb-3 flex flex-wrap items-center gap-2">
                <SearchInput value={query} onChange={setQuery} placeholder={t.search} className="min-w-40 flex-1" />
                {(['all', 'high', 'medium', 'low'] as const).map((r) => (
                    <Chip key={r} active={riskFilter === r} onClick={() => setRiskFilter(r)}>
                        {r === 'all' ? t.risk_all : r === 'high' ? t.risk_high : r === 'medium' ? t.risk_medium : t.risk_low}
                    </Chip>
                ))}
                <span className="ml-auto font-mono text-[11px] text-slate-600">
                    {rows.length} / {jobs.length}
                </span>
            </div>

            {/* Rows are separated by a hairline and hover, not by a box each. At
                77 rows, an outline per row plus the pills and the run control
                inside it stacks four frames deep and the eye stops resolving the
                one thing that matters — which row is under the pointer. */}
            {/* The negative margin is on the LIST, not the row: the hover band
                has to be wider than the text, and if only the rows bleed out then
                the list's own top rule stops 8px short of every divider below it. */}
            <ul className="-mx-2 divide-y divide-slate-800/60 border-t border-slate-800/60">
                {rows.map(({ job, risk, gate, d }) => (
                    <li key={job.id} className="group px-2 py-2 transition-colors hover:bg-slate-800/40">
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

                        {d.text && <p className="mt-1 text-[11px] text-slate-500">{d.text}</p>}
                        {d.original && d.original !== d.text && (
                            <p className="mt-0.5 font-mono text-[10px] text-slate-700">{d.original}</p>
                        )}

                        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                            <span className="font-mono text-[10px] uppercase tracking-widest text-slate-700">
                                {execStyle(job)}
                            </span>
                            {jobPreconditions(job.id).map((c) => (
                                <span key={c} className="font-mono text-[10px] text-slate-700">
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

'use client';

import { useMemo, useState } from 'react';
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
                <input
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={t.search}
                    className="min-w-40 flex-1 border border-slate-700 bg-slate-800 px-2 py-1 font-mono text-xs text-slate-200 placeholder:text-slate-600 focus:border-blue-500 focus:outline-none"
                />
                {(['all', 'high', 'medium', 'low'] as const).map((r) => (
                    <button
                        key={r}
                        type="button"
                        onClick={() => setRiskFilter(r)}
                        aria-pressed={riskFilter === r}
                        className={`border px-2 py-1 font-mono text-[10px] uppercase tracking-widest ${
                            riskFilter === r
                                ? 'border-blue-500 text-blue-400'
                                : 'border-slate-700 text-slate-500 hover:text-slate-300'
                        }`}
                    >
                        {r === 'all' ? t.risk_all : r === 'high' ? t.risk_high : r === 'medium' ? t.risk_medium : t.risk_low}
                    </button>
                ))}
                <span className="ml-auto font-mono text-[11px] text-slate-600">
                    {rows.length} / {jobs.length}
                </span>
            </div>

            <ul className="space-y-1">
                {rows.map(({ job, risk, gate, d }) => (
                    <li key={job.id} className="border border-slate-800 p-2">
                        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                            <RiskPill risk={risk} />
                            <span className="font-mono text-xs text-slate-200">{job.id}</span>
                            <span className="text-xs text-slate-400">{label(job, lang)}</span>
                            {job.catJa && (
                                <span className="text-[10px] uppercase tracking-widest text-slate-600">
                                    {lang === 'en' ? job.catEn : job.catJa}
                                </span>
                            )}
                            <span className="ml-auto">
                                <GateBadge allowed={gate.allowed} reason={gate.reason} />
                            </span>
                        </div>

                        {d.text && <p className="mt-1 text-[11px] text-slate-500">{d.text}</p>}
                        {d.original && d.original !== d.text && (
                            <p className="mt-0.5 font-mono text-[10px] text-slate-700">{d.original}</p>
                        )}

                        <div className="mt-1.5 flex flex-wrap items-center gap-2">
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
                            <button
                                type="button"
                                disabled
                                title={connectedToVehicle ? gate.reason : t.gate_practiceOnly}
                                className="ml-auto cursor-not-allowed border border-slate-800 px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-slate-700"
                            >
                                {t.run}
                            </button>
                        </div>
                    </li>
                ))}
            </ul>
        </>
    );
}

function RiskPill({ risk }: { risk: Risk }) {
    const { t } = useLang();
    const cls =
        risk === 'high'
            ? 'border-red-500/50 text-red-400'
            : risk === 'medium'
              ? 'border-amber-500/50 text-amber-400'
              : 'border-slate-700 text-slate-500';
    return (
        <span className={`border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-widest ${cls}`}>
            {risk === 'high' ? t.risk_high : risk === 'medium' ? t.risk_medium : t.risk_low}
        </span>
    );
}

/**
 * Default-deny, stated on every row.
 *
 * Everything is a candidate right now, so every badge reads "unverified". That
 * is the honest state and it is stronger than the old app's arrangement, which
 * hardcoded one boolean for all 131 jobs and could only ever be flipped for all
 * of them at once.
 */
function GateBadge({ allowed, reason }: { allowed: boolean; reason: string }) {
    const { t } = useLang();
    return (
        <span
            title={reason}
            className={`border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-widest ${
                allowed ? 'border-emerald-500/50 text-emerald-400' : 'border-slate-700 text-slate-600'
            }`}
        >
            {allowed ? t.gate_verified : t.gate_unverified}
        </span>
    );
}

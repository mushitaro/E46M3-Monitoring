'use client';

import { useEffect, useMemo, useState } from 'react';
import { DataList, DataRow, LABEL, Section } from '../../components/ui';
import { adjustmentJobs, adjustmentStatus, type AdjustmentStatus } from '../../lib/adjustments';
import { cautionFor, loadJobText, type JobTextTable } from '../../lib/jobText';
import { useLang } from '../../lib/i18n';
import { label, type EcuProfile, type Ledger, type Motion } from '@tsunagi/monitoring-engine';

/**
 * A module's zero-point adjustments (the steering angle sensor's, the DSC sensors'), with what each
 * asks of the car and whether it may run here — and when not, why, in the owner's words (U2). Where
 * the reason is outside the app (a write into another module, a job BMW's runner sends nothing for),
 * it says that and where the job can be done instead.
 */
export function Adjustments({ catalog, ecuId, address, ledger, motion }: { catalog: EcuProfile | null; ecuId: string; address: number | null; ledger: Ledger; motion: Motion }) {
    const { t, lang } = useLang();
    const jobs = useMemo(() => adjustmentJobs(catalog), [catalog]);
    const [status, setStatus] = useState<Record<string, AdjustmentStatus>>({});
    const [text, setText] = useState<JobTextTable | null>(null);
    useEffect(() => {
        if (jobs.length === 0 || address === null) return;
        let live = true;
        void (async () => {
            const table = await loadJobText(ecuId).catch(() => null);
            const out: Record<string, AdjustmentStatus> = {};
            for (const j of jobs) out[j.id] = await adjustmentStatus(ecuId, address, j, ledger, motion).catch((e) => ({ kind: 'notAgreed', why: String(e) }) as const);
            if (!live) return;
            setText(table);
            setStatus(out);
        })();
        return () => {
            live = false;
        };
    }, [jobs, ecuId, address, ledger, motion]);
    if (jobs.length === 0) return null;
    const pre = (p: string) => (t as unknown as Record<string, string | undefined>)[`precond_${p}`] ?? p;
    const why = (s: AdjustmentStatus | undefined): string => {
        if (!s) return t.awaiting_read;
        switch (s.kind) {
            case 'gate':
                return s.verdict.allowed ? t.adjust_runnable : t.runBlock[s.verdict.reason];
            case 'otherModule':
                return s.write ? t.adjust_otherWrite(s.module ?? '?', `0x${s.address.toString(16).toUpperCase()}`, s.write) : t.adjust_otherModule(s.module ?? '?', `0x${s.address.toString(16).toUpperCase()}`);
            case 'sendsNothing':
                return t.adjust_sendsNothing;
            case 'notAgreed':
                return t.adjust_notAgreed;
        }
    };
    return (
        <Section title={t.adjust_title} count={jobs.length}>
            <DataList>
                {jobs.map((j) => {
                    const s = status[j.id];
                    const caution = cautionFor(text, j.id, lang);
                    return (
                        <DataRow
                            key={j.id}
                            name={label(j, lang)}
                            ident={j.id}
                            trailing={<span className={`shrink-0 ${LABEL} ${s?.kind === 'gate' && s.verdict.allowed ? 'text-emerald-400' : 'text-slate-600'}`}>{s?.kind === 'gate' && s.verdict.allowed ? t.adjust_ok : t.adjust_notHere}</span>}
                            detail={
                                <>
                                    <p className="text-[11px] text-slate-400">{t.adjust_pre([...j.preconditions.map(pre), ...(caution ? [caution] : [])].join(' · '))}</p>
                                    <p className="text-[11px] leading-relaxed text-slate-500">{why(s)}</p>
                                </>
                            }
                        />
                    );
                })}
            </DataList>
        </Section>
    );
}

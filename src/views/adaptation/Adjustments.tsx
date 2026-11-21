'use client';

import { useEffect, useMemo, useState } from 'react';
import { DataList, DataRow, LABEL, Section, humanName } from '@/components/ui';
import { SentenceTag } from '@/views/shared/RunReason';
import { adjustmentJobs, adjustmentStatus, type AdjustmentStatus } from '@/lib/adjustments';
import { cautionFor, loadJobText, type JobTextTable } from '@/lib/jobText';
import { useLang } from '@/lib/i18n';
import { label, type ActuationMode, type EcuProfile, type Ledger, type Motion } from '@tsunagi/monitoring-engine';

/**
 * A module's zero-point adjustments (the steering angle sensor's, the DSC sensors'), with what each
 * asks of the car and whether it may run here — and when not, why, in the owner's words (U2). Where
 * the reason is outside the app (a write into another module, a job BMW's runner sends nothing for),
 * it says that and where the job can be done instead.
 *
 * A row is its name, what it needs, and one tag (UX-31): the reason's sentence is the tag's, said when
 * the tag is touched (as ACTUATOR's are), and the section's ⓘ says what the tags are. Three lines of
 * paragraph under every row said the same two sentences four times.
 */
export function Adjustments({
    catalog,
    ecuId,
    address,
    ledger,
    motion,
    mode = 'vehicle',
}: {
    catalog: EcuProfile | null;
    ecuId: string;
    address: number | null;
    ledger: Ledger;
    motion: Motion;
    /** The link's: on the practice car a row answers as SERVICE's hub does there. */
    mode?: ActuationMode;
}) {
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
            for (const j of jobs) out[j.id] = await adjustmentStatus(ecuId, address, j, ledger, motion, mode).catch((e) => ({ kind: 'notAgreed', why: String(e) }) as const);
            if (!live) return;
            setText(table);
            setStatus(out);
        })();
        return () => {
            live = false;
        };
    }, [jobs, ecuId, address, ledger, motion, mode]);
    // Two rows of one module can carry the same catalogue name (DSC_E46: two 「デフォルト初期化ジョブ」).
    // Then each says which sensor its own job name names; nothing is guessed past those words.
    const names = useMemo(() => {
        const base = new Map(jobs.map((j) => [j.id, label(j, lang) as string]));
        const seen = new Map<string, number>();
        for (const n of base.values()) seen.set(n, (seen.get(n) ?? 0) + 1);
        return new Map(
            jobs.map((j) => {
                const n = base.get(j.id) ?? j.id;
                if ((seen.get(n) ?? 0) < 2) return [j.id, n] as const;
                // The table's order is most specific first (LWS_AQ_SENSOREN before LWS).
                const key = Object.keys(t.adjust_target).find((k) => j.id.includes(k));
                return [j.id, key ? `${n}（${t.adjust_target[key]}）` : n] as const;
            }),
        );
    }, [jobs, lang, t]);
    if (jobs.length === 0) return null;
    const pre = (p: string) => (t as unknown as Record<string, string | undefined>)[`precond_${p}`] ?? p;
    const tagOf = (s: AdjustmentStatus | undefined): { word: string; sentence: string; ok: boolean } | null => {
        if (!s) return null;
        const hex = (n: number) => `0x${n.toString(16).toUpperCase()}`;
        switch (s.kind) {
            case 'gate':
                return s.verdict.allowed
                    ? { word: t.adjust_tag.ok, sentence: t.adjust_runnable, ok: true }
                    : { word: t.runBlockShort[s.verdict.reason], sentence: t.runBlock[s.verdict.reason], ok: false };
            case 'otherModule':
                return s.write
                    ? { word: t.adjust_tag.otherWrite, sentence: t.adjust_otherWrite(s.module ?? '?', hex(s.address), s.write), ok: false }
                    : { word: t.adjust_tag.otherModule, sentence: t.adjust_otherModule(s.module ?? '?', hex(s.address)), ok: false };
            case 'sendsNothing':
                return { word: t.adjust_tag.sendsNothing, sentence: t.adjust_sendsNothing, ok: false };
            case 'notAgreed':
                return { word: t.adjust_tag.notAgreed, sentence: t.adjust_notAgreed, ok: false };
        }
    };
    return (
        <Section title={t.adjust_title} count={jobs.length} info={t.adjust_info}>
            <DataList>
                {jobs.map((j) => {
                    const s = status[j.id];
                    const tag = tagOf(s);
                    const caution = cautionFor(text, j.id, lang);
                    return (
                        <DataRow
                            key={j.id}
                            name={humanName(names.get(j.id) ?? j.id)}
                            ident={j.id}
                            trailing={
                                tag ? (
                                    <SentenceTag word={tag.word} sentence={tag.sentence} tone={tag.ok ? 'ok' : 'neutral'} />
                                ) : (
                                    <span className={`shrink-0 ${LABEL} text-slate-600`}>{t.awaiting_read}</span>
                                )
                            }
                            detail={<p className="text-[11px] text-slate-400">{t.adjust_pre([...j.preconditions.map(pre), ...(caution ? [caution] : [])].join(' · '))}</p>}
                        />
                    );
                })}
            </DataList>
        </Section>
    );
}

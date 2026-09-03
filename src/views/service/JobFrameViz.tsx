'use client';

import { Field, LABEL, MicroLabel, Pill } from '@/components/ui';
import type { CatalogJob } from '@/lib/ecuCatalog';
import { useLang } from '@/lib/i18n';
import { telegramBytes, type RunVerdict } from '@/lib/runGate';
import type { Telegram } from '@/lib/telegrams';

/**
 * The focused job, at a glance and from a distance.
 *
 * This is what the visualization region is FOR. It had become a scrolling
 * document — 820px of prose in a 388px window, with the frame that would go out
 * and the reason it will not both below the fold, which is the two things the
 * operator is actually looking for. Measured, not guessed.
 *
 * So the region opens with the answers, and the reference reading follows
 * underneath:
 *
 *   1. WHAT GOES OUT — the frame, byte by byte, with each byte's role beneath
 *      it. A DS2 request is four to twenty bytes and its shape IS the visual:
 *      you can see how long it is, which byte is the command, and — the part a
 *      hex string cannot show — which bytes are this job's arguments.
 *   2. WILL IT GO — one line, in the colour of the answer.
 *   3. WHAT COMES BACK — the count, not the table. The table is reference.
 *
 * Nothing here is new information. It is the same telegram, the same verdict
 * from the same `mayRun` call the hub reads, and the same result list. What
 * changed is which of it you see without scrolling.
 */
export function JobFrameViz({
    job,
    telegram,
    verdict,
}: {
    job: CatalogJob;
    telegram: Telegram | null;
    /** The gate's answer — the hub's answer, not a second opinion. */
    verdict: RunVerdict | null;
}) {
    const { t } = useLang();
    const bytes = telegram ? telegramBytes(telegram.hex) : null;
    // `single` is the only grade `mayRun` treats as this job's own frame.
    const certain = telegram?.confidence === 'single';

    return (
        <div className="flex flex-col gap-3">
            <div>
                <div className="flex items-baseline justify-between gap-2">
                    <MicroLabel>{t.plan_telegram}</MicroLabel>
                    {telegram && (
                        <Pill tone={certain ? 'ok' : 'caution'} title={t.confidenceNote[telegram.confidence]}>
                            {t.confidence[telegram.confidence]}
                        </Pill>
                    )}
                </div>

                {bytes ? (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                        {[...bytes].map((b, i) => (
                            <ByteCell
                                key={i}
                                value={b}
                                role={roleOf(i, bytes.length, job)}
                                tone={toneOf(i, bytes.length, certain)}
                            />
                        ))}
                    </div>
                ) : (
                    <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">{t.plan_noTelegram}</p>
                )}
            </div>

            {/* The verdict, where the eye lands — not eight sections down. */}
            {verdict && (
                <div
                    className={`border-l-2 pl-2.5 ${
                        verdict.allowed ? 'border-blue-500/60' : 'border-slate-700'
                    }`}
                >
                    <p className={`${LABEL} ${verdict.allowed ? 'text-blue-400' : 'text-slate-500'}`}>
                        {verdict.allowed ? t.viz_willSend : t.viz_wontSend}
                    </p>
                    {!verdict.allowed && (
                        <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">
                            {t.runBlock[verdict.reason]}
                        </p>
                    )}
                </div>
            )}

            <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
                <Field label={t.viz_response} value={job.results.length} />
                {job.args.length > 0 && (
                    <Field label={t.det_args} value={job.args.length} tone="text-amber-400" />
                )}
            </div>
        </div>
    );
}

/**
 * One byte, and what it is.
 *
 * `tabular-nums` and a fixed width so the row reads as a frame rather than as
 * text: the cells line up, and a two-byte payload is visibly two cells wide.
 */
function ByteCell({ value, role, tone }: { value: number; role: string; tone: string }) {
    return (
        <span className="flex flex-col items-center">
            <span className={`rounded-sm px-1.5 py-1 font-mono text-[11px] tabular-nums ${tone}`}>
                {value.toString(16).padStart(2, '0')}
            </span>
            <span className="mt-0.5 max-w-[6ch] truncate font-mono text-[8px] uppercase text-slate-600" title={role}>
                {role}
            </span>
        </span>
    );
}

/**
 * What each position in a DS2 request is.
 *
 * `[addr][len][cmd][…payload…][checksum]`. The payload bytes take the names of
 * the job's declared arguments WHEN the counts agree — the same corroboration
 * `lib/argFrame` requires before it will fill them in. When they do not agree,
 * the bytes are unlabelled rather than labelled with a guess: a payload byte
 * wearing an argument's name it might not hold is worse than an unnamed one.
 */
function roleOf(i: number, len: number, job: CatalogJob): string {
    if (i === 0) return 'addr';
    if (i === 1) return 'len';
    if (i === 2) return 'cmd';
    if (i === len - 1) return 'ck';
    const payloadIndex = i - 3;
    const payloadLen = len - 4;
    if (job.args.length === payloadLen) return job.args[payloadIndex].name.toLowerCase();
    return '';
}

function toneOf(i: number, len: number, certain: boolean): string {
    // The command byte is the one that decides whether this reads or writes, so
    // it is the one that carries colour. Everything else is frame furniture.
    if (i === 2) return certain ? 'bg-blue-500/15 text-blue-300' : 'bg-slate-800 text-slate-400';
    if (i === 0 || i === 1 || i === len - 1) return 'bg-slate-900 text-slate-500';
    return 'bg-slate-800 text-slate-300';
}

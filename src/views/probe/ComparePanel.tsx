'use client';
import { DataList, DataRow, Pill, humanName } from '../../components/ui';
import { useLang } from '../../lib/i18n';

interface Item { key: string; label: string }
type Judgement = { value: number | null; pass: boolean | null } | null;

export interface ComparedValues {
    channels: { channel: string; a: { mean: number | null } | null; b: { mean: number | null } | null; delta: number | null }[];
    judges: { id: string; a: Judgement; b: Judgement }[];
    items: { added: Item[]; removed: Item[]; from: number; to: number } | null;
}

const num = (v: number | null | undefined) => v == null ? '—' : String(Math.round(v * 100) / 100);

export function ComparePanel({ before, after, values: c }: { before: string; after: string; values: ComparedValues }) {
    const { t } = useLang();
    return (
                <div className="space-y-2">
                    <p className="font-mono text-[11px] text-slate-500">
                        {t.compare_runs(before, after)}
                        {' · '}
                        {t.compare_common(c.channels.length + c.judges.length)}
                    </p>
                    <DataList>
                        {c.channels.map((x) => (
                            <DataRow
                                key={x.channel}
                                name={humanName('')}
                                ident={x.channel}
                                trailing={
                                    <span className="shrink-0 font-mono text-[11px] tabular-nums text-slate-300">
                                        {num(x.a?.mean)} → {num(x.b?.mean)}
                                        <span className={`ml-2 ${x.delta ? 'text-amber-400' : 'text-slate-600'}`}>
                                            {x.delta !== null && x.delta > 0 ? '+' : ''}
                                            {num(x.delta)}
                                        </span>
                                    </span>
                                }
                            />
                        ))}
                        {c.judges.map((j) => (
                            <DataRow
                                key={`j-${j.id}`}
                                name={humanName('')}
                                ident={j.id}
                                trailing={
                                    <span className="shrink-0 font-mono text-[11px] tabular-nums text-slate-300">
                                        {num(j.a?.value)} → {num(j.b?.value)}
                                        <span className="ml-2">{j.b?.pass === null || j.b === null ? '—' : j.b.pass ? t.pass : t.fail}</span>
                                    </span>
                                }
                            />
                        ))}
                        {c.items?.added.map((i) => (
                            <DataRow
                                key={`+${i.key}`}
                                leading={<Pill tone="ok">{t.item_added}</Pill>}
                                name={humanName('')}
                                ident={i.label}
                                trailing={<span className="shrink-0 text-[11px] text-slate-500">{t.item_since(c.items!.to)}</span>}
                            />
                        ))}
                        {c.items?.removed.map((i) => (
                            <DataRow
                                key={`-${i.key}`}
                                leading={<Pill>{t.item_removed}</Pill>}
                                name={humanName('')}
                                ident={i.label}
                                trailing={<span className="shrink-0 text-[11px] text-slate-500">{t.item_until(c.items!.to)}</span>}
                            />
                        ))}
                    </DataList>
                </div>
            );
}

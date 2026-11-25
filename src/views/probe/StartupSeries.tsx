'use client';
import { DataList, DataRow, Section, humanName } from '../../components/ui';
import { useLang } from '../../lib/i18n';

interface SeriesRow {
    id: string;
    started?: number;
    runs: number;
    versions: { v: number; added: string[]; removed: string[] }[];
}

const day = (ms: number) => new Date(ms).toLocaleDateString();

export function StartupSeries({ current, rows, open }: { current: string | null; rows: SeriesRow[]; open(id: string): void }) {
    const { t } = useLang();
    if (!current || !rows.length) return <p className="text-xs text-slate-600">{t.series_none}</p>;
    return (
        <div className="h-full overflow-y-auto">
            <Section title={t.series} count={rows.length} info={t.series_info}>
                <DataList>
                    {rows.map(({ id, started, runs, versions }) => {
                        return (
                            <DataRow
                                key={id}
                                selected={id === current}
                                onSelect={() => open(id)}
                                name={humanName(started !== undefined ? day(started) : id.slice(0, 8))}
                                trailing={<span className="shrink-0 font-mono text-[11px] text-slate-500">{t.startup_runs(runs)}</span>}
                                detail={
                                    versions.length > 0 ? (
                                        <div className="space-y-0.5">
                                            {versions.map((f) => (
                                                <p key={f.v} className="font-mono text-[11px] text-slate-400">
                                                    <span className="text-blue-400">v{f.v}</span>
                                                    {f.added.map((a) => (
                                                        <span key={`+${a}`} className="ml-2 text-emerald-400">
                                                            +{a}
                                                        </span>
                                                    ))}
                                                    {f.removed.map((r) => (
                                                        <span key={`-${r}`} className="ml-2 text-slate-500 line-through">
                                                            {r}
                                                        </span>
                                                    ))}
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

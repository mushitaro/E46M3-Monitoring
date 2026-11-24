'use client';
import { Section } from '../../components/ui';
import { useLang } from '../../lib/i18n';

export const VIEWER_ROWS = 200;

export function SavedValues({ header, rows, count, total }: { header: string[]; rows: string[][]; count: number; total: number }) {
    const { t } = useLang();
    return (
        <Section
            title={t.viewer_datalog}
            count={count}
            note={t.viewer_rows(Math.min(VIEWER_ROWS, total), total)}
        >
            {/* Scrolls sideways only: the pane already scrolls down, and a second vertical
                scroller inside it would trap the wheel. */}
            <div className="overflow-x-auto">
                <table className="font-mono text-[11px] tabular-nums text-slate-300">
                    <thead>
                        <tr className="text-left text-slate-500">
                            {header.map((h) => (
                                <th key={h} className="whitespace-nowrap px-2 py-1 font-normal">
                                    {h}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {rows.slice(0, VIEWER_ROWS).map((r, i) => (
                            <tr key={i} className="border-t border-slate-800/50">
                                {r.map((c, j) => (
                                    <td key={j} className="whitespace-nowrap px-2 py-0.5 text-right">
                                        {c}
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </Section>
    );
}

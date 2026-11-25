'use client';

import { DataList, DataRow, Pane, Section, humanName } from '../../components/ui';
import { useLang } from '../../lib/i18n';

const when = (ms: number) => new Date(ms).toLocaleString();
const day = (ms: number) => new Date(ms).toLocaleDateString();

/**
 * STARTUP — PROBE's sessions (operator, 2026-11-02; TUNER's STARTUP, for the assistant's mode).
 *
 * Every session on the device, newest first: the owner's words that started it, its form's version,
 * how many runs it has taken, and the session it carries on. Choosing one puts it on the screen —
 * the board shows it, PROBE runs it, and the assistant's calls that name no session mean it. NEW
 * SESSION and NEXT are in the sub-action row under the hub.
 */
interface StartupRow {
    id: string;
    words: string | null;
    v: number | null;
    runs: number;
    startedAt: number;
    follows: string | null;
    purpose: string | null;
    standing: boolean | null;
}

export function StartupView({ s }: { s: { sessions: readonly StartupRow[]; current: string | null; open: (id: string) => void } }) {
    const { t } = useLang();
    const startedOf = new Map(s.sessions.map((x) => [x.id, x.startedAt]));
    return (
        <Pane>
            <Section title={t.startup_sessions} count={s.sessions.length} info={t.startup_info}>
                {s.sessions.length === 0 ? (
                    <p className="py-2 text-xs text-slate-500">{t.startup_empty}</p>
                ) : (
                    <DataList>
                        {s.sessions.map((x) => {
                            const fresh = x.words === null && x.v === null && x.runs === 0;
                            const follows = x.follows ? startedOf.get(x.follows) : undefined;
                            const detail = fresh
                                ? t.startup_freshNote
                                : [
                                      when(x.startedAt),
                                      follows !== undefined ? t.startup_follows(day(follows)) : null,
                                      x.words !== null && x.standing === false ? t.startup_ended : null,
                                      x.purpose,
                                  ]
                                      .filter(Boolean)
                                      .join(' · ');
                            return (
                                <DataRow
                                    key={x.id}
                                    selected={x.id === s.current}
                                    onSelect={() => s.open(x.id)}
                                    code={x.v !== null ? `v${x.v}` : '—'}
                                    codeTone={x.id === s.current ? 'primary' : 'neutral'}
                                    name={humanName(x.words ?? t.startup_fresh)}
                                    trailing={<span className="shrink-0 font-mono text-[11px] text-slate-500">{t.startup_runs(x.runs)}</span>}
                                    detail={<p className="truncate text-[11px] text-slate-500">{detail}</p>}
                                />
                            );
                        })}
                    </DataList>
                )}
            </Section>
        </Pane>
    );
}

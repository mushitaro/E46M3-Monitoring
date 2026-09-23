'use client';

import { memo, useState } from 'react';
import { ArrowLeft, CloudDownload, CloudUpload, Eye, LogIn, Save, Trash2 } from 'lucide-react';
import { formatErrorCode } from '@tsunagi/ds2-mss54';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { DataList, DataRow, Field, Pane, Pill, Section, TextButton, Well, humanName } from '@/components/ui';
import { normCode } from '@/lib/faultCode';
import { useLang } from '@/lib/i18n';
import { text as resolveText, type EcuProfile } from '@/lib/ecuCatalog';
import { needsSync, parseCsv, summarise, type SavedSession } from '@/lib/sync/session';
import { CountReadout } from '@/views/shared/CountReadout';
import type { Sessions } from './useSessions';

/** Rows of a saved datalog the viewer draws. The CSV keeps every row; the screen does not need to. */
const VIEWER_ROWS = 200;

const NOTICE_TONE = {
    info: 'text-slate-400',
    ok: 'text-emerald-400',
    warn: 'text-amber-400',
    error: 'text-red-400',
} as const;

type Confirm =
    | { kind: 'local'; id: string; label: string; synced: boolean }
    | { kind: 'cloud'; id: string; label: string }
    | { kind: 'diag'; id: string }
    | { kind: 'reauth' };

const when = (ms: number) => new Date(ms).toLocaleString();
const kb = (bytes: number) => `${(bytes / 1024).toFixed(bytes < 10_240 ? 1 : 0)} KB`;

/**
 * SESSIONS — this connection's SAVE and SYNC, the sessions on this device, the account's copies,
 * and the error records the preview sent by itself. A read-only viewer opens a saved session in
 * place of the lists.
 *
 * Preview only (lib/features.ts `sessionSync`). Every account surface is also gated on
 * `cloudEnabled`, which is false on the dev server: there the tab says it has nowhere to send, in
 * the place SYNC would be, instead of offering a button that cannot work.
 */
export const SessionsView = memo(function SessionsView({
    sessions: s,
    catalog,
    ecuId,
}: {
    sessions: Sessions;
    /** The loaded module's catalogue, used to name a saved fault when the session is for the same module. */
    catalog: EcuProfile | null;
    ecuId: string;
}) {
    const { t } = useLang();
    const [viewing, setViewing] = useState<string | null>(null);
    const [confirm, setConfirm] = useState<Confirm | null>(null);
    const viewed = viewing ? (s.local ?? []).find((x) => x.id === viewing) : undefined;
    const busy = s.busy !== null;

    const account =
        !s.cloudEnabled || s.gate === null
            ? null
            : s.gate.state === 'active'
              ? t.sessions_account(s.gate.label || '—')
              : s.gate.state === 'expired'
                ? t.sessions_account_expired
                : t.sessions_account_unknown;

    const dialog = confirm && (
        <ConfirmDialog
            title={
                confirm.kind === 'local'
                    ? t.sessions_deleteLocal_title
                    : confirm.kind === 'cloud'
                      ? t.sessions_deleteCloud_title
                      : confirm.kind === 'diag'
                        ? t.sessions_deleteError_title
                        : t.reauth_title
            }
            consequence={
                confirm.kind === 'local'
                    ? t.sessions_deleteLocal_consequence(confirm.label, confirm.synced)
                    : confirm.kind === 'cloud'
                      ? t.sessions_deleteCloud_consequence(confirm.label)
                      : confirm.kind === 'diag'
                        ? t.sessions_deleteError_consequence
                        : t.reauth_consequence
            }
            confirmLabel={confirm.kind === 'reauth' ? t.reauth_confirm : t.sessions_delete_confirm}
            onCancel={() => setConfirm(null)}
            onConfirm={() => {
                setConfirm(null);
                if (confirm.kind === 'local') {
                    if (viewing === confirm.id) setViewing(null);
                    void s.removeLocal(confirm.id);
                } else if (confirm.kind === 'cloud') void s.removeCloud(confirm.id);
                else if (confirm.kind === 'diag') void s.removeDiagnostic(confirm.id);
                else s.reauth();
            }}
        />
    );

    if (viewed) {
        return (
            <>
                <SessionViewer
                    session={viewed}
                    catalog={viewed.ecu === ecuId ? catalog : null}
                    onBack={() => setViewing(null)}
                />
                {dialog}
            </>
        );
    }

    // Re-signing in reloads the page. With nothing unsaved it costs nothing and goes straight on;
    // with something unsaved it says what would be lost first.
    const startReauth = () => (s.unsaved ? setConfirm({ kind: 'reauth' }) : s.reauth());

    return (
        <Pane>
            <Section
                title={t.sessions_current}
                note={t.sessions_current_note}
                actions={
                    <>
                        <TextButton onClick={() => void s.save()} disabled={busy || !s.content} Icon={Save}>
                            {t.save}
                        </TextButton>
                        {s.cloudEnabled && (
                            <TextButton
                                onClick={() => void s.sync()}
                                disabled={busy || (!s.unsaved && s.pending === 0)}
                                Icon={CloudUpload}
                            >
                                {t.sync}
                            </TextButton>
                        )}
                    </>
                }
            >
                <div className="flex flex-col gap-1.5">
                    <p className="text-xs text-slate-300">
                        {s.content ? <CurrentCounts s={s} /> : <span className="text-slate-500">{t.sessions_nothing}</span>}
                    </p>
                    {/* Reserved: the outcome of the last SAVE or SYNC appears here without moving
                        the lists below it. */}
                    <p className={`min-h-[18px] text-[11px] ${s.notice ? NOTICE_TONE[s.notice.tone] : ''}`}>
                        {s.notice?.text}
                    </p>
                    {/* Where SYNC sends. Said beside SYNC, because it is the one fact about the
                        button the button cannot say. */}
                    <div className="flex min-h-[18px] flex-wrap items-baseline gap-x-4 gap-y-1 text-[11px] text-slate-500">
                        <span>{s.cloudEnabled ? (account ?? '…') : t.sessions_noCloud}</span>
                        {s.canReauth && (
                            <TextButton onClick={startReauth} tone="caution" Icon={LogIn} title={t.reauth_note}>
                                {t.reauth}
                            </TextButton>
                        )}
                        {s.waiting > 0 && <span className="text-amber-400">{t.sessions_outbox(s.waiting)}</span>}
                    </div>
                </div>
            </Section>

            <Section title={t.sessions_onDevice} count={s.local?.length}>
                {s.local !== null && s.local.length === 0 ? (
                    <p className="py-2 text-xs text-slate-500">{t.sessions_emptyLocal}</p>
                ) : (
                    <DataList>
                        {(s.local ?? []).map((x) => {
                            const sum = summarise(x);
                            const pending = needsSync(x);
                            return (
                                <DataRow
                                    key={x.id}
                                    name={humanName(x.label)}
                                    leading={
                                        s.cloudEnabled ? (
                                            <Pill tone={pending ? 'neutral' : 'ok'}>{pending ? t.pill_local : t.pill_synced}</Pill>
                                        ) : undefined
                                    }
                                    trailing={
                                        <span className="flex shrink-0 items-baseline gap-3">
                                            {x.mock && <Pill tone="secondary">{t.practice}</Pill>}
                                            <TextButton onClick={() => setViewing(x.id)} Icon={Eye}>
                                                {t.view}
                                            </TextButton>
                                            <TextButton
                                                onClick={() => setConfirm({ kind: 'local', id: x.id, label: x.label, synced: !pending })}
                                                disabled={busy}
                                                tone="danger"
                                                Icon={Trash2}
                                            >
                                                {t.remove}
                                            </TextButton>
                                        </span>
                                    }
                                    detail={
                                        <p className="font-mono text-[11px] text-slate-500">
                                            {t.sessions_counts(sum.faultCount, sum.sampleCount, sum.failureCount)}
                                        </p>
                                    }
                                />
                            );
                        })}
                    </DataList>
                )}
            </Section>

            {s.cloudEnabled && (
                <Section title={t.sessions_inAccount} count={s.cloud?.length}>
                    {s.cloud !== null && s.cloud.length === 0 ? (
                        <p className="py-2 text-xs text-slate-500">{t.sessions_emptyCloud}</p>
                    ) : (
                        <DataList>
                            {(s.cloud ?? []).map((x) => (
                                <DataRow
                                    key={x.id}
                                    name={humanName(x.label)}
                                    trailing={
                                        <span className="flex shrink-0 items-baseline gap-3">
                                            {x.mock === 1 && <Pill tone="secondary">{t.practice}</Pill>}
                                            <TextButton
                                                onClick={() => void s.restore(x.id)}
                                                disabled={busy}
                                                Icon={CloudDownload}
                                            >
                                                {t.restore}
                                            </TextButton>
                                            <TextButton
                                                onClick={() => setConfirm({ kind: 'cloud', id: x.id, label: x.label })}
                                                disabled={busy}
                                                tone="danger"
                                                Icon={Trash2}
                                            >
                                                {t.remove}
                                            </TextButton>
                                        </span>
                                    }
                                    detail={
                                        <p className="font-mono text-[11px] text-slate-500">
                                            {t.sessions_counts(x.fault_count, x.sample_count, x.failure_count)} · {kb(x.session_bytes)} ·{' '}
                                            {when(x.synced_at)}
                                        </p>
                                    }
                                />
                            ))}
                        </DataList>
                    )}
                </Section>
            )}

            {s.cloudEnabled && (
                <Section title={t.sessions_errors} count={s.diagnostics?.length} note={t.sessions_errors_note}>
                    {s.diagnostics !== null && s.diagnostics.length === 0 ? (
                        <p className="py-2 text-xs text-slate-500">{t.sessions_emptyErrors}</p>
                    ) : (
                        <DataList>
                            {(s.diagnostics ?? []).map((d) => (
                                <DataRow
                                    key={d.id}
                                    name={humanName(d.job)}
                                    ident={d.ecu ?? undefined}
                                    trailing={
                                        <span className="flex shrink-0 items-baseline gap-3">
                                            {d.mock === 1 && <Pill tone="secondary">{t.practice}</Pill>}
                                            <TextButton
                                                onClick={() => setConfirm({ kind: 'diag', id: d.id })}
                                                disabled={busy}
                                                tone="danger"
                                                Icon={Trash2}
                                            >
                                                {t.remove}
                                            </TextButton>
                                        </span>
                                    }
                                    detail={
                                        <>
                                            {d.error && <p className="break-all font-mono text-[11px] text-red-400">{d.error}</p>}
                                            <p className="font-mono text-[11px] text-slate-500">
                                                {when(d.created_at)}
                                                {d.error_kind ? ` · ${d.error_kind}` : ''}
                                                {d.transport ? ` · ${d.transport}` : ''}
                                                {d.app_build ? ` · ${d.app_build}` : ''}
                                            </p>
                                        </>
                                    }
                                />
                            ))}
                        </DataList>
                    )}
                </Section>
            )}

            {dialog}
        </Pane>
    );
});

function CurrentCounts({ s }: { s: Sessions }) {
    const { t } = useLang();
    return <span className="font-mono">{t.sessions_counts(s.current.faults, s.current.samples, s.current.failures)}</span>;
}

/**
 * One saved session, read-only: the identity and faults as they were read, the datalog as the CSV
 * holds it, and each failure with the comms-log lines before it. Nothing here can send to a car —
 * it draws a record, and the record does not change by being looked at.
 */
function SessionViewer({
    session,
    catalog,
    onBack,
}: {
    session: SavedSession;
    catalog: EcuProfile | null;
    onBack: () => void;
}) {
    const { lang, t } = useLang();
    const faultText = new Map((catalog?.faultText ?? []).map((f) => [normCode(f.code), f]));
    const csv = session.datalog ? parseCsv(session.datalog.csv) : null;

    return (
        <Pane>
            <Section
                title={session.label}
                actions={
                    <TextButton onClick={onBack} tone="neutral" Icon={ArrowLeft}>
                        {t.back}
                    </TextButton>
                }
            >
                <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                    <Field label="ECU" value={session.ecu.toUpperCase()} />
                    <Field label="BUILD" value={session.appBuild ?? '—'} />
                    {session.mock && <Pill tone="secondary">{t.practice}</Pill>}
                </div>
            </Section>

            {session.ident && (
                <Section title="IDENT" note={t.ident_note(session.ident.length)}>
                    <Well className="max-w-[60ch]">
                        <p className="break-all font-mono text-xs text-slate-300">{session.ident.hex}</p>
                    </Well>
                </Section>
            )}

            <Section title={t.viewer_faults} count={session.faults?.length}>
                {session.faults === null ? (
                    <p className="py-2 text-xs text-slate-500">{t.viewer_noFaultsRead}</p>
                ) : session.faults.length === 0 ? (
                    <p className="py-2 text-xs text-emerald-400">{t.faults_none}</p>
                ) : (
                    <DataList>
                        {session.faults.map((f) => {
                            const code = formatErrorCode(f.errorCode);
                            const known = faultText.get(normCode(code));
                            const meaning = known && catalog ? resolveText(catalog, known.text, lang) : null;
                            return (
                                <DataRow
                                    key={`${f.number}-${f.errorCode}`}
                                    code={code}
                                    codeTone="danger"
                                    name={meaning?.text ?? humanName('')}
                                    trailing={
                                        <span className="shrink-0 font-mono text-[10px] text-slate-600">
                                            {formatErrorCode(f.errorType)}
                                        </span>
                                    }
                                    detail={
                                        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                                            <Field label={t.faults_frequency} value={f.frequencyCounter} />
                                            <Field label={t.faults_logistics} value={f.logisticsCounter} />
                                        </div>
                                    }
                                />
                            );
                        })}
                    </DataList>
                )}
            </Section>

            {csv && session.datalog && (
                <Section
                    title={t.viewer_datalog}
                    count={session.datalog.samples}
                    note={t.viewer_rows(Math.min(VIEWER_ROWS, csv.rows.length), csv.rows.length)}
                >
                    {/* Scrolls sideways only: the pane already scrolls down, and a second vertical
                        scroller inside it would trap the wheel. */}
                    <div className="overflow-x-auto">
                        <table className="font-mono text-[11px] tabular-nums text-slate-300">
                            <thead>
                                <tr className="text-left text-slate-500">
                                    {csv.header.map((h) => (
                                        <th key={h} className="whitespace-nowrap px-2 py-1 font-normal">
                                            {h}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {csv.rows.slice(0, VIEWER_ROWS).map((r, i) => (
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
            )}

            <Section title={t.viewer_failures} count={session.failures.length}>
                {session.failures.length === 0 ? (
                    <p className="py-2 text-xs text-slate-500">{t.viewer_noFailures}</p>
                ) : (
                    <div className="flex flex-col gap-3">
                        {session.failures.map((f, i) => (
                            <div key={i} className="flex flex-col gap-1">
                                <p className="text-xs text-slate-200">
                                    {f.job}
                                    <span className="ml-2 font-mono text-[11px] text-slate-500">{when(f.at)}</span>
                                </p>
                                <p className="break-all font-mono text-[11px] text-red-400">
                                    {f.error}
                                    {f.errorKind ? ` (${f.errorKind})` : ''}
                                </p>
                                <Well>
                                    <pre className="whitespace-pre-wrap break-all font-mono text-[11px] text-slate-400">
                                        {f.excerpt.join('\n')}
                                    </pre>
                                </Well>
                            </div>
                        ))}
                    </div>
                )}
            </Section>
        </Pane>
    );
}

/** The right column on SESSIONS: how many sessions this device holds. */
export function SessionsViz({ count }: { count: number }) {
    const { t } = useLang();
    return <CountReadout value={count} tone="text-slate-200" caption={t.viz_sessions} />;
}

'use client';

import { CloudUpload, Download, Trash2, CloudDownload } from 'lucide-react';
import { DataList, DataRow, Pill, Section, TextButton, humanName } from '../../components/ui';
import { useLang } from '../../lib/i18n';
import { SYNC_TONE } from '../../lib/sync/status';
import { StatusButton } from './StatusButton';
import type { Sessions } from './useSessions';

const NOTICE_TONE = {
  info: "text-slate-400",
  ok: "text-emerald-400",
  warn: "text-amber-400",
  error: "text-red-400",
} as const;
const when = (ms: number) => new Date(ms).toLocaleString();
const kb = (bytes: number) => (bytes / 1024).toFixed(bytes < 10240 ? 1 : 0) + ' KB';

export type SyncCopiesState = Pick<Sessions,'syncLook'|'cloudEnabled'|'waiting'|'cloud'|'notice'> & {
  sync(): unknown; restore(id: string): unknown;
};

export function SyncCopies({ s, account, busy, remove }: {
  s: SyncCopiesState; account: string | null; busy: boolean; remove(id: string, label: string): void;
}) {
  const { t } = useLang();
  return <>        <div className="flex flex-col gap-1.5 pb-2">
          {/* The send, first: the one thing this panel does. Where it goes is said beside
                        it, because it is the one fact about the button the button cannot say. An
                        expired sign-in is said here as that fact; the way back is the header's SIGN
                        IN AGAIN (AppHeader `SignInNotice`). */}
          <div className="flex min-h-[20px] flex-wrap items-baseline gap-x-4 gap-y-1">
            {s.syncLook && (
              <StatusButton
                look={s.syncLook}
                tones={SYNC_TONE}
                Icon={CloudUpload}
                busy={busy}
                onClick={() => void s.sync()}
              />
            )}
            <span className="text-[11px] text-slate-500">
              {s.cloudEnabled ? (account ?? "…") : t.sessions_noCloud}
            </span>
            {s.waiting > 0 && (
              <span className="text-[11px] text-amber-400">
                {t.sessions_outbox(s.waiting)}
              </span>
            )}
          </div>
          {/* Reserved, so the lists below do not move when SYNC reports. */}
          <p
            className={`min-h-[18px] text-[11px] ${s.notice ? NOTICE_TONE[s.notice.tone] : ""}`}
          >
            {s.notice?.text}
          </p>
        </div>

        {s.cloudEnabled && (
          <Section title={t.sessions_inAccount} count={s.cloud?.length}>
            {s.cloud !== null && s.cloud.length === 0 ? (
              <p className="py-2 text-xs text-slate-500">
                {t.sessions_emptyCloud}
              </p>
            ) : (
              <DataList>
                {(s.cloud ?? []).map((x) => (
                  <DataRow
                    key={x.id}
                    name={humanName(x.label)}
                    trailing={
                      <span className="flex shrink-0 items-baseline gap-3">
                        {x.mock === 1 && (
                          <Pill tone="secondary">{t.practice}</Pill>
                        )}
                        <TextButton
                          onClick={() => void s.restore(x.id)}
                          disabled={busy}
                          Icon={CloudDownload}
                        >
                          {t.restore}
                        </TextButton>
                        <TextButton
                          onClick={() => remove(x.id, x.label)}
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
                        {t.sessions_counts(
                          x.fault_count,
                          x.sample_count,
                          x.failure_count,
                        )}{" "}
                        · {kb(x.session_bytes)} · {when(x.synced_at)}
                      </p>
                    }
                  />
                ))}
              </DataList>
            )}
          </Section>
        )}

  </>;
}

"use client";

import { useState } from "react";
import { CloudDownload, CloudUpload, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { DialogFrame } from "@/components/DialogFrame";
import {
  DataList,
  DataRow,
  Fold,
  Pill,
  Section,
  TextButton,
  humanName,
} from "@/components/ui";
import { useLang } from "@/lib/i18n";
import { CHROME } from "@/lib/i18n/chrome";
import { SYNC_TONE } from "@/lib/sync/status";
import { StatusButton } from "./StatusButton";
import type { Sessions } from "./useSessions";

const NOTICE_TONE = {
  info: "text-slate-400",
  ok: "text-emerald-400",
  warn: "text-amber-400",
  error: "text-red-400",
} as const;

type Confirm =
  | { kind: "cloud"; id: string; label: string }
  | { kind: "diag"; id: string };

const when = (ms: number) => new Date(ms).toLocaleString();
const kb = (bytes: number) =>
  `${(bytes / 1024).toFixed(bytes < 10_240 ? 1 : 0)} KB`;

/**
 * SESSION SYNC — the send and the account, and nothing else (UX-33, 2026-11-21):
 *
 *   - the send itself, first, with where it goes and what is waiting;
 *   - the copies in the account, to pull back or remove, and folded under them the error records
 *     the build sent by itself.
 *
 * It held six subjects once (operator, 2026-11-02, after TUNER's panel): the two above, the error
 * records open, ASSISTANT, this device's name and the reads cleared for a moving car — and on the head
 * unit it scrolled before it reached the second. ASSISTANT's state and the device's name, and WHILE
 * MOVING, are MEMORY's now, under its lists; ASSISTANT's switch was already AI in the header.
 *
 * Opened from MEMORY's SYNC from 900px and from the menu sheet's SYNC below it, one panel for both
 * (the shell owns it). Every account surface is gated on `cloudEnabled`, false on the dev server, and
 * on the build having somewhere to send (`noDestination`): there the panel says it has nowhere to
 * send instead of offering a button that cannot work.
 */
export function SyncPanel({
  sessions: s,
  onClose,
}: {
  sessions: Sessions;
  onClose: () => void;
}) {
  const { t } = useLang();
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const busy = s.busy !== null;

  const account =
    !s.cloudEnabled || s.noDestination || s.gate === null
      ? null
      : s.gate.state === "active"
        ? t.sessions_account(s.gate.label || "—")
        : s.gate.state === "expired"
          ? t.sessions_account_expired
          : t.sessions_account_unknown;

  return (
    <>
      <DialogFrame
        title={CHROME.sync_panel}
        Icon={CloudUpload}
        onClose={onClose}
      >
        <div className="flex flex-col gap-1.5 pb-2">
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
              {s.cloudEnabled && !s.noDestination
                ? (account ?? "…")
                : t.sessions_noCloud}
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

        {s.cloudEnabled && !s.noDestination && (
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
                          onClick={() =>
                            setConfirm({
                              kind: "cloud",
                              id: x.id,
                              label: x.label,
                            })
                          }
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

        {/* Folded: the build sent these by itself, and they are read only when something failed. */}
        {s.cloudEnabled && !s.noDestination && (
          <Fold
            title={t.sessions_errors}
            count={s.diagnostics?.length}
            note={t.sessions_errors_info}
          >
            {s.diagnostics !== null && s.diagnostics.length === 0 ? (
              <p className="py-2 text-xs text-slate-500">
                {t.sessions_emptyErrors}
              </p>
            ) : (
              <DataList>
                {(s.diagnostics ?? []).map((d) => (
                  <DataRow
                    key={d.id}
                    name={humanName(d.job)}
                    ident={d.ecu ?? undefined}
                    trailing={
                      <span className="flex shrink-0 items-baseline gap-3">
                        {d.mock === 1 && (
                          <Pill tone="secondary">{t.practice}</Pill>
                        )}
                        <TextButton
                          onClick={() => setConfirm({ kind: "diag", id: d.id })}
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
                        {d.error && (
                          <p className="break-all font-mono text-[11px] text-red-400">
                            {d.error}
                          </p>
                        )}
                        <p className="font-mono text-[11px] text-slate-500">
                          {when(d.created_at)}
                          {d.error_kind ? ` · ${d.error_kind}` : ""}
                          {d.transport ? ` · ${d.transport}` : ""}
                          {d.app_build ? ` · ${d.app_build}` : ""}
                        </p>
                      </>
                    }
                  />
                ))}
              </DataList>
            )}
          </Fold>
        )}
      </DialogFrame>

      {confirm && (
        <ConfirmDialog
          title={
            confirm.kind === "cloud"
              ? t.sessions_deleteCloud_title
              : t.sessions_deleteError_title
          }
          consequence={
            confirm.kind === "cloud"
              ? t.sessions_deleteCloud_consequence(confirm.label)
              : t.sessions_deleteError_consequence
          }
          confirmLabel={t.sessions_delete_confirm}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            setConfirm(null);
            if (confirm.kind === "cloud") void s.removeCloud(confirm.id);
            else void s.removeDiagnostic(confirm.id);
          }}
        />
      )}
    </>
  );
}

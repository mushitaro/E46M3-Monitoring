"use client";

import { SyncCopies } from "./SyncCopies";
import { useState } from "react";
import { CloudDownload, CloudUpload, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { DialogFrame } from "@/components/DialogFrame";
import {
  DataList,
  DataRow,
  Pill,
  Section,
  TextButton,
  humanName,
} from "@/components/ui";
import type { AssistantBridge } from "@/hooks/useAssistantBridge";
import type { EcuProfile } from "@tsunagi/monitoring-engine";
import { useLang } from "@/lib/i18n";
import { CHROME } from "@/lib/i18n/chrome";
import type { Ledger } from "@tsunagi/monitoring-engine";
import { SYNC_TONE } from "@/lib/sync/status";
import type { Motion } from "@tsunagi/monitoring-engine";
import { AssistantSection } from "./AssistantSection";
import { MovingOkSection } from "./MovingOkSection";
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
 * SESSION SYNC — TUNER's panel behind SYNC (operator, 2026-11-02: SYNC, the error records and
 * ASSISTANT where TUNER has them, and the reads cleared for a moving car with them). One place for everything this WORKS build does with the owner's account and on the
 * owner's say-so, rather than a tab that mixed the records with the settings:
 *
 *   - the send itself, first, with where it goes and what is waiting;
 *   - the copies in the account, to pull back or remove;
 *   - the error records the build sent by itself;
 *   - ASSISTANT: whether the assistant can hear this tab, and this device's name;
 *   - the reads the owner cleared for a moving car (the ledger's WHILE MOVING).
 *
 * Opened from MEMORY's SYNC from 900px and from the menu sheet's SYNC below it, one panel for both
 * (the shell owns it). Every account surface is gated on `cloudEnabled`, false on the dev server:
 * there the panel says it has nowhere to send instead of offering a button that cannot work.
 */
export function SyncPanel({
  sessions: s,
  assistant,
  ledger,
  motion,
  catalog,
  ecuId,
  onGrantMovingOk,
  onClose,
}: {
  sessions: Sessions;
  assistant: AssistantBridge;
  /** The verified ledger, and the owner's press that clears a read for a moving car. */
  ledger: Ledger;
  motion: Motion;
  catalog: EcuProfile | null;
  ecuId: string;
  onGrantMovingOk: (id: string) => void;
  onClose: () => void;
}) {
  const { t } = useLang();
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const busy = s.busy !== null;

  const account =
    !s.cloudEnabled || s.gate === null
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
        <SyncCopies s={s} account={account} busy={busy} remove={(id,label) => setConfirm({kind:"cloud",id,label})} />
        {s.cloudEnabled && (
          <Section
            title={t.sessions_errors}
            count={s.diagnostics?.length}
            info={t.sessions_errors_info}
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
          </Section>
        )}

        <AssistantSection assistant={assistant} />

        <MovingOkSection
          ledger={ledger}
          motion={motion}
          catalog={catalog}
          ecuId={ecuId}
          onGrant={onGrantMovingOk}
        />
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

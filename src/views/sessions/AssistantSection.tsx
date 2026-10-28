'use client';

import { useState } from 'react';
import { Repeat } from 'lucide-react';
import { Section, TextButton, TextInput } from '@/components/ui';
import type { AssistantBridge } from '@/hooks/useAssistantBridge';
import { useLang } from '@/lib/i18n';

const STATE_TONE = {
    off: 'text-slate-500',
    connecting: 'text-slate-400',
    live: 'text-emerald-400',
    retrying: 'text-amber-400',
    held: 'text-amber-400',
    offline: 'text-amber-400',
    stopped: 'text-red-400',
} as const;

/**
 * ASSISTANT — the switch that lets the owner's assistant reach this tab (hooks/useAssistantBridge),
 * the name this device answers as, and how the link to the relay is going.
 *
 * On SESSIONS, beside SYNC: both send to the owner's own services and both are WORKS only. The
 * switch is not here: it is AI in the header, the one place in every M tool (components/AiSwitch,
 * 2026-10-28), which shows the notice the privacy policy promises before it turns it on (m3
 * #preview, アシスタント連携). Here are the state, "switch here", and this device's name.
 *
 * Both lines under the note are reserved, so the section does not move as the state changes.
 */
export function AssistantSection({ assistant: a }: { assistant: AssistantBridge }) {
    const { t } = useLang();
    const [draft, setDraft] = useState<string | null>(null);
    const s = a.status;
    const catalog = s.catalog;
    return (
        <Section
            title={t.assistant}
            note={t.assistant_whereSwitch}
        >
            <div className="flex flex-col gap-1.5">
                <div className={`flex min-h-[18px] flex-wrap items-baseline gap-x-3 gap-y-1 text-[11px] ${a.allowed ? STATE_TONE[s.state] : 'text-slate-500'}`}>
                    {!a.allowed ? (
                        <span>{t.assistant_unavailable}</span>
                    ) : (
                        <>
                            <span>
                                {t.assistant_state[s.state]}
                                {s.state === 'held' && s.holder ? `（${s.holder}）` : ''}
                                {s.state === 'live' && s.calls > 0 ? ` · ${t.assistant_calls(s.calls)}` : ''}
                            </span>
                            {s.state === 'held' && (
                                <TextButton onClick={a.takeover} tone="caution" Icon={Repeat}>
                                    {t.assistant_switchHere}
                                </TextButton>
                            )}
                            {s.detail && s.state !== 'held' && <span className="text-slate-500">{s.detail}</span>}
                        </>
                    )}
                </div>
                <p className={`min-h-[18px] text-[11px] ${catalog && !catalog.accepted ? 'text-amber-400' : 'text-slate-500'}`}>
                    {a.on && catalog ? (catalog.accepted ? t.assistant_catalogOk : t.assistant_catalogRefused(catalog.reason)) : null}
                </p>
                {a.allowed && (
                    <TextInput
                        value={draft ?? a.device ?? ''}
                        onChange={(v) => {
                            setDraft(v);
                            a.setDevice(v);
                        }}
                        placeholder={t.assistant_device}
                        label={t.assistant_device}
                        maxLength={24}
                        className="w-full max-w-[280px]"
                    />
                )}
            </div>
        </Section>
    );
}

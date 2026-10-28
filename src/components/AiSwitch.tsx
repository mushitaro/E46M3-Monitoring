'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Power } from 'lucide-react';
import { LABEL, TextButton } from './ui';
import type { AssistantBridge } from '@/hooks/useAssistantBridge';
import type { BridgeState } from '@/lib/bridge/bridgeClient';
import { useLang } from '@/lib/i18n';

/**
 * AI — the one switch for the owner's assistant, right of the WORKS badge in the header, the same
 * place in every M tool (tsunagi-m-chrome §2, operator 2026-10-28). There is no other: SESSIONS
 * shows the device's name and the state, and says where the switch is.
 *
 * A switch, not a link: `role="switch"` and `aria-checked`. Off, a press shows what turning it on
 * sends, and turns it on only when that is agreed; on, a press turns it off. Its look is its state —
 * sky when the assistant can reach this tab, a pulse while connecting or reconnecting, amber when
 * another device has it, an outline when off. The outline is the switch's OFF, a state and not a
 * frame (tools/check_ui_tokens.mjs lists this file for it). Every state keeps the same box, so the
 * header does not move as it changes.
 *
 * Not drawn on a build that has no assistant (production).
 *
 * The notice is put on the body, not beside the switch: the header is a stacking context of its own
 * (z-10, backdrop blur), and a dialog inside it is drawn under the panes below it, unpressable.
 */
const LOOK: Record<BridgeState, string> = {
    live: 'border-transparent bg-sky-500/15 text-sky-400',
    connecting: 'border-transparent bg-sky-500/10 text-sky-400 animate-pulse',
    retrying: 'border-transparent bg-sky-500/10 text-sky-400 animate-pulse',
    offline: 'border-transparent bg-sky-500/10 text-sky-400 animate-pulse',
    held: 'border-transparent bg-amber-500/15 text-amber-400',
    off: 'border-slate-700 bg-transparent text-slate-500',
    stopped: 'border-slate-700 bg-transparent text-slate-600',
};

export function AiSwitch({ assistant: a }: { assistant: AssistantBridge }) {
    const { t } = useLang();
    const [asking, setAsking] = useState(false);
    const state: BridgeState = a.status.state;
    const hint = !a.allowed ? t.assistant_unavailable : a.on ? t.ai_pressToTurnOff : t.ai_pressToTurnOn;
    const title = `${t.assistant}: ${a.allowed ? t.assistant_state[state] : t.assistant_state.off}. ${hint}`;
    return (
        <>
            <button
                type="button"
                role="switch"
                aria-checked={a.on}
                aria-label={t.assistant}
                title={title}
                disabled={!a.allowed}
                onClick={() => (a.on ? a.setOn(false) : setAsking(true))}
                className={`shrink-0 rounded border px-1.5 py-0.5 transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${LABEL} ${LOOK[a.on ? state : 'off']}`}
            >
                AI
            </button>
            {asking &&
                createPortal(
                    <div
                        className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-6"
                        role="dialog"
                        aria-modal="true"
                        aria-label={t.assistant}
                        onClick={() => setAsking(false)}
                    >
                        <div className="w-full max-w-md bg-slate-900 p-5" onClick={(e) => e.stopPropagation()}>
                            <span className={`${LABEL} text-sky-400`}>{t.assistant}</span>
                            <p className="mt-3 max-h-[50svh] overflow-y-auto text-xs leading-relaxed text-slate-300">{t.assistant_note}</p>
                            <div className="mt-5 flex items-center justify-end gap-4">
                                <TextButton onClick={() => setAsking(false)} tone="neutral">
                                    {t.cancel}
                                </TextButton>
                                <TextButton
                                    onClick={() => {
                                        setAsking(false);
                                        a.setOn(true);
                                    }}
                                    Icon={Power}
                                >
                                    {t.assistant_turnOn}
                                </TextButton>
                            </div>
                        </div>
                    </div>,
                    document.body,
                )}
        </>
    );
}

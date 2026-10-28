'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Bot } from 'lucide-react';
import { DialogFrame } from './DialogFrame';
import { DialogButton, LABEL } from './ui';
import type { AssistantBridge } from '@/hooks/useAssistantBridge';
import type { BridgeState } from '@/lib/bridge/bridgeClient';
import { useLang } from '@/lib/i18n';

/**
 * AI — the one switch for the owner's assistant, right of the WORKS badge in the header, the same
 * place in every M tool (tsunagi-m-chrome §2, operator 2026-10-28). There is no other: SESSIONS
 * shows the device's name and the state, and says where the switch is.
 *
 * A switch, not a link: `role="switch"` and `aria-checked`. Off, a press shows what turning it on
 * sends, and turns it on only when that is agreed; on, a press turns it off. Its look is its state,
 * in tint alone, as the badge beside it — sky when the assistant can reach this tab, a pulse while
 * connecting or reconnecting, amber when another device has it, slate when off. No outline in any
 * state (operator, 2026-10-28). Every state keeps the same box, so the header does not move.
 *
 * Not drawn on a build that has no assistant (production).
 *
 * The notice is TUNER's (its `toggleAssistant`): the shared dialog frame with the assistant's glyph,
 * titled for what the press will do, CANCEL plain and the answer tinted. What it says is one item
 * per question — what is sent, by which route, where it arrives, what the assistant can and cannot
 * do — rather than one paragraph to be read through for the part that matters (tsunagi-m-ux §17).
 *
 * It is put on the body, not beside the switch: the header is a stacking context of its own and
 * carries a backdrop blur, which is a containing block for anything fixed inside it — a dialog
 * placed there is laid out against the 48px header and drawn under the panes below it.
 */
const OFF = 'bg-slate-500/10 text-slate-500';
const TRYING = 'bg-slate-500/10 text-slate-400 animate-pulse';
const LOOK: Record<BridgeState, string> = {
    live: 'bg-sky-500/15 text-sky-300',
    connecting: TRYING,
    retrying: TRYING,
    offline: TRYING,
    held: 'bg-amber-500/15 text-amber-300',
    off: OFF,
    stopped: OFF,
};

export function AiSwitch({ assistant: a }: { assistant: AssistantBridge }) {
    const { t } = useLang();
    const [asking, setAsking] = useState(false);
    const state: BridgeState = a.status.state;
    const hint = !a.allowed ? t.assistant_unavailable : a.on ? t.ai_pressToTurnOff : t.ai_pressToTurnOn;
    const title = `${t.assistant}: ${a.allowed ? t.assistant_state[state] : t.assistant_state.off}. ${hint}`;
    const c = t.assistant_consent;
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
                className={`shrink-0 rounded px-1.5 py-0.5 transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${LABEL} ${LOOK[a.on ? state : 'off']}`}
            >
                AI
            </button>
            {asking &&
                createPortal(
                    <DialogFrame
                        title={c.title}
                        Icon={Bot}
                        tone="primary"
                        onEscape={() => setAsking(false)}
                        footer={
                            <>
                                <DialogButton onClick={() => setAsking(false)} tone="neutral">
                                    {t.cancel}
                                </DialogButton>
                                <DialogButton
                                    onClick={() => {
                                        setAsking(false);
                                        a.setOn(true);
                                    }}
                                >
                                    {t.assistant_turnOn}
                                </DialogButton>
                            </>
                        }
                    >
                        <div className="space-y-3 text-xs leading-relaxed text-slate-300">
                            <p>{c.lead}</p>
                            <dl className="space-y-2">
                                {c.items.map((item) => (
                                    <div key={item.title}>
                                        <dt className="font-bold text-slate-100">{item.title}</dt>
                                        <dd>{item.body}</dd>
                                    </div>
                                ))}
                            </dl>
                            <p className="text-[11px] text-slate-500">{c.off}</p>
                        </div>
                    </DialogFrame>,
                    document.body,
                )}
        </>
    );
}

'use client';

import type { LinkMode, LinkState } from '@/hooks/useDs2Link';
import { useLang } from '@/lib/i18n';

/**
 * The connection indicator.
 *
 * Colour is a semantic channel, and the status roles live inside the tricolor:
 * ice blue (emerald-* token) for connected, violet (amber-* token) for busy,
 * red for a fault, neutral slate for idle. Every non-steady state also carries a
 * NON-HUE channel — busy pulses — so the state survives being read by someone
 * who cannot separate the hues.
 *
 * PRACTICE is deliberately not a shade of "connected". A simulated session must
 * never be one glance away from a real one.
 */
export function StatusLed({
    state,
    mode,
    hasError,
}: {
    state: LinkState;
    mode: LinkMode;
    hasError: boolean;
}) {
    const { t } = useLang();

    const busy = state === 'busy' || state === 'logging' || state === 'connecting';
    const live = state === 'connected' || busy;
    const practice = mode === 'practice' && live;

    const dot = hasError
        ? 'bg-red-500'
        : practice
          ? 'bg-indigo-400'
          : busy
            ? 'bg-amber-500 animate-pulse'
            : live
              ? 'bg-emerald-500'
              : 'bg-slate-700';

    const label = hasError
        ? t.disconnected
        : practice
          ? t.practice
          : state === 'connecting'
            ? t.connecting
            : live
              ? t.connected
              : t.disconnected;

    const text = hasError
        ? 'text-red-400'
        : practice
          ? 'text-indigo-400'
          : busy
            ? 'text-amber-400'
            : live
              ? 'text-emerald-400'
              : 'text-slate-500';

    return (
        <span className="flex items-center gap-2">
            <span className={`size-2 shrink-0 rounded-full ${dot}`} aria-hidden="true" />
            <span className={`font-mono text-[11px] uppercase tracking-widest ${text}`}>{label}</span>
        </span>
    );
}

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
    showLabel = true,
}: {
    state: LinkState;
    mode: LinkMode;
    hasError: boolean;
    /** In the app header the dot stands alone and the state is on hover — the
     *  words belong beside the connect action, and printing them twice makes
     *  neither one the place you look. */
    showLabel?: boolean;
}) {
    const { t } = useLang();

    const busy = state === 'busy' || state === 'logging' || state === 'connecting';
    const live = state === 'connected' || busy;
    const practice = mode === 'practice' && live;

    // Hue and motion are decided SEPARATELY.
    //
    // Testing `practice` before `busy` made the pulse unreachable in practice
    // mode — the only mode usable without a car — so the dot sat perfectly still
    // through connecting, reading and recording alike. Worse, indigo-400 and
    // amber-500 are both #9B84E8, so a practice session was pixel-identical to a
    // real-vehicle BUSY dot: exactly the one glance away this component's
    // comment promises it never would be. indigo-300 #B9A6EE gives practice the
    // lightness separation the shared hue cannot.
    const fill = hasError
        ? 'bg-red-500 shadow-[0_0_8px_rgba(241,26,34,0.6)]'
        : practice
          ? 'bg-indigo-300 shadow-[0_0_8px_rgba(185,166,238,0.6)]'
          : busy
            ? 'bg-amber-500 shadow-[0_0_8px_rgba(155,132,232,0.6)]'
            : live
              ? 'bg-emerald-500 shadow-[0_0_8px_rgba(143,216,242,0.6)]'
              : 'bg-slate-600';
    const dot = `${fill}${busy ? ' animate-pulse' : ''}`;

    // Phase before mode, for the same reason: PRACTICE is a standing fact about
    // the session, CONNECTING/READING is what is happening right now, and the
    // one that changes is the one worth printing.
    const label = hasError
        ? t.disconnected
        : state === 'connecting'
          ? t.connecting
          : busy
            ? t.hub_reading
            : practice
              ? t.practice
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

    if (!showLabel) {
        return <span className={`size-2 shrink-0 rounded-full ${dot}`} title={label} />;
    }

    return (
        <span className="flex items-center gap-2">
            <span className={`size-2 shrink-0 rounded-full ${dot}`} aria-hidden="true" />
            <span className={`font-mono text-[10px] uppercase tracking-wider ${text}`}>{label}</span>
        </span>
    );
}

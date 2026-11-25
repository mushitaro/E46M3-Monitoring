'use client';

import { CircleDot, Loader2, PlugZap } from 'lucide-react';
import { hubConfigFor, type HubState } from '../lib/hub';
import { useLang } from '../lib/i18n';

/** Resolve the connection tiers for the current instrument, in the host's language. */
export function useLinkHub(input: Omit<HubState, 'icons' | 't'>) {
    const { t } = useLang();
    return hubConfigFor({
        ...input,
        t: {
            hub_connect: t.hub_connect,
            hub_connecting: t.hub_connecting,
            hub_busy: t.hub_reading,
            hub_connected: t.hub_connected,
            mode_practice: t.mode_practice,
        },
        icons: { plug: PlugZap, loader: Loader2, idle: CircleDot },
    });
}

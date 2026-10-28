'use client';

import { useCallback, useEffect, useRef } from 'react';
import { syncInvestigations } from '@/lib/sync/investigations';

/** How often a delegated investigation is brought level with the account while the page is open. */
export const INVESTIGATION_SYNC_MS = 2 * 60_000;

/**
 * Keeps each delegated investigation on this device level with the owner's account
 * (lib/sync/investigations): on load, every two minutes, when a PROBE run ends, and whenever the
 * page asks (`kick`, after a CO-WORK write). A desk plan that arrives is handed to `onPulled`, which
 * reads the record again so PROBE offers it.
 *
 * WORKS only, like every send: `enabled` is the sessionSync bit, and the round itself makes no
 * request before the notice is acknowledged.
 */
export function useInvestigationSync(input: { enabled: boolean; onPulled: () => void; lastRun: unknown }) {
    const { enabled, lastRun } = input;
    const onPulledRef = useRef(input.onPulled);
    useEffect(() => {
        onPulledRef.current = input.onPulled;
    });

    const kick = useCallback(() => {
        if (!enabled) return;
        void syncInvestigations().then((r) => {
            if (r.pulled > 0) onPulledRef.current();
        });
    }, [enabled]);

    useEffect(() => {
        if (!enabled) return;
        kick();
        const id = setInterval(kick, INVESTIGATION_SYNC_MS);
        return () => clearInterval(id);
    }, [enabled, kick]);

    // A run that ended is the newest thing the desk would want.
    useEffect(() => {
        if (lastRun) kick();
    }, [lastRun, kick]);

    return kick;
}

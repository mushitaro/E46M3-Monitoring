'use client';

import { useEffect, useState } from 'react';

/**
 * The time now, ticking every `everyMs` while it is given and standing still when it is null — for a
 * countdown on the screen (the seconds left on an output that is on). Rendering only: nothing decides
 * anything from it; the time-out that ends an output is its own timer (useActuatorArming).
 */
export function useNow(everyMs: number | null): number {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        if (everyMs === null) return;
        const id = setInterval(() => setNow(Date.now()), everyMs);
        return () => clearInterval(id);
    }, [everyMs]);
    return everyMs === null ? now : Math.max(now, 0);
}

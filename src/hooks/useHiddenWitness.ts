import { useCallback, useEffect, useRef } from 'react';

/**
 * Records whether the page was ever hidden while an operation was running.
 *
 * This buys a diagnosis, not a defence. Nothing here can stop Android from freezing a backgrounded
 * tab mid-operation; what it can do is stop the resulting failure from being a mystery. "The
 * datalog stopped" and "the datalog stopped, and the app was backgrounded while it ran" are the
 * same event and completely different bug reports — the second one names the cause and the remedy,
 * the first sends someone looking at the cable.
 *
 * It matters more here than it did in the app this came from, because this one is Android-first: a
 * backgrounded tab is the common case, not the exotic one.
 *
 * That is the same argument `classifyEchoMismatch` already makes in packages/ds2-core: when a
 * failure has several plausible causes, record which one actually happened rather than making the
 * next reader guess.
 *
 * A ref, not state: the flag is read at failure time, never rendered, and a setState during a run
 * is exactly the main-thread work the transport cannot afford — on the WebUSB backend the read loop
 * is the only thing draining the FT232R's 256-byte FIFO, and it shares this thread. Latched on
 * `active` going true so each operation is judged on its own.
 */
export function useHiddenWitness(active: boolean): () => boolean {
    const wasHidden = useRef(false);

    useEffect(() => {
        if (!active) return;
        wasHidden.current = false;
        // Catches the case where the operation is started from an already-hidden page — rare, but
        // it would otherwise report a clean run.
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
            wasHidden.current = true;
        }
        const onVisibility = () => {
            if (document.visibilityState === 'hidden') wasHidden.current = true;
        };
        document.addEventListener('visibilitychange', onVisibility);
        return () => document.removeEventListener('visibilitychange', onVisibility);
    }, [active]);

    return useCallback(() => wasHidden.current, []);
}

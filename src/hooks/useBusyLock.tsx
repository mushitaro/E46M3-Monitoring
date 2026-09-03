'use client';

import { createContext, useCallback, useContext, useMemo, useState } from 'react';

/**
 * The busy lock — one write at a time, and everything that could interrupt it
 * goes dead while it runs.
 *
 * What it covers: tab switching, the ECU and mode selectors, DISCONNECT, the
 * language toggle, and every sub-action. What it deliberately does NOT cover:
 * a STOP for an armed actuator. An energised output is a physical thing that is
 * on, and the release must stay pressable no matter what else is in flight —
 * see `lib/arming`.
 *
 * ## Why the sub-actions read it through a component and not a prop
 *
 * The rule "a sub-action is disabled while busy" was a convention in the
 * predecessor, enforced by a loop that walked the rendered row and set
 * `disabled` on whatever buttons it found:
 *
 *     if (app.busy) subEl.querySelectorAll("button, select, input")
 *                        .forEach((el) => (el.disabled = true));
 *
 * That works until someone renders a sub-action that is not a `button`, or
 * renders one after the loop has run. It is a sweep over the output, so it can
 * only find what happened to be there at the time.
 *
 * Here the only way to put something in the sub-action row is `SubActionButton`,
 * and it reads the lock from context itself. There is no prop to forget to pass
 * and no sweep to miss anything: a sub-action that ignores the lock is not
 * something you can write without writing a different component, which is a
 * visible act rather than an omission.
 *
 * ## The label is part of the lock
 *
 * `setBusy(true, label)` takes what is running. The hub's notice line prints it,
 * so "the app is frozen" always comes with "because this is happening" — and
 * because the label is set and cleared by the same call, it cannot outlive the
 * state it describes.
 */

export interface BusyLock {
    busy: boolean;
    /** What is running, for the notice line. Null exactly when `busy` is false. */
    label: string | null;
    /**
     * Run `work` with the lock held, and release it however it ends.
     *
     * There is no bare `setBusy`. A flag with a separate release has one failure
     * mode — the path that skips the release — and it freezes the whole app.
     * `finally` is the only correct shape, so it is the only shape offered.
     */
    withLock: <T,>(label: string, work: () => Promise<T>) => Promise<T>;
}

const BusyContext = createContext<BusyLock | null>(null);

export function BusyProvider({ children }: { children: React.ReactNode }) {
    const [label, setLabel] = useState<string | null>(null);

    const withLock = useCallback(async <T,>(next: string, work: () => Promise<T>): Promise<T> => {
        setLabel(next);
        try {
            return await work();
        } finally {
            setLabel(null);
        }
    }, []);

    const value = useMemo<BusyLock>(
        () => ({ busy: label !== null, label, withLock }),
        [label, withLock],
    );
    return <BusyContext.Provider value={value}>{children}</BusyContext.Provider>;
}

/**
 * Read the lock.
 *
 * Throws outside a provider rather than returning a default. A default here
 * would be `busy: false`, and a component that silently believes nothing is
 * running is exactly the bug this exists to prevent.
 */
export function useBusyLock(): BusyLock {
    const v = useContext(BusyContext);
    if (!v) throw new Error('useBusyLock used outside <BusyProvider>');
    return v;
}

/**
 * The thin React layer over a `LinkSession`: `@tsunagi/monitoring-engine/react`.
 *
 * Kept out of the package's main entry so the core stays free of React — a test, a worker or a
 * screen built on something else imports `@tsunagi/monitoring-engine` and never loads it.
 *
 * What it does is what a hook may do (tsunagi-m-link §1): hold the session for the component's
 * life, read its snapshot, and keep the heartbeat TIMER — the decision to skip a beat is the
 * session's (`heartbeat`). Everything a page adds around a link (an unload guard, a wake lock,
 * letting the cable go when hidden) is the page's, and E46M3 /// MONITORING adds them in its own
 * `useDs2Link`.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { KEEP_ALIVE_INTERVAL_MS, LinkSession, type LinkHandlers, type LinkSnapshot } from './link/session';
import type { ModuleProtocol } from './moduleProtocol';

/**
 * One session for the component's life. `target` and the handlers are read at send time, so they
 * are handed to the session after every render rather than captured once.
 */
export function useLinkSession(options: { target: ModuleProtocol } & LinkHandlers): { session: LinkSession; snapshot: LinkSnapshot } {
    const [session] = useState(() => new LinkSession(options));
    useEffect(() => {
        session.setTarget(options.target);
        session.setHandlers({ onFailure: options.onFailure, onObserved: options.onObserved, onRead: options.onRead });
    });
    // The initial snapshot is a constant, so the server's render and the first client render agree.
    const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
    // The heartbeat. The timer lives here; whether a beat is sent is the session's to decide.
    useEffect(() => {
        const id = setInterval(session.heartbeat, KEEP_ALIVE_INTERVAL_MS);
        return () => clearInterval(id);
    }, [session]);
    useEffect(() => () => session.dispose(), [session]);
    return { session, snapshot };
}

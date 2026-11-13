'use client';

/**
 * The hook layer: link STATE for the UI, and what a page adds around a link.
 *
 * The session itself — every frame, the gate checks, the stationary preflight, the identification
 * of which module is where, the run boundary — is the engine's (`@tsunagi/monitoring-engine`,
 * `link/session.ts`), with no React in it. The engine's thin hook (`useLinkSession`) holds it and
 * keeps the heartbeat timer. What stays here is what only a page can do: guard an operation in
 * flight against the tab closing, keep the screen on, notice the tab being hidden, and let the
 * cable go when hidden and idle.
 *
 * The returned object is the one the screens always had: the same fields and the same operations.
 */

import { useEffect, useSyncExternalStore } from 'react';
import { detectTransportKind, type TransportKind } from '@tsunagi/ds2-core';
import type { LinkHandlers, ModuleProtocol } from '@tsunagi/monitoring-engine';
import { useLinkSession } from '@tsunagi/monitoring-engine/react';
import { useHiddenWitness } from './useHiddenWitness';
import { useScreenWakeLock } from './useScreenWakeLock';
import { useUnloadGuard } from './useUnloadGuard';

export type {
    AdaptationRead,
    CommsLogLine,
    JobRunResult,
    LinkFailure,
    LinkMode,
    LinkState,
    LiveSample,
    ParkedObservation,
    RawFaultRead,
} from '@tsunagi/monitoring-engine';

/**
 * Which backend can reach a car here, read in a way that survives a static export.
 *
 * The detection is 'none' during prerender (there is no navigator) and a real backend in a
 * supporting browser, so reading it directly during render produced a hydration mismatch — and
 * React then abandoned that subtree's attributes, which left the connect buttons inert.
 * useSyncExternalStore with an explicit server snapshot makes the first client render agree with
 * the HTML and the second render tell the truth.
 *
 * This answers a different question from the one `connect()` asks. This one is "can anything
 * reach a car", for enabling a control; connect() re-detects at the moment of the tap, so a phone
 * that gains an OTG adapter in between does not need a reload.
 */
const noopSubscribe = () => () => {};
function useTransportKind(): TransportKind {
    return useSyncExternalStore(
        noopSubscribe,
        () => detectTransportKind(),
        () => 'none' as const,
    );
}

export function useDs2Link(
    options: {
        /**
         * The module this session talks to, and the frames its own SGBD lets the app send it.
         *
         * Read at send time. The address is LATCHED at connect: a module picked while a link is
         * open would otherwise retarget it under whatever the operator was looking at, which is why
         * the picker is disabled while connected — and why every operation re-checks it rather than
         * trusting that it was.
         */
        target: ModuleProtocol;
    } & LinkHandlers,
) {
    const { session, snapshot } = useLinkSession(options);
    const transportKind = useTransportKind();
    const { state } = snapshot;

    /**
     * The three things that protect an operation in flight, all derived from one state.
     *
     * `inFlight` is computed, never stored: there is no flag for a failure path to forget to
     * clear, and every operation returns the link to `connected` on both its success and its
     * catch path, so a throw releases all three by itself.
     *
     * This replaces an inline `beforeunload` that had neither a `returnValue` — which older
     * engines still read, and this is the one place where a silently ignored call costs a held
     * actuator its warning — nor a watchdog, so a transport that hung rather than threw would
     * have trapped the tab for the rest of the day.
     *
     * The budget is sized to the operation, which is why it is not one constant: a job run is
     * seconds, a datalog is a drive. One figure taken from the longer would let a hang hold the
     * tab for hours; taken from the shorter it would drop the guard in the middle of a real run.
     */
    const inFlight = state === 'busy' || state === 'logging';
    useUnloadGuard(inFlight, state === 'logging' ? 6 * 60 * 60 * 1000 : 5 * 60 * 1000);
    // Android's screen timeout is the ordinary way a phone interrupts itself. On desktop this is
    // close to a no-op, which is the right amount of effort for the platform that does not need
    // it. Best-effort throughout: a run must never fail because the screen could not be pinned.
    useScreenWakeLock(inFlight);
    // Cannot prevent a frozen tab; records that it happened, so a failure names its cause instead
    // of sending the next reader to look at the cable. Read at failure time, never rendered.
    const wasHidden = useHiddenWitness(inFlight);
    // Handed out rather than consumed here: this hook classifies the LINK, and whether the app was
    // backgrounded is a fact about the session. The surfaces that report a failure ask for it.
    void wasHidden;

    // Hidden and idle, the cable is let go (operator, 2026-10-28): the session decides whether it is
    // idle (`releaseWhileHidden`); the page is what can see that it was hidden.
    useEffect(() => {
        if (typeof document === 'undefined') return;
        const onVisibility = () => {
            if (document.visibilityState === 'hidden') session.releaseWhileHidden();
        };
        document.addEventListener('visibilitychange', onVisibility);
        return () => document.removeEventListener('visibilitychange', onVisibility);
    }, [session]);

    return {
        state,
        mode: snapshot.mode,
        error: snapshot.error,
        errorKind: snapshot.errorKind,
        log: snapshot.log,
        ident: snapshot.ident,
        /** Which module each address said it is on this link (lib/variants), the DME's first. */
        fitment: snapshot.fitment,
        faults: snapshot.faults,
        quickTest: snapshot.quickTest,
        rawFaults: snapshot.rawFaults,
        /** Why the last operation failed, or null: read straight after awaiting it. */
        lastError: session.lastError,
        vehicleState: snapshot.vehicleState,
        motion: snapshot.motion,
        readVehicleState: session.readVehicleState,
        adaptations: snapshot.adaptations,
        transportKind,
        connect: session.connect,
        disconnect: session.disconnect,
        reconnectPermitted: session.reconnectPermitted,
        readIdent: session.readIdent,
        readFaults: session.readFaults,
        readAdaptations: session.readAdaptations,
        runRead: session.runRead,
        clearFaults: session.clearFaults,
        lastRun: snapshot.lastRun,
        startLog: session.startLog,
        stopLog: session.stopLog,
        startProbe: session.startProbe,
        scan: snapshot.scan,
        scanProgress: snapshot.scanProgress,
        scanAll: session.scanAll,
        clearLog: session.clearLog,
        clearError: session.clearError,
    };
}

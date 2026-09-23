'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ErrorMemoryEntry } from '@tsunagi/ds2-mss54';
import type { LinkFailure, LinkMode, LinkState } from '@/hooks/useDs2Link';
import { useOnline } from '@/hooks/useOnline';
import { useLang } from '@/lib/i18n';
import {
    canSync,
    deleteCloudSession,
    deleteDiagnostic,
    fetchCloudSession,
    listCloudSessions,
    listDiagnostics,
    sendSession,
    type CloudDiagnosticRow,
    type CloudSessionRow,
} from '@/lib/sync/cloud';
import { flushErrorRecords, reportFailure, waitingErrorRecords } from '@/lib/sync/errorRecords';
import { gateStatus, reauthHref, type GateState } from '@/lib/sync/owner-sync';
import {
    excerpt,
    hasContent,
    needsSync,
    sessionLabel,
    type FailureNote,
    type SavedSession,
} from '@/lib/sync/session';
import { deleteLocal, listLocal, putLocal } from '@/lib/sync/sessionStore';
import type { Datalog } from '@/views/datalog/useDatalog';

/**
 * The failures of this page's session: kept for SAVE, and each one sent as an error record the
 * moment it happens.
 *
 * Separate from `useSessions` because it has to exist BEFORE the link does — it is the link's
 * `onFailure` — while everything else here reads the link. `enabled` is the registry's answer for
 * `sessionSync`: in production nothing is kept and nothing is sent, and `reportFailure` checks
 * `canSync()` again on its own, so the dev server keeps notes but sends nothing.
 */
export function useFailureNotes(enabled: boolean, ecuId: string) {
    const [notes, setNotes] = useState<FailureNote[]>([]);
    const ecuRef = useRef(ecuId);
    useEffect(() => {
        ecuRef.current = ecuId;
    }, [ecuId]);

    const onFailure = useCallback(
        (f: LinkFailure) => {
            if (!enabled) return;
            const lines = excerpt(f.log);
            // Bounded: a cable that fails every exchange for an hour must not grow a session past
            // what SYNC can send. The error records carry every one of them anyway.
            setNotes((prev) =>
                [...prev, { at: Date.now(), job: f.job, error: f.error, errorKind: f.errorKind, excerpt: lines }].slice(-50),
            );
            reportFailure({
                ecu: ecuRef.current,
                job: f.job,
                error: f.error,
                errorKind: f.errorKind,
                transport: f.transport,
                mock: f.mode === 'practice',
                ident: f.ident,
                excerpt: lines,
            });
        },
        [enabled],
    );

    const clear = useCallback(() => setNotes([]), []);
    return { notes, onFailure, clear };
}

export type FailureNotes = ReturnType<typeof useFailureNotes>;

/** What the last action said. One line, in the pane's reserved notice slot. */
export interface SessionsNotice {
    text: string;
    tone: 'info' | 'ok' | 'warn' | 'error';
}

/**
 * SESSIONS — the device's saved sessions, SYNC, and the account's copies.
 *
 * Lives in the shell, like the datalog, because what it saves is the shell's: the link's read, the
 * recording, the failures. The tab only draws it.
 *
 * ## One session per connection
 *
 * A session starts unsaved. The first SAVE gives it an id, and every later SAVE replaces that same
 * record — so saving twice is not two sessions, and SYNC sends it again because it changed. The
 * next successful CONNECT after a save starts a new one. A connection that was never saved does
 * not start a new one: its failures stay in the session rather than vanishing because the cable
 * was replugged.
 *
 * ## What reaches the network
 *
 * Nothing unless `canSync()` — the preview build. The dev server shows the tab and keeps sessions
 * on the device, and says it has nowhere to send them. The account calls run only when the tab is
 * open or an action needs them; a hidden tab polls nothing.
 */
export function useSessions(input: {
    enabled: boolean;
    active: boolean;
    link: {
        state: LinkState;
        mode: LinkMode;
        ident: { hex: string; length: number } | null;
        faults: ErrorMemoryEntry[] | null;
    };
    ecuId: string;
    datalog: Pick<Datalog, 'capture' | 'samples'>;
    failures: FailureNotes;
}) {
    const { t } = useLang();
    const { enabled, active, link, ecuId, datalog, failures } = input;
    const cloudEnabled = enabled && canSync();
    const online = useOnline();

    const [local, setLocal] = useState<SavedSession[] | null>(null);
    const [cloud, setCloud] = useState<CloudSessionRow[] | null>(null);
    const [diagnostics, setDiagnostics] = useState<CloudDiagnosticRow[] | null>(null);
    const [waiting, setWaiting] = useState(0);
    const [gate, setGate] = useState<{ state: GateState; label: string | null } | null>(null);
    const [busy, setBusy] = useState<string | null>(null);
    const [notice, setNotice] = useState<SessionsNotice | null>(null);

    // The session this connection is saved as, once it has been.
    const [current, setCurrent] = useState<{ id: string; createdAt: number; label: string } | null>(null);
    const [savedKey, setSavedKey] = useState<string | null>(null);

    // What is on screen, as one comparable value: whether it differs from what was last saved is
    // "unsaved work", which is what the re-sign-in confirmation protects.
    const contentKey = useMemo(
        () =>
            [
                link.ident?.hex ?? '-',
                link.faults === null ? '-' : link.faults.map((f) => f.errorCode).join(','),
                datalog.samples.length,
                failures.notes.length,
            ].join('|'),
        [link.ident, link.faults, datalog.samples.length, failures.notes.length],
    );
    const content = hasContent({
        ident: link.ident,
        faults: link.faults,
        samples: datalog.samples.length,
        failures: failures.notes.length,
    });
    const unsaved = enabled && content && contentKey !== savedKey;

    // A new connection after a saved one starts a new session.
    const clearFailures = failures.clear;
    const prevState = useRef(link.state);
    useEffect(() => {
        const was = prevState.current;
        prevState.current = link.state;
        if (was === 'connecting' && link.state === 'connected' && current !== null) {
            setCurrent(null);
            setSavedKey(null);
            clearFailures();
        }
    }, [link.state, current, clearFailures]);

    // Reads first, state after: each refresh resolves to a snapshot and one callback applies it,
    // so nothing sets state while an effect is still running.
    const refreshLocal = useCallback(
        () => (enabled ? listLocal().catch(() => [] as SavedSession[]).then(setLocal) : Promise.resolve()),
        [enabled],
    );

    const applyCloud = useCallback(
        (snap: Awaited<ReturnType<typeof readCloud>>) => {
            setGate(snap.gate);
            setWaiting(snap.waiting);
            if (snap.sessions) setCloud(snap.sessions);
            if (snap.diagnostics) setDiagnostics(snap.diagnostics);
        },
        [],
    );
    const refreshCloud = useCallback(
        () => (cloudEnabled ? readCloud().then(applyCloud) : Promise.resolve()),
        [cloudEnabled, applyCloud],
    );

    // Opened, or back online while open. Nothing is fetched for a tab nobody is looking at.
    useEffect(() => {
        if (!active) return;
        void refreshLocal();
        void refreshCloud();
    }, [active, online, refreshLocal, refreshCloud]);

    /** The session as it stands, written to this device. Returns it, or null if nothing was written. */
    const saveNow = useCallback(async (): Promise<SavedSession | null> => {
        const now = Date.now();
        const head = current ?? { id: crypto.randomUUID(), createdAt: now, label: sessionLabel(now, ecuId, link.mode === 'practice') };
        const existing = (local ?? []).find((s) => s.id === head.id);
        const session: SavedSession = {
            v: 1,
            id: head.id,
            label: head.label,
            createdAt: head.createdAt,
            updatedAt: now,
            syncedAt: existing?.syncedAt ?? null,
            appBuild: document.querySelector('meta[name="build-id"]')?.getAttribute('content') ?? null,
            ecu: ecuId,
            mock: link.mode === 'practice',
            ident: link.ident,
            faults: link.faults,
            datalog: datalog.capture(),
            failures: failures.notes,
        };
        try {
            await putLocal(session);
        } catch {
            setNotice({ text: t.sessions_saveFailed, tone: 'error' });
            return null;
        }
        setCurrent(head);
        setSavedKey(contentKey);
        return session;
    }, [current, ecuId, link.mode, link.ident, link.faults, local, datalog, failures.notes, contentKey, t]);

    const save = useCallback(async () => {
        setBusy('save');
        const s = await saveNow();
        if (s) setNotice({ text: t.sessions_saved, tone: 'ok' });
        await refreshLocal();
        setBusy(null);
    }, [saveNow, refreshLocal, t]);

    /**
     * SAVE, then send every session on this device that the account does not have yet. One
     * action — the two halves of the same flow, never a second button somewhere else.
     */
    const sync = useCallback(async () => {
        if (!cloudEnabled) return;
        setBusy('sync');
        try {
            if (unsaved && !(await saveNow())) return;
            const pending = (await listLocal()).filter(needsSync);
            if (pending.length === 0) {
                setNotice({ text: t.sessions_nothingToSend, tone: 'info' });
                return;
            }
            let sent = 0;
            for (const s of pending) {
                const r = await sendSession(s);
                if (r.ok) {
                    await putLocal({ ...s, syncedAt: s.updatedAt });
                    sent++;
                    continue;
                }
                if (r.tooLarge) {
                    // This one cannot go, ever, as it is. Say which, and let the rest go.
                    setNotice({ text: t.sessions_tooLarge(s.label), tone: 'warn' });
                    continue;
                }
                setNotice({ text: r.expired ? t.sessions_sendExpired : t.sessions_sendFailed, tone: 'error' });
                if (r.expired) setGate({ state: 'expired', label: gate?.label ?? null });
                return;
            }
            if (sent > 0) {
                setNotice((n) => (n?.tone === 'warn' ? n : { text: t.sessions_sent(sent), tone: 'ok' }));
                await flushErrorRecords();
            }
        } finally {
            await refreshLocal();
            await refreshCloud();
            setBusy(null);
        }
    }, [cloudEnabled, unsaved, saveNow, refreshLocal, refreshCloud, gate, t]);

    /**
     * An account copy back onto this device. It does not overwrite a device copy that has changes
     * the account has not seen — that would be SYNC running backwards and losing work.
     */
    const restore = useCallback(
        async (id: string) => {
            setBusy(`restore:${id}`);
            try {
                const { session, result } = await fetchCloudSession(id);
                if (!session) {
                    setNotice({ text: result.expired ? t.sessions_sendExpired : t.sessions_restoreFailed, tone: 'error' });
                    return;
                }
                const mine = (local ?? []).find((s) => s.id === id);
                if (mine && needsSync(mine) && mine.updatedAt > session.updatedAt) {
                    setNotice({ text: t.sessions_restoreNewer, tone: 'warn' });
                    return;
                }
                await putLocal({ ...session, syncedAt: session.updatedAt });
                setNotice({ text: t.sessions_restored, tone: 'ok' });
            } catch {
                setNotice({ text: t.sessions_saveFailed, tone: 'error' });
            } finally {
                await refreshLocal();
                setBusy(null);
            }
        },
        [local, refreshLocal, t],
    );

    const removeLocal = useCallback(
        async (id: string) => {
            setBusy(`local:${id}`);
            try {
                await deleteLocal(id);
                if (current?.id === id) {
                    setCurrent(null);
                    setSavedKey(null);
                }
            } finally {
                await refreshLocal();
                setBusy(null);
            }
        },
        [current, refreshLocal],
    );

    const removeCloud = useCallback(
        async (id: string) => {
            setBusy(`cloud:${id}`);
            const r = await deleteCloudSession(id);
            if (!r.ok) setNotice({ text: r.expired ? t.sessions_sendExpired : t.sessions_sendFailed, tone: 'error' });
            await refreshCloud();
            setBusy(null);
        },
        [refreshCloud, t],
    );

    const removeDiagnostic = useCallback(
        async (id: string) => {
            setBusy(`diag:${id}`);
            const r = await deleteDiagnostic(id);
            if (!r.ok) setNotice({ text: r.expired ? t.sessions_sendExpired : t.sessions_sendFailed, tone: 'error' });
            await refreshCloud();
            setBusy(null);
        },
        [refreshCloud, t],
    );

    /**
     * "Sign in again" — offered only when it cannot cost anything but a page load: the session has
     * actually expired (not merely "unknown", which is m3 being unreachable), the device is online,
     * and no link is open, so no cable, run or armed output can be cut by the navigation.
     */
    const canReauth = cloudEnabled && gate?.state === 'expired' && online && link.state === 'disconnected';
    const reauth = useCallback(() => location.assign(reauthHref()), []);

    return {
        enabled,
        cloudEnabled,
        local,
        cloud,
        diagnostics,
        waiting,
        gate,
        busy,
        notice,
        content,
        unsaved,
        /** What SAVE would write now, counted the way the lists count a saved one. */
        current: {
            faults: link.faults === null ? null : link.faults.length,
            samples: datalog.samples.length,
            failures: failures.notes.length,
        },
        pending: (local ?? []).filter(needsSync).length,
        canReauth,
        save,
        sync,
        restore,
        removeLocal,
        removeCloud,
        removeDiagnostic,
        reauth,
    };
}

export type Sessions = ReturnType<typeof useSessions>;

/**
 * The account's side, read in one go: the lists, the gate's state, and the outbox. When the gate
 * says the owner is signed in and records are waiting, they are sent here — an owner who signed in
 * again has just made the thing they were waiting for possible.
 */
async function readCloud() {
    const [s, d, gate, n] = await Promise.all([listCloudSessions(), listDiagnostics(), gateStatus(), waitingErrorRecords()]);
    let waiting = n;
    if (gate.state === 'active' && n > 0) {
        await flushErrorRecords();
        waiting = await waitingErrorRecords();
    }
    return {
        gate,
        waiting,
        sessions: s.ok && s.data ? s.data.sessions : null,
        diagnostics: d.ok && d.data ? d.data.diagnostics : null,
    };
}

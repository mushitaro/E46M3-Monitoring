'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { currentPlan, runnablePlan, type NotebookEntry } from '@/lib/notebook/rules';
import { listAllEntries } from '@/lib/notebook/store';
import { emptyBoard, move, toggle, type Board } from '@/lib/probe/board';
import { getBoard, probeChanges, putBoard } from '@/lib/probe/boardStore';
import { listRuns, type StoredRun } from '@/lib/probe/runStore';
import { lineage, nextSession, probeSessions, type NextRefusal } from '@/lib/probe/sessions';

/**
 * PROBE's two tabs, as the page holds them: the sessions on the device (STARTUP), the one opened on
 * the screen, its series, its runs and its board (PROBE).
 *
 * Read from the device whenever the PROBE side changes (lib/probe/boardStore `probeChanged`): an
 * entry written by the assistant, the desk or this screen, a run kept, a board rearranged.
 *
 * The session on the screen is the one opened — by STARTUP, NEW SESSION, NEXT, or the assistant
 * (monitoring_session, monitoring_show, monitoring_investigate) — and, before any was, the one with
 * the newest plan. `opened()` is read through a ref, so a call that opens a session and a call that
 * follows it see the same one without waiting for a render.
 *
 * WORKS only (`enabled`), like everything PROBE keeps.
 */
export function useProbeSessions(input: { enabled: boolean; write: (entries: NotebookEntry[]) => Promise<void> }) {
    const { enabled, write } = input;
    const version = useSyncExternalStore(probeChanges.subscribe, probeChanges.snapshot, () => 0);
    const [data, setData] = useState<{ entries: NotebookEntry[]; runs: Map<string, StoredRun[]> }>({ entries: [], runs: new Map() });
    const [open, setOpenState] = useState<{ id: string; at: number } | null>(null);
    const openRef = useRef<{ id: string; at: number } | null>(null);
    const [board, setBoard] = useState<Board | null>(null);
    const [now, setNow] = useState(0);

    useEffect(() => {
        if (!enabled) return;
        let live = true;
        void (async () => {
            const entries = await listAllEntries().catch(() => [] as NotebookEntry[]);
            const ids = [...new Set(entries.map((e) => e.sessionId))];
            const runs = new Map(await Promise.all(ids.map(async (id) => [id, await listRuns(id).catch(() => [] as StoredRun[])] as const)));
            if (!live) return;
            setData({ entries, runs });
            setNow(Date.now());
        })();
        return () => {
            live = false;
        };
    }, [enabled, version]);

    const setOpen = useCallback((id: string) => {
        const next = { id, at: Date.now() };
        openRef.current = next;
        setOpenState(next);
    }, []);

    /** The session on the screen: the one opened, else the one with the newest plan, else the newest. */
    const current = useMemo(() => {
        if (open) return open.id;
        let best: { id: string; at: number; planned: boolean } | null = null;
        const by = new Map<string, NotebookEntry[]>();
        for (const e of data.entries) by.set(e.sessionId, [...(by.get(e.sessionId) ?? []), e]);
        for (const [id, r] of by) {
            const plan = currentPlan(r).plan;
            const at = plan ? plan.at : r[r.length - 1].at;
            const planned = plan !== null;
            if (!best || (planned && !best.planned) || (planned === best.planned && at > best.at)) best = { id, at, planned };
        }
        return best?.id ?? null;
    }, [open, data.entries]);

    // The board of the session on the screen.
    useEffect(() => {
        if (!enabled || !current) return;
        let live = true;
        void getBoard(current)
            .catch(() => emptyBoard(current))
            .then((b) => {
                if (live) setBoard(b);
            });
        return () => {
            live = false;
        };
    }, [enabled, current, version]);

    const fresh = open && !data.entries.some((e) => e.sessionId === open.id) ? open : null;
    const counts = useMemo(() => new Map([...data.runs].map(([id, rs]) => [id, rs.length])), [data.runs]);
    const sessions = useMemo(() => probeSessions(data.entries, counts, now, fresh), [data.entries, counts, now, fresh]);
    const series = useMemo(() => (current ? lineage(data.entries, current) : []), [data.entries, current]);
    const runs = current ? (data.runs.get(current) ?? []) : [];
    const runnable = current ? runnablePlan(data.entries, now, current).ok : false;

    /** NEW SESSION: an empty session on the screen. Its id. */
    const newSession = useCallback(() => {
        const id = crypto.randomUUID();
        setOpen(id);
        return id;
    }, [setOpen]);

    /** NEXT, pressed on the screen: the owner carries the session on. Null when done; else why not. */
    const next = useCallback(async (): Promise<NextRefusal | null> => {
        if (!current) return 'no-mandate';
        const n = nextSession(data.entries, current, data.runs.get(current)?.length ?? 0, { now: Date.now(), newId: () => crypto.randomUUID(), by: 'owner' });
        if (!n.ok) return n.reason;
        await write(n.entries);
        setOpen(n.record);
        return null;
    }, [current, data, write, setOpen]);

    /** Why NEXT would not carry the session on now, or null when it would. */
    const nextBlocked: NextRefusal | null = useMemo(() => {
        if (!current) return 'no-mandate';
        const n = nextSession(data.entries, current, data.runs.get(current)?.length ?? 0, { now: 1, newId: () => 'x'.repeat(8), by: 'owner' });
        return n.ok ? null : n.reason;
    }, [current, data]);

    const rearrange = useCallback(
        (f: (b: Board) => Board) => {
            if (!board || board.record !== current) return;
            const b = f(board);
            setBoard(b);
            void putBoard(b).catch(() => {});
        },
        [board, current],
    );

    return {
        entries: data.entries,
        runsOf: (id: string) => data.runs.get(id) ?? [],
        sessions,
        /** The session on the screen, and whether NEW SESSION opened it with nothing in it yet. */
        current,
        fresh: fresh !== null,
        series,
        runs,
        runnable,
        board: board && board.record === current ? board : null,
        /** The session the screen or the assistant opened, as of now (not the last render). */
        opened: () => openRef.current?.id ?? null,
        open: setOpen,
        newSession,
        next,
        nextBlocked,
        toggle: (id: string) => rearrange((b) => toggle(b, id)),
        move: (id: string, by: -1 | 1) => rearrange((b) => move(b, id, by)),
    };
}

export type ProbeSessions = ReturnType<typeof useProbeSessions>;

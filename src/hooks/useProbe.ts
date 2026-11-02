'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { useDs2Link } from '@/hooks/useDs2Link';
import type { EcuIndex } from '@/lib/ecuCatalog';
import type { Ledger } from '@/lib/ledger';
import { runnablePlan, type NotebookEntry, type RunnablePlan } from '@/lib/notebook/rules';

type RunnablePlanRefusal = Extract<RunnablePlan, { ok: false }>['reason'];
import { listAllEntries } from '@/lib/notebook/store';
import { probeChanged } from '@/lib/probe/boardStore';
import { loadProbeModules } from '@/lib/probe/modules';
import { listRuns, putRun, type ProbeLive, type StoredRun } from '@/lib/probe/runStore';

export interface ProbeProgress {
    v: number;
    settled: number;
    total: number;
    samples: number;
}

/**
 * PROBE on this tab: the plan the CO-WORK record on the device says may run, started by a person
 * (PROBE in the sub-action row, before driving) or by the assistant in an AI mode, and stopped from
 * the hub like a recording.
 *
 * The plan is read when the run starts and not again until it ends: a new version written while
 * the car is moving is taken at the next start, which is a person pressing PROBE, parked. The
 * ledger is read through a ref, so a kill list that lands mid-run applies to the next frame.
 *
 * WORKS only (lib/features.ts `probe`): disabled, it reads no record and offers nothing.
 */
export function useProbe(input: {
    enabled: boolean;
    link: ReturnType<typeof useDs2Link>;
    index: EcuIndex | null;
    ledger: Ledger;
}) {
    const { enabled, link, index } = input;
    const [runnable, setRunnable] = useState<RunnablePlan>({ ok: false, reason: 'none' });
    const [progress, setProgress] = useState<ProbeProgress | null>(null);
    const [lastRun, setLastRun] = useState<StoredRun | null>(null);
    const liveRef = useRef<ProbeLive | null>(null);
    const ledgerRef = useRef(input.ledger);
    useEffect(() => {
        ledgerRef.current = input.ledger;
    }, [input.ledger]);

    const read = useCallback(
        (): Promise<NotebookEntry[]> => (enabled ? listAllEntries().catch(() => []) : Promise.resolve([])),
        [enabled],
    );

    /** Read the record again: what the bridge calls after it writes a plan. STARTUP and the board read again too. */
    const refresh = useCallback(
        () =>
            read().then((entries) => {
                setRunnable(runnablePlan(entries, Date.now()));
                probeChanged();
            }),
        [read],
    );

    // Re-read whenever no run is holding a plan — on connect, on disconnect, and when a run ends.
    useEffect(() => {
        if (progress !== null) return;
        let live = true;
        void read().then((entries) => {
            if (live) setRunnable(runnablePlan(entries, Date.now()));
        });
        return () => {
            live = false;
        };
    }, [progress, read, link.state]);

    /**
     * Start a run: the screen's PROBE, or the assistant's `monitoring_probe` naming a record
     * (operator, 2026-11-01: in an AI mode the assistant runs the observation). Resolves once the
     * run has begun — with which record, plan and run — or with why it could not; the run itself
     * goes on until it ends or is stopped.
     */
    const start = useCallback(
        async (record?: string): Promise<{ started: true; record: string; v: number; n: number } | { started: false; reason: RunnablePlanRefusal | 'off' | 'running' }> => {
            if (!enabled || !index) return { started: false, reason: 'off' };
            if (liveRef.current) return { started: false, reason: 'running' };
            // Taken now, from the record as it stands: the plan this run holds until it ends.
            const r = runnablePlan(await read(), Date.now(), record);
            if (!r.ok) return { started: false, reason: r.reason };
            const { body, id } = r.entry;
            const modules = await loadProbeModules(body.steps, index);
            const n = (await listRuns(r.sessionId).catch(() => [])).length + 1;
            const live: ProbeLive = { sessionId: r.sessionId, n, startedAt: Date.now(), planV: body.v, samples: [] };
            liveRef.current = live;
            const total = body.steps.filter((s) => s.kind === 'faults' || s.kind === 'read' || s.kind === 'adapt').length;
            const settled = new Set<number>();
            let samples = 0;
            setProgress({ v: body.v, settled: 0, total, samples: 0 });
            void (async () => {
                try {
                    const run = await link.startProbe(
                        { id, v: body.v, steps: body.steps, judge: body.judge },
                        {
                            module: (m) => modules.get(m) ?? null,
                            ledger: () => ledgerRef.current,
                            onSample: (s) => {
                                samples++;
                                live.samples.push(s);
                                setProgress({ v: body.v, settled: settled.size, total, samples });
                            },
                            onStep: (n, state) => {
                                if (state !== 'pending') settled.add(n);
                                setProgress({ v: body.v, settled: settled.size, total, samples });
                            },
                        },
                    );
                    if (run) {
                        const stored: StoredRun = { ...run, id: `${r.sessionId}-run-${n}-${run.startedAt}`, sessionId: r.sessionId, n, mock: link.mode === 'practice' };
                        setLastRun(stored);
                        // Kept for the desk and the next conversation; a failed write loses the copy, not the run.
                        await putRun(stored).catch(() => {});
                        probeChanged();
                    }
                } finally {
                    liveRef.current = null;
                    setProgress(null);
                }
            })();
            return { started: true, record: r.sessionId, v: body.v, n };
        },
        [enabled, index, link, read],
    );

    const live = useCallback(() => liveRef.current, []);

    return {
        /** A plan may run: the record's current plan, its mandate standing. */
        available: enabled && runnable.ok ? { v: runnable.entry.body.v, purpose: runnable.entry.body.purpose } : null,
        /** Present while a plan runs. */
        progress,
        lastRun,
        /** The run in progress, read at the moment of asking (the bridge's moment and clock). */
        live,
        start,
        stop: link.stopLog,
        refresh,
    };
}

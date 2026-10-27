'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { useDs2Link } from '@/hooks/useDs2Link';
import type { EcuIndex } from '@/lib/ecuCatalog';
import type { Ledger } from '@/lib/ledger';
import { runnablePlan, type NotebookEntry, type RunnablePlan } from '@/lib/notebook/rules';
import { listAllEntries } from '@/lib/notebook/store';
import type { ProbeRun } from '@/lib/probe/executor';
import { loadProbeModules } from '@/lib/probe/modules';

export interface ProbeProgress {
    v: number;
    settled: number;
    total: number;
    samples: number;
}

/**
 * PROBE on this tab: the plan the CO-WORK record on the device says may run, started by a person
 * (PROBE in the sub-action row, before driving) and stopped from the hub like a recording.
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
    const [lastRun, setLastRun] = useState<ProbeRun | null>(null);
    const ledgerRef = useRef(input.ledger);
    useEffect(() => {
        ledgerRef.current = input.ledger;
    }, [input.ledger]);

    const read = useCallback(
        (): Promise<NotebookEntry[]> => (enabled ? listAllEntries().catch(() => []) : Promise.resolve([])),
        [enabled],
    );

    /** Read the record again: what the bridge calls after it writes a plan. */
    const refresh = useCallback(() => read().then((entries) => setRunnable(runnablePlan(entries, Date.now()))), [read]);

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

    const start = useCallback(async () => {
        if (!enabled || !index) return;
        // Taken now, from the record as it stands: the plan this run holds until it ends.
        const r = runnablePlan(await read(), Date.now());
        if (!r.ok) return;
        const { body, id } = r.entry;
        const modules = await loadProbeModules(body.steps, index);
        const total = body.steps.filter((s) => s.kind === 'faults' || s.kind === 'read').length;
        const settled = new Set<number>();
        let samples = 0;
        setProgress({ v: body.v, settled: 0, total, samples: 0 });
        try {
            const run = await link.startProbe(
                { id, v: body.v, steps: body.steps, judge: body.judge },
                {
                    module: (m) => modules.get(m) ?? null,
                    ledger: () => ledgerRef.current,
                    onSample: () => {
                        samples++;
                        setProgress({ v: body.v, settled: settled.size, total, samples });
                    },
                    onStep: (n, state) => {
                        if (state !== 'pending') settled.add(n);
                        setProgress({ v: body.v, settled: settled.size, total, samples });
                    },
                },
            );
            if (run) setLastRun(run);
        } finally {
            setProgress(null);
        }
    }, [enabled, index, link, read]);

    return {
        /** A plan may run: the record's current plan, its mandate standing. */
        available: enabled && runnable.ok ? { v: runnable.entry.body.v, purpose: runnable.entry.body.purpose } : null,
        /** Present while a plan runs. */
        progress,
        lastRun,
        start,
        stop: link.stopLog,
        refresh,
    };
}

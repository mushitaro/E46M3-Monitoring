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
import { appNow } from '@/lib/clock';

export interface ProbeProgress {
    v: number;
    settled: number;
    total: number;
    samples: number;
    /** Times this start has begun the plan again after the line dropped. */
    resumes: number;
    /** Waiting to begin it again. */
    resuming: boolean;
}

/**
 * After a run ends `link-lost`, the same plan (the version this start took) begins again by itself
 * after each of these waits, then gives up. The owner is driving and does not press PROBE again;
 * each attempt is its own run in the record, so the gap between them stays visible.
 */
const RESUME_AFTER_MS = [3_000, 10_000, 30_000];

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
    /** Set while a start holds a plan, its runs and the waits between them. */
    const holdingRef = useRef(false);
    const stopRef = useRef(false);
    const ledgerRef = useRef(input.ledger);
    const linkRef = useRef(link);
    useEffect(() => {
        ledgerRef.current = input.ledger;
        linkRef.current = link;
    });

    const read = useCallback(
        (): Promise<NotebookEntry[]> => (enabled ? listAllEntries().catch(() => []) : Promise.resolve([])),
        [enabled],
    );

    /** Read the record again: what the bridge calls after it writes a plan. STARTUP and the board read again too. */
    const refresh = useCallback(
        () =>
            read().then((entries) => {
                setRunnable(runnablePlan(entries, appNow()));
                probeChanged();
            }),
        [read],
    );

    // Re-read whenever no run is holding a plan — on connect, on disconnect, and when a run ends.
    useEffect(() => {
        if (progress !== null) return;
        let live = true;
        void read().then((entries) => {
            if (live) setRunnable(runnablePlan(entries, appNow()));
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
            if (holdingRef.current) return { started: false, reason: 'running' };
            // Taken now, from the record as it stands: the plan this run holds until it ends.
            const r = runnablePlan(await read(), appNow(), record);
            if (!r.ok) return { started: false, reason: r.reason };
            const { body, id } = r.entry;
            const modules = await loadProbeModules(body.steps, index);
            let n = (await listRuns(r.sessionId).catch(() => [])).length + 1;
            const first = n;
            holdingRef.current = true;
            stopRef.current = false;
            const total = body.steps.filter((s) => s.kind === 'faults' || s.kind === 'read' || s.kind === 'adapt').length;
            const waited = async (ms: number) => {
                for (let left = ms; left > 0; left -= 250) {
                    if (stopRef.current) return false;
                    await new Promise((res) => setTimeout(res, Math.min(250, left)));
                }
                return !stopRef.current;
            };
            void (async () => {
                try {
                    for (let resumes = 0; ; resumes++) {
                        const live: ProbeLive = { sessionId: r.sessionId, n, startedAt: appNow(), planV: body.v, samples: [] };
                        liveRef.current = live;
                        const settled = new Set<number>();
                        let samples = 0;
                        const show = () => setProgress({ v: body.v, settled: settled.size, total, samples, resumes, resuming: false });
                        show();
                        const run = await linkRef.current.startProbe(
                            { id, v: body.v, steps: body.steps, judge: body.judge },
                            {
                                module: (m) => modules.get(m) ?? null,
                                ledger: () => ledgerRef.current,
                                onStart: (written) => {
                                    live.run = written;
                                },
                                onSample: (s) => {
                                    samples++;
                                    live.samples.push(s);
                                    show();
                                },
                                onStep: (k, state) => {
                                    if (state !== 'pending') settled.add(k);
                                    show();
                                },
                            },
                        );
                        liveRef.current = null;
                        if (!run) break;
                        const stored: StoredRun = { ...run, id: `${r.sessionId}-run-${n}-${run.startedAt}`, sessionId: r.sessionId, n, mock: linkRef.current.mode === 'practice' };
                        setLastRun(stored);
                        // Kept for the desk and the next conversation; a failed write loses the copy, not the run.
                        await putRun(stored).catch(() => {});
                        probeChanged();
                        if (run.end !== 'link-lost' || stopRef.current || resumes >= RESUME_AFTER_MS.length) break;
                        setProgress({ v: body.v, settled: settled.size, total, samples, resumes, resuming: true });
                        if (!(await waited(RESUME_AFTER_MS[resumes]))) break;
                        // A cable that closed is opened again — only the one this device already allowed
                        // (the screen chose it; useDs2Link `reconnectPermitted`).
                        if (linkRef.current.state === 'disconnected') {
                            await linkRef.current.reconnectPermitted();
                            if (!(await waited(500))) break;
                        }
                        n++;
                    }
                } finally {
                    liveRef.current = null;
                    holdingRef.current = false;
                    setProgress(null);
                }
            })();
            return { started: true, record: r.sessionId, v: body.v, n: first };
        },
        [enabled, index, read],
    );

    const live = useCallback(() => liveRef.current, []);

    /** Ends the run, and the waits to begin it again. */
    const stop = useCallback(() => {
        stopRef.current = true;
        linkRef.current.stopLog();
    }, []);

    return {
        /** A plan may run: the record's current plan, its mandate standing. */
        available: enabled && runnable.ok ? { v: runnable.entry.body.v, purpose: runnable.entry.body.purpose } : null,
        /** Present while a plan runs. */
        progress,
        lastRun,
        /** The run in progress, read at the moment of asking (the bridge's moment and clock). */
        live,
        start,
        stop,
        refresh,
    };
}

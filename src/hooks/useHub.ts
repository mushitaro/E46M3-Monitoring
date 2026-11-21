'use client';

import { CircleDot, Database, Loader2, Play, PlayCircle, PlugZap, Radar, Radio, SkipForward, Square, Zap } from 'lucide-react';
import type { HubConfig, NoticeTone } from '@/components/Hub';
import type { useDs2Link } from '@/hooks/useDs2Link';
import type { ProbeProgress } from '@/hooks/useProbe';
import { appNow, hasIdent, mayTryFaultRead, type ModuleProtocol } from '@tsunagi/monitoring-engine';
import { hubConfigFor, hubNoticeFor } from '@/lib/hub';
import { variantRefusalLine } from '@/lib/notSentText';
import { jobRiskOf, type CatalogJob } from '@tsunagi/monitoring-engine';
import { useLang } from '@/lib/i18n';
import { operationFor } from '@tsunagi/monitoring-engine';
import type { RunBlockKey, RunVerdict } from '@tsunagi/monitoring-engine';
import { TEST_ID } from '@/lib/testIds';
import type { Tab } from '@/lib/tabs';
import { viewHubFor, type ActuatorRing } from '@/lib/viewHub';
import { hasDecoder } from '@/views/adaptation/AdaptationView';
import type { Datalog } from '@/views/datalog/useDatalog';

/**
 * The hub, resolved — and the one notice line that goes above it.
 *
 * Two pure functions decide this and neither of them may import React: the
 * link's tiers in `lib/hub`, the view's in `lib/viewHub`. What is left is
 * plumbing — which glyph means READ, which string table entry, which handler —
 * and it is here so the shell states WHAT is true rather than how it is spelled.
 *
 * The glyphs are chosen once, in this file. `Loader2` rather than the state's own
 * icon for BUSY is the load-bearing one: `animate-spin` rotates whatever it is
 * handed, and a plug or a bolt spun end over end reads as a corrupt icon instead
 * of as progress, at the two moments the operator most needs to believe the tool
 * is alive.
 */
export function useHub(input: {
    tab: Tab;
    link: ReturnType<typeof useDs2Link>;
    datalog: Datalog;
    practiceArmed: boolean;
    ecuId: string;
    /** What the module's own SGBD lets the app send it (lib/moduleProtocol). */
    target: ModuleProtocol;
    selectedJob: CatalogJob | null;
    runVerdict: RunVerdict | null;
    catalogError: string | null;
    /** Present when the selected job is an SMG II procedure. Opens its wizard. */
    openProcedure?: () => void;
    /** That procedure's own gate (`mayRunProcedure` on a car), null when it may run. */
    procedureRefusal?: RunBlockKey | null;
    /** ACTUATOR's chosen row, as its ring presses it (views/actuator/ActuatorView). */
    actuator?: ActuatorRing | null;
    /** A job that drives something: confirmed on the screen first (the owner's rule), then sent with its permit. */
    confirmRun?: () => void;
    /** Present while a PROBE plan runs (hooks/useProbe). */
    probe?: { progress: ProbeProgress; stop: () => void; moduleName?: (id: string) => string };
    /** Present on DIAGNOSIS with ALL MODULES: the scan, and how far one in progress has got. */
    scan?: { run: () => void; progress: { done: number; total: number } | null };
    /** PROBE's board: run the session on the screen (views/probe). */
    probeRun?: { runnable: boolean; run: () => void };
    /**
     * Something driven is on — an actuator output (`actuator`) or an SMG II procedure. The ring is its
     * STOP on every tab, and `line` (what, and the seconds left) is the notice under which it stands.
     */
    engaged?: { stop: () => void; line?: string; actuator: boolean };
    /** STARTUP: NEXT, and why it cannot go yet. */
    startup?: { next: () => void; blocked: string | null };
    /** MEMORY: SAVE, worded as its state. */
    memory?: { label: string; disabled: boolean; save: () => void };
}): { hub: HubConfig; notice: { text?: string; tone: NoticeTone } } {
    const { t } = useLang();
    const { link, datalog, selectedJob, runVerdict } = input;

    const hub = hubConfigFor({
        // While something is driven, the ring is its STOP — red and still (`armed-danger`), on every tab
        // (docs/UX-DESIGN.md §1). The actuator's carries the hook the row's STOP had.
        engaged: input.engaged
            ? {
                  label: t.hub_stop,
                  Icon: Square,
                  tone: 'armed-danger',
                  onClick: input.engaged.stop,
                  notice: input.engaged.line,
                  testId: input.engaged.actuator ? TEST_ID.actuatorStop : undefined,
              }
            : null,
        linkState: link.state,
        practiceArmed: input.practiceArmed,
        connect: (mode) => void link.connect(mode),
        fromView: viewHubFor({
            tab: input.tab,
            linkState: link.state,
            t: {
                hub_read: t.hub_read,
                hub_record: t.hub_record,
                hub_stop: t.hub_stop,
                hub_connected: t.hub_connected,
                op_run: t.op_run,
                op_start: t.op_start,
                samples: t.samples,
                hub_pickRow: t.hub_pickRow,
                hub_noReadFrame: t.hub_noReadFrame,
                hub_dmeOnly: t.hub_dmeOnly,
                next_session: t.next_session,
                probe_notRunnable: t.probe_notRunnable,
                // The notice line's form: the conclusion, then the reason in a word (UX-30, docs/UX-DESIGN.md §2).
                runBlock: (reason) => t.hub_wontSend(t.runBlockShort[reason]),
            },
            icons: { read: Zap, record: Radio, stop: Square, idle: CircleDot, run: Play, start: PlayCircle, probe: Radar, next: SkipForward, save: Database },
            probeRun: input.probeRun,
            actuator: input.actuator ?? null,
            startup: input.startup,
            memory: input.memory,
            probe: input.probe
                ? {
                      line: input.probe.progress.resuming
                          ? t.probe_resuming(input.probe.progress.v, input.probe.progress.resumes)
                          : [
                                t.probe_line(input.probe.progress.v, input.probe.progress.settled, input.probe.progress.total, input.probe.progress.samples),
                                input.probe.progress.refused ? t.probe_refused(input.probe.progress.refused) : null,
                                input.probe.progress.reading ? t.probe_reading(input.probe.moduleName?.(input.probe.progress.reading) ?? input.probe.progress.reading) : null,
                            ]
                                .filter(Boolean)
                                .join(' · '),
                      stop: input.probe.stop,
                  }
                : undefined,
            // IDENT first where the module has one, then the fault memory — and only the reads its own
            // SGBD carries, so a module with fault frames but no IDENT is not sent a refused IDENT.
            readFaults: () =>
                void (hasIdent(input.target) ? link.readIdent() : Promise.resolve(null)).then(() =>
                    mayTryFaultRead(input.target) ? link.readFaults() : null,
                ),
            faultsAvailable: hasIdent(input.target) || mayTryFaultRead(input.target),
            scan: input.scan
                ? { run: input.scan.run, line: input.scan.progress ? t.scan_progress(input.scan.progress.done, input.scan.progress.total) : undefined }
                : undefined,
            datalog: {
                decoded: input.target.decoder === 'mss54',
                sampleCount: datalog.samples.length,
                // The car's speed from the link only while it is fresh (a recording without block 19 does not renew it).
                recordingLine: recordingLine(
                    datalog,
                    link.vehicleState && appNow() - link.vehicleState.at < 5_000 ? link.vehicleState.speedKmh : null,
                    t.datalog_hubLine,
                ),
                stoppedLine: !datalog.running && datalog.samples.length > 0 ? stoppedLine(datalog, t.datalog_stoppedLine) : undefined,
                start: datalog.start,
                stop: datalog.stop,
            },
            adaptation: { decoded: hasDecoder(input.ecuId), read: () => void link.readAdaptations() },
            service: {
                selected: selectedJob
                    ? { isProcedure: operationFor(selectedJob).kind === 'procedure', risk: jobRiskOf(selectedJob) }
                    : null,
                verdict: runVerdict,
                openProcedure: input.openProcedure,
                procedureRefusal: input.procedureRefusal ?? null,
                run: () => {
                    // The gate's answer, used — not re-derived. `mayRun` decided
                    // this once, and the hub and the panel read the same object.
                    if (runVerdict?.allowed === true && selectedJob) {
                        if (runVerdict.actuation) input.confirmRun?.();
                        else void link.runRead(selectedJob.id, runVerdict.telegram.hex, runVerdict.requires);
                    }
                },
            },
        }),
        t: {
            hub_connect: t.hub_connect,
            hub_connecting: t.hub_connecting,
            hub_busy: t.hub_reading,
            hub_connected: t.hub_connected,
            mode_practice: t.mode_practice,
        },
        icons: { plug: PlugZap, loader: Loader2, idle: CircleDot },
    });

    // One line, one precedence: a link error outranks a catalog error outranks
    // whatever the hub wanted to say about cost or progress. The hub's own
    // notice is never urgent, so it always loses.
    const notice = hubNoticeFor({
        // A refusal for the module at the address said in the reader's words (SC10); any other error as the link gives it.
        linkError: link.error ? (variantRefusalLine(link.error, t) ?? link.error) : undefined,
        catalogError: input.catalogError ?? undefined,
        viewNotice: hub.notice,
    });

    return { hub, notice };
}

/** The line once a recording is stopped: 止めました · m:ss · samples (UX-04: the press's result, not MAIN's cost again). */
function stoppedLine(datalog: Datalog, line: (elapsed: string, samples: number) => string): string {
    const last = datalog.samples[datalog.samples.length - 1];
    const elapsed = last ? `${Math.floor(last.time / 60)}:${String(Math.floor(last.time % 60)).padStart(2, '0')}` : '0:00';
    return line(elapsed, datalog.samples.length);
}

/** The hub's line while a recording runs: 記録中 m:ss · rpm · km/h · samples, from the latest sample. */
function recordingLine(datalog: Datalog, linkKmh: number | null, line: (elapsed: string, rpm: string, kmh: string, samples: number) => string): string {
    const last = datalog.samples[datalog.samples.length - 1];
    const v = datalog.latest as Partial<Record<string, number | null>>;
    const rpm = v['3:n'] ?? v['35:n'] ?? null;
    const kmh = v['19:v'] ?? linkKmh;
    const elapsed = last ? `${Math.floor(last.time / 60)}:${String(Math.floor(last.time % 60)).padStart(2, '0')}` : '0:00';
    return line(elapsed, typeof rpm === 'number' ? String(Math.round(rpm)) : '—', typeof kmh === 'number' ? String(Math.round(kmh)) : '—', datalog.samples.length);
}

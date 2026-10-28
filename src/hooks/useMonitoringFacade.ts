'use client';

import { formatErrorCode } from '@tsunagi/ds2-mss54';
import type { useDs2Link } from '@/hooks/useDs2Link';
import type { useProbe } from '@/hooks/useProbe';
import type { TabFacade } from '@/lib/bridge/handlers';
import { jobRiskOf, loadEcuCatalog, text as resolveText, type EcuIndex, type EcuProfile, type JobClass } from '@/lib/ecuCatalog';
import { normCode } from '@/lib/faultCode';
import { en } from '@/lib/i18n/en';
import { TUNER_WORKS } from '@/lib/links';
import type { Ledger } from '@/lib/ledger';
import type { ModuleProtocol } from '@/lib/moduleProtocol';
import { addEntries, listAllEntries } from '@/lib/notebook/store';
import { mayRun, mayRunProtocolRead } from '@/lib/runGate';
import { canSync } from '@/lib/sync/cloud';
import { needsSync, summarise } from '@/lib/sync/session';
import { listLocal } from '@/lib/sync/sessionStore';
import type { Tab } from '@/lib/tabs';
import { bestTelegram, loadTelegrams } from '@/lib/telegrams';
import { LAUNCHER_QUERY, deviceLabel, isHeadUnit, type DeviceKind } from '@/hooks/useAssistantBridge';
import type { Datalog } from '@/views/datalog/useDatalog';
import type { Sessions } from '@/views/sessions/useSessions';

/**
 * The page, as the assistant bridge sees it (lib/bridge/handlers `TabFacade`).
 *
 * Built every render from what the page already holds, and read by the bridge client at the moment
 * a call arrives. It answers in English: the assistant speaks to the driver in the driver's
 * language, and a refusal's sentence is the gate's own (en.runBlock), so what the screen and the
 * assistant say cannot drift apart in meaning. No VIN: the IDENT answer, which can carry one, is
 * never part of an answer, and neither is a session's.
 *
 * What it can reach is what the screen's own controls reach — READ, RECORD and its STOP, SAVE,
 * SYNC, a tab, a job selected on SERVICE — and nothing else. Running a job is not one of them.
 */
const KINDS: Record<string, readonly JobClass[]> = {
    read: ['read'],
    test: ['test'],
    calibration: ['calibration'],
    live: ['read'],
};

export function useMonitoringFacade(input: {
    link: ReturnType<typeof useDs2Link>;
    ecuId: string;
    ecuIndex: EcuIndex | null;
    catalog: EcuProfile | null;
    target: ModuleProtocol;
    ledger: Ledger;
    datalog: Datalog;
    sessions: Sessions;
    probe: ReturnType<typeof useProbe>;
    tab: Tab;
    changeTab: (tab: Tab) => void;
    selectJob: (job: EcuProfile['jobs'][number]) => void;
    /** A newer build is downloaded; it is taken once the link has been down a minute (lib/adoptBuild). */
    updateWaiting: boolean;
    /** Bring the delegated investigations level with the account (hooks/useInvestigationSync). */
    syncInvestigations: () => void;
    /** The name a device answers as when the owner gave it none. */
    defaultDevice: Record<DeviceKind, string>;
}): TabFacade {
    const { link, ecuId, ecuIndex, catalog, target, ledger, datalog, sessions, probe, tab } = input;
    const moduleName = (id: string) => ecuIndex?.modules.find((m) => m.id === id)?.name_en ?? id;
    const running = probe.progress !== null;

    return {
        now: () => Date.now(),
        newId: () => crypto.randomUUID(),

        status: () => ({
            device: deviceLabel(input.defaultDevice),
            practice: link.mode === 'practice',
            link: link.state,
            module: { id: ecuId, name: moduleName(ecuId) },
            speedKmh: link.vehicleState?.speedKmh ?? null,
            speedReadAt: link.vehicleState ? new Date(link.vehicleState.at).toISOString() : null,
            // The speed preflight's verdict: parked, moving or unknown (not read, or too old).
            car: link.motion,
            recording: link.state === 'logging' && !running,
            probe: running
                ? { running: true, ...probe.progress }
                : { running: false, planReady: probe.available ? { v: probe.available.v, purpose: probe.available.purpose } : null },
            screen: tab,
            error: link.error,
            // Said so the assistant can tell the driver: it is taken once the link is down a minute, nothing unsaved.
            newBuildWaiting: input.updateWaiting,
        }),

        faults: (moduleId) => {
            if (moduleId && moduleId !== ecuId) {
                return { module: moduleId, read: false, reason: `Not read in this session: the screen is connected to ${moduleName(ecuId)}. Switching modules is done on the screen, parked.` };
            }
            if (link.faults !== null) {
                const byCode = new Map((catalog?.faultText ?? []).map((f) => [normCode(f.code), f]));
                return {
                    module: ecuId,
                    read: true,
                    decoded: true,
                    faults: link.faults.map((f) => {
                        const code = formatErrorCode(f.errorCode);
                        const known = byCode.get(normCode(code));
                        return {
                            code,
                            type: formatErrorCode(f.errorType),
                            text: known && catalog ? resolveText(catalog, known.text, 'en').text : null,
                            inTable: !!known,
                            frequency: f.frequencyCounter,
                            freezeFrames: f.environmentSets.length,
                        };
                    }),
                };
            }
            if (link.rawFaults !== null) {
                return { module: ecuId, read: true, decoded: false, note: 'No decoder for this module: the answer is kept as bytes.', raw: link.rawFaults };
            }
            return { module: ecuId, read: false, reason: 'Not read yet in this session.' };
        },

        refreshFaults: async () => {
            if (link.state !== 'connected') return `The link is ${link.state}; faults are read when it is connected and idle.`;
            if (!target.ident && target.faults.length === 0) return en.faults_notEstablished;
            // The gate's answer for each read (a withdrawn read, a car measured moving), then the
            // link's own preflight measures the speed again just before the bytes go.
            const ident = mayRunProtocolRead(`${ecuId}:IDENT`, 'module', ledger, link.motion);
            const fs = mayRunProtocolRead(`${ecuId}:FS_LESEN`, 'module', ledger, link.motion);
            if (!fs.allowed) return en.runBlock[fs.reason];
            try {
                if (target.ident && ident.allowed) await link.readIdent(ident.requires);
                if (target.faults.length > 0) await link.readFaults(fs.requires);
            } catch (e) {
                return e instanceof Error ? e.message : String(e);
            }
            return null;
        },

        catalog: async ({ module, query, kind, limit }) => {
            const profile = module === ecuId && catalog ? catalog : await loadEcuCatalog(module).catch(() => null);
            if (!profile) return { module, found: false, reason: `No catalogue for ${module}.` };
            const table = await loadTelegrams(module);
            const words = (query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
            const classes = kind ? KINDS[kind] : null;
            const jobs = profile.jobs
                .filter((j) => !classes || classes.includes(j.class))
                .filter((j) => {
                    if (words.length === 0) return true;
                    const desc = j.desc ? resolveText(profile, j.desc, 'en').text : '';
                    const hay = `${j.id} ${j.ja} ${j.en} ${desc} ${j.system}`.toLowerCase();
                    return words.some((w) => hay.includes(w));
                })
                .slice(0, limit)
                .map((j) => {
                    const v = mayRun(j, bestTelegram(table, j.id), ledger, { moduleId: module, motion: link.motion });
                    const rec = ledger.records[`${module}:${j.id}`];
                    return {
                        job: j.id,
                        name: j.en,
                        nameJa: j.ja,
                        kind: j.class,
                        risk: jobRiskOf(j),
                        preconditions: j.preconditions,
                        mayRunNow: v.allowed,
                        reason: v.allowed ? null : en.runBlock[v.reason],
                        ledger: rec ? { status: rec.status, observations: rec.observations ?? 0 } : null,
                    };
                });
            return { module, name: moduleName(module), jobs, inSession: module === ecuId };
        },

        entries: () => listAllEntries(),
        add: async (es) => {
            await addEntries(es);
            await probe.refresh();
            // A delegated record goes to the account as it is written, so the desk reads it soon.
            input.syncInvestigations();
        },
        live: probe.live,
        lastRun: () => probe.lastRun,

        ledger: (moduleId) => {
            const rows = Object.values(ledger.records)
                .filter((r) => !moduleId || r.id.startsWith(`${moduleId}:`))
                .map((r) => ({ id: r.id, status: r.status, observations: r.observations ?? 0, lastObservedAt: r.lastObservedAt ?? null, movingOk: r.status === 'moving-ok', reason: r.reason ?? null }));
            return { records: rows, note: 'Reads are cleared for a moving car by the owner, on the screen.' };
        },

        sessions: async (limit) => {
            const all = await listLocal().catch(() => []);
            return all.slice(0, limit).map((s) => ({
                id: s.id,
                label: s.label,
                createdAt: new Date(s.createdAt).toISOString(),
                module: s.ecu,
                practice: s.mock,
                ...summarise(s),
                sent: !needsSync(s),
            }));
        },

        display: (next) => input.changeTab(next),

        stage: async (module, jobId) => {
            if (module !== ecuId) {
                return { staged: false, reason: `The screen is on ${moduleName(ecuId)}. A person switches modules on the screen, parked; then it can be staged.` };
            }
            const job = catalog?.jobs.find((j) => j.id === jobId);
            if (!job) return { staged: false, reason: `${jobId} is not a job of ${moduleName(module)}.` };
            input.selectJob(job);
            input.changeTab('service');
            const v = mayRun(job, bestTelegram(await loadTelegrams(module), job.id), ledger, { moduleId: module, motion: link.motion });
            return {
                staged: true,
                job: job.id,
                name: job.en,
                preconditions: job.preconditions,
                runsOnScreen: v.allowed ? 'The screen may run it, when a person presses it, parked.' : null,
                reason: v.allowed ? null : en.runBlock[v.reason],
            };
        },

        startLog: () => {
            if (link.state !== 'connected') return `The link is ${link.state}; a recording starts from connected and idle.`;
            if (target.decoder !== 'mss54') return en.datalog_noDecoder;
            datalog.start();
            return null;
        },

        stopLog: () => {
            if (running) {
                probe.stop();
                return 'probe';
            }
            if (link.state === 'logging') {
                datalog.stop();
                return 'recording';
            }
            return null;
        },

        save: async () => {
            await sessions.save();
            const s = (await listLocal().catch(() => []))[0];
            return s ? { saved: true, label: s.label, ...summarise(s) } : { saved: false, reason: 'Nothing was written to this device.' };
        },

        openTuner: (discardUnsaved) => {
            if (running || link.state === 'logging') {
                return { opened: false, reason: 'A recording or a PROBE run is going. Stop it first (monitoring_stop_log, read back), then ask again.' };
            }
            if (link.state === 'busy') return { opened: false, reason: 'A read is in flight. Ask again in a moment.' };
            if (sessions.unsaved && !discardUnsaved) {
                return {
                    opened: false,
                    unsaved: true,
                    reason: 'This screen holds a session that is not saved (its fault read, recording or failures). Save it with monitoring_save, or read back that it would be lost and call again with discard_unsaved: true after a clear yes.',
                };
            }
            // The head unit says so to TUNER too, as the launcher does, so TUNER's tab takes the bridge there.
            const url = isHeadUnit() ? `${TUNER_WORKS}?${LAUNCHER_QUERY}` : TUNER_WORKS;
            // After the answer has gone: the socket goes with the page.
            setTimeout(() => {
                void link.disconnect().finally(() => window.location.assign(url));
            }, 500);
            return { opened: true, url, note: "This tab is moving to TUNER WORKS; from now on TUNER's tab answers, through TUNER's tools." };
        },

        sync: async () => {
            if (!canSync()) return { sent: 0, reason: 'This build does not send: it is not the WORKS build, or its notice is not confirmed.' };
            const before = new Map((await listLocal().catch(() => [])).map((s) => [s.id, s.syncedAt]));
            await sessions.sync();
            const after = await listLocal().catch(() => []);
            const sent = after.filter((s) => s.syncedAt !== null && s.syncedAt !== before.get(s.id)).length;
            return { sent, waiting: after.filter(needsSync).length };
        },
    };
}

'use client';

import { formatErrorCode, type ErrorMemoryEntry } from '@tsunagi/ds2-mss54';
import type { RawFaultRead, useDs2Link } from '@/hooks/useDs2Link';
import type { useProbe } from '@/hooks/useProbe';
import type { FreshFaults, TabFacade } from '@/lib/bridge/handlers';
import { jobRiskOf, loadEcuCatalog, text as resolveText, type EcuIndex, type EcuProfile, type JobClass } from '@/lib/ecuCatalog';
import { normCode } from '@/lib/faultCode';
import { en } from '@/lib/i18n/en';
import { TUNER_WORKS } from '@/lib/links';
import type { Ledger } from '@/lib/ledger';
import { hasFaultRead, hasIdent, type ModuleProtocol } from '@/lib/moduleProtocol';
import { addEntries, listAllEntries } from '@/lib/notebook/store';
import { getBoard, putBoard } from '@/lib/probe/boardStore';
import { listRuns } from '@/lib/probe/runStore';
import { scanCounts, type ScanRun } from '@/lib/probe/scan';
import type { RunBlockKey } from '@/lib/runGate';
import { mayRun, mayRunProtocolRead, telegramBytes } from '@/lib/runGate';
import { isCommonIdent } from '@/lib/variants';
import { canSync } from '@/lib/sync/cloud';
import { needsSync, sessionLabel, summarise } from '@/lib/sync/session';
import { expiresAt } from '@/lib/journal';
import { channelsForJob, datalogSummary, findChannels, selectionCost, unknownChannels } from '@/lib/datalogQuery';
import type { ChannelId } from '@tsunagi/ds2-mss54';
import { listLocal } from '@/lib/sync/sessionStore';
import type { Mode, Tab } from '@/lib/tabs';
import type { ProbeSessions } from '@/views/probe/useProbeSessions';
import { bestTelegram, loadTelegrams } from '@/lib/telegrams';
import { LAUNCHER_QUERY, deviceLabel, isHeadUnit, type DeviceKind } from '@/hooks/useAssistantBridge';
import type { Datalog } from '@/views/datalog/useDatalog';
import type { Sessions } from '@/views/sessions/useSessions';
import { appNow } from '@/lib/clock';

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
 * SYNC, a tab, a job selected on SERVICE — and, since the operator allowed it (2026-10-28), CONNECT
 * again through a cable already allowed on this device, DISCONNECT, and the move to TUNER; and for
 * the AI modes (operator, 2026-11-01) every module's fault read, the module on the screen, and a
 * PROBE run of a plan under a standing mandate. Nothing else. Allowing a new device, running a job,
 * an adjustment, a clear or a write is not among them.
 */
const KINDS: Record<string, readonly JobClass[]> = {
    read: ['read'],
    test: ['test'],
    calibration: ['calibration'],
    live: ['read'],
};

/** MSS54 entries as the assistant reads them: the code, its text from the SGBD's own table, how often. */
function describeEntries(entries: readonly ErrorMemoryEntry[], profile: EcuProfile | null) {
    const byCode = new Map((profile?.faultText ?? []).map((f) => [normCode(f.code), f]));
    return entries.map((f) => {
        const code = formatErrorCode(f.errorCode);
        const known = byCode.get(normCode(code));
        return {
            code,
            type: formatErrorCode(f.errorType),
            text: known && profile ? resolveText(profile, known.text, 'en').text : null,
            inTable: !!known,
            frequency: f.frequencyCounter,
            freezeFrames: f.environmentSets.length,
        };
    });
}

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
    /** PROBE's sessions and boards (views/probe/useProbeSessions). */
    probeSessions: ProbeSessions;
    mode: Mode;
    tab: Tab;
    changeTab: (tab: Tab) => void;
    /** Which window shares the screen with HUB below 900: the tab's rows (list) or its picture (visu). */
    showPane: (pane: 'list' | 'visu') => void;
    selectJob: (job: EcuProfile['jobs'][number]) => void;
    /** Another module on the screen, the link opened again for it if it was open (page.tsx). */
    switchModule: (id: string) => Promise<string | null>;
    /** Every module's fault read, shown on DIAGNOSIS under ALL MODULES (page.tsx). How many addresses, or why not. */
    startScan: () => Promise<{ addresses: number } | string>;
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

    /** The module on the screen, as far as it has been read. */
    const inSession = (moduleId?: string, fresh?: FreshFaults) => {
        if (moduleId && moduleId !== ecuId) {
            return { module: moduleId, read: false, reason: `Not read in this session: the screen is on ${moduleName(ecuId)}. monitoring_module puts another module on it; monitoring_scan reads every module's faults.` };
        }
        const decoded = (fresh?.faults as ErrorMemoryEntry[] | null | undefined) ?? (fresh ? null : link.faults);
        const raw = fresh?.raw ?? (fresh ? null : link.rawFaults);
        if (decoded !== null) return { module: ecuId, read: true, decoded: true, faults: describeEntries(decoded, catalog) };
        if (raw !== null) {
            // DSC MK60 (lib/kwpOnDs2): the codes as ISO 14230 lays a $58 answer out, with the SGBD's
            // text — estimated, not yet confirmed on a MK60; the bytes stay the answer.
            const rows = raw as RawFaultRead[];
            const kwp = rows.flatMap((r) => r.kwpDtcs ?? []);
            if (rows.some((r) => r.kwpDtcs)) {
                const byCode = new Map((catalog?.faultText ?? []).map((f) => [normCode(f.code), f]));
                const codes = kwp.map((d) => {
                    const known = byCode.get(normCode(d.code));
                    return { code: d.code, status: `0x${d.status.toString(16).padStart(2, '0')}`, text: known && catalog ? resolveText(catalog, known.text, 'en').text : null };
                });
                return { module: ecuId, read: true, decoded: false, estimated: true, note: 'Codes read as ISO 14230 lays out a $58 answer; not yet confirmed on a MK60. The bytes are the answer.', codes, raw };
            }
            return { module: ecuId, read: true, decoded: false, note: 'No decoder for this module: the answer is kept as bytes.', raw };
        }
        return { module: ecuId, read: false, reason: 'Not read yet in this session.' };
    };

    /** A scan result's fault reads, without the IDENT that chose its module. */
    const reads = (x: ScanRun['results'][number]) => x.exchanges.filter((e) => !isCommonIdent(telegramBytes(e.request) ?? new Uint8Array(0)));

    /** A scan, module by module: what answered, with the MSS54's codes decoded and the rest as bytes. */
    const describeScan = async (r: ScanRun) => {
        const mss54 = ecuId === 'mss54' && catalog ? catalog : await loadEcuCatalog('mss54').catch(() => null);
        return {
            end: r.end,
            at: new Date(r.endedAt).toISOString(),
            practice: link.mode === 'practice',
            counts: scanCounts(r.results),
            modules: r.results.map((x) => ({
                address: x.address,
                modules: x.modules.map((id) => ({ id, name: moduleName(id) })),
                outcome: x.outcome,
                ...(x.reason ? { reason: en.runBlock[x.reason as RunBlockKey] ?? x.reason } : {}),
                // Which module its IDENT chose (`?`: none), never the IDENT answer itself: an identity
                // read stays with the owner (lib/investigation/redact), so only the fault reads go as bytes.
                ...(x.variant ? { variant: { sgbd: x.variant.sgbd ?? '?', carried: x.variant.moduleId !== null, ...(x.variant.basis ? { basis: x.variant.basis } : {}) } } : {}),
                ...(x.decoded ? { faults: describeEntries(x.decoded as ErrorMemoryEntry[], mss54) } : {}),
                ...(!x.decoded && reads(x).some((e) => e.response !== null) ? { raw: reads(x), note: 'No decoder for this module: the answer is kept as bytes.' } : {}),
            })),
        };
    };

    return {
        now: () => appNow(),
        newId: () => crypto.randomUUID(),

        status: () => ({
            device: deviceLabel(input.defaultDevice),
            practice: link.mode === 'practice',
            link: link.state,
            module: { id: ecuId, name: moduleName(ecuId) },
            speedKmh: link.vehicleState?.speedKmh ?? null,
            // DSC's speed over CAN. Above 1 km/h it alone makes the car moving (lib/vehicleState).
            speedCanKmh: link.vehicleState?.speedCanKmh ?? null,
            speedReadAt: link.vehicleState ? new Date(link.vehicleState.at).toISOString() : null,
            // The speed preflight's verdict: parked, moving or unknown (not read, or too old).
            car: link.motion,
            // Which module each address said it is on this link: the SGBD its group chose, or '?'.
            // An M3 is a car whose 0x12 said MSS54DS0; on any other, '?' addresses get their IDENT only.
            variants: Object.fromEntries([...link.fitment.values()].map((f) => [`0x${f.address.toString(16).toUpperCase().padStart(2, '0')}`, f.sgbd ?? (f.answer === null ? 'silent' : '?')])),
            recording: link.state === 'logging' && !running,
            datalog: { selected: datalog.current(), samples: datalog.snapshot().samples.length },
            probe: running
                ? { running: true, ...probe.progress }
                : { running: false, planReady: probe.available ? { v: probe.available.v, purpose: probe.available.purpose } : null },
            screen: tab,
            error: link.error,
            scan: link.scanProgress
                ? { running: true, ...link.scanProgress }
                : link.scan
                  ? { running: false, end: link.scan.end, at: new Date(link.scan.endedAt).toISOString(), counts: scanCounts(link.scan.results) }
                  : null,
            // Said so the assistant can tell the driver: it is taken once the link is down a minute, nothing unsaved.
            newBuildWaiting: input.updateWaiting,
        }),

        faults: async (moduleId, fresh) => {
            if (!moduleId && link.scan) return { inSession: inSession(undefined, fresh), scan: await describeScan(link.scan) };
            return inSession(moduleId, fresh);
        },

        refreshFaults: async () => {
            if (link.state !== 'connected') return `The link is ${link.state}; faults are read when it is connected and idle.`;
            if (!hasIdent(target) && !hasFaultRead(target)) return en.faults_notEstablished;
            // The gate's answer for each read (a withdrawn read, a car measured moving), then the
            // link's own preflight measures the speed again just before the bytes go.
            const ident = mayRunProtocolRead(`${ecuId}:IDENT`, 'fault-read', ledger, link.motion);
            const fs = mayRunProtocolRead(`${ecuId}:FS_LESEN`, 'fault-read', ledger, link.motion);
            if (!fs.allowed) return en.runBlock[fs.reason];
            try {
                // The link reports a refused or failed read as null and keeps its sentence: a read the
                // preflight stopped (the car moving) must reach the assistant as not sent, and why.
                if (hasIdent(target) && ident.allowed && (await link.readIdent(ident.requires)) === null) {
                    return link.lastError() ?? 'The identity read did not complete.';
                }
                if (hasFaultRead(target)) {
                    const read = await link.readFaults(fs.requires);
                    if (read === null) return link.lastError() ?? 'The fault read did not complete.';
                    return target.decoder === 'mss54' ? { fresh: { faults: read, raw: null } } : { fresh: { faults: null, raw: read as RawFaultRead[] } };
                }
            } catch (e) {
                return e instanceof Error ? e.message : String(e);
            }
            return { fresh: null };
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
            return {
                saved: all.slice(0, limit).map((s) => ({
                    id: s.id,
                    label: s.label,
                    createdAt: new Date(s.createdAt).toISOString(),
                    module: s.ecu,
                    practice: s.mock,
                    ...summarise(s),
                    sent: !needsSync(s),
                })),
                // MEMORY's journal: what was recorded and not kept. The start is the id monitoring_save
                // takes; the counts, not the contents, so nothing identifying leaves (policy §10).
                notKept: sessions.unkept.slice(0, limit).map((ep) => ({
                    episode: ep.start,
                    label: sessionLabel(ep.start, ep.ecu ?? ecuId, ep.mock),
                    from: new Date(ep.start).toISOString(),
                    to: new Date(ep.end).toISOString(),
                    practice: ep.mock,
                    faultReads: ep.counts.faultReads,
                    samples: ep.counts.samples,
                    learnedValueReads: ep.counts.adaptations,
                    procedures: ep.counts.runs,
                    failures: ep.counts.failures,
                    // Undated: timed by a clock that had not been set, and kept until the owner decides.
                    daysLeft: ep.undated
                        ? (() => {
                              const at = sessions.undatedExpiry(ep);
                              return at === null ? null : Math.max(0, Math.ceil((at - appNow()) / 86_400_000));
                          })()
                        : Math.max(0, Math.ceil((expiresAt(ep) - appNow()) / 86_400_000)),
                    ...(ep.undated ? { undated: 'Its time was taken before the device clock was set: its seven days count from when the tab, with the right time, found it.' } : {}),
                })),
            };
        },

        display: (next) => input.changeTab(next),
        pane: (next) => input.showPane(next),

        stage: async (module, jobId) => {
            if (module !== ecuId) {
                return { staged: false, reason: `The screen is on ${moduleName(ecuId)}. Put ${moduleName(module)} on it first (monitoring_module); then it can be staged.` };
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
            if (datalog.current().length === 0) return 'No DATALOG channel is selected: choose them first (monitoring_log_channels).';
            datalog.start();
            // The owner asked for the values and the trace while a recording runs, not the fault list.
            input.showPane('visu');
            return null;
        },

        datalog: (opts) => {
            const snap = datalog.snapshot();
            return {
                selected: datalog.current(),
                cost: selectionCost(datalog.current()),
                running: link.state === 'logging' && !running,
                recorded: snap.recorded,
                ...datalogSummary(snap.recorded, snap.samples, opts),
                ...(snap.samples.length === 0 ? { note: 'Nothing recorded yet on this page: choose channels (monitoring_log_channels), then monitoring_start_log.' } : {}),
            };
        },

        logChannels: ({ query, channels }) => {
            if (channels) {
                if (link.state === 'logging') return { selected: datalog.current(), changed: false, reason: 'A recording is going; channels change once it is stopped.' };
                const unknown = unknownChannels(channels);
                if (unknown.length) {
                    return { changed: false, reason: `Not a live channel of the MSS54: ${unknown.join(', ')}.`, suggestions: unknown.flatMap((u) => { const byJob = channelsForJob(u); return byJob.length ? byJob : findChannels(u.split(':').pop() ?? u, 5); }) };
                }
                if (channels.length === 0) return { changed: false, reason: 'Choose at least one channel.' };
                datalog.select(channels as ChannelId[]);
                return { changed: true, selected: channels, cost: selectionCost(channels as ChannelId[]), then: 'monitoring_start_log records them.' };
            }
            return { selected: datalog.current(), found: query ? findChannels(query) : [] };
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

        save: async (episode) => {
            if (episode !== undefined) {
                if (!sessions.unkept.some((ep) => ep.start === episode)) {
                    return { saved: false, reason: 'No episode waiting to be kept starts there. Read monitoring_sessions again.' };
                }
                await sessions.keep(episode);
            } else {
                await sessions.save();
            }
            const s = (await listLocal().catch(() => [])).sort((a, b) => b.updatedAt - a.updatedAt)[0];
            return s ? { saved: true, label: s.label, ...summarise(s) } : { saved: false, reason: 'Nothing was written to this device.' };
        },

        connect: async () => {
            if (link.state !== 'disconnected') return { connected: link.state !== 'connecting', reason: `The link is ${link.state}.` };
            const reason = await link.reconnectPermitted();
            return reason === null ? { connected: true, module: { id: ecuId, name: moduleName(ecuId) } } : { connected: false, reason };
        },

        disconnect: async (stopRecording) => {
            if (link.state === 'disconnected') return { disconnected: true, note: 'The link was not open.' };
            if (link.state === 'busy' || link.state === 'connecting') return { disconnected: false, reason: 'A read is in flight. Ask again in a moment.' };
            if (link.state === 'logging' && !stopRecording) {
                return {
                    disconnected: false,
                    recording: running ? 'probe' : 'recording',
                    reason: 'A recording or a PROBE run is going. Read back that it will stop, and after a clear yes call again with stop_recording: true.',
                };
            }
            if (running) probe.stop();
            else if (link.state === 'logging') datalog.stop();
            await link.disconnect();
            return { disconnected: true };
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

        scan: async () => {
            const r = await input.startScan();
            if (typeof r === 'string') return { started: false, reason: r };
            return {
                started: true,
                addresses: r.addresses,
                takes: 'up to about 2 s for each address that does not answer, less for those that do',
                then: 'monitoring_status shows how far it has got; monitoring_faults without module gives every module once it ends. The screen shows it on DIAGNOSIS under ALL MODULES.',
                ...(link.mode === 'practice' ? { practice: 'PRACTICE: the practice car — a late E46 M3 with SMG II, DSC and navigation — answers at the addresses such a car has; the rest are silent. Its values are simulated.' } : {}),
            };
        },

        switchModule: async (id) => {
            const reason = await input.switchModule(id);
            return reason ? { switched: false, reason } : { switched: true, module: { id, name: moduleName(id) }, note: 'The screen shows it; an open link was opened again for it.' };
        },

        probe: async (record) => {
            if (link.state !== 'connected') return { started: false, reason: `The link is ${link.state}; PROBE starts from connected and idle.` };
            const r = await probe.start(record);
            if (r.started) return { started: true, record: r.record, plan: r.v, run: r.n, stop: 'monitoring_stop_log, after a read-back' };
            const why: Record<typeof r.reason, string> = {
                off: 'PROBE is not in this build, or the module index has not loaded.',
                running: 'A PROBE run is already going.',
                none: 'No plan may run: write one under a standing mandate (monitoring_plan).',
                forked: 'Two plans rewrite the same one; the driver chooses which to keep.',
                'mandate-ended': 'The mandate has ended (withdrawn or expired); carry the record on with monitoring_investigate and record.',
            };
            return { started: false, reason: why[r.reason] };
        },

        runs: (record) => listRuns(record).catch(() => []),

        mode: () => input.mode,
        session: () => input.probeSessions.opened(),
        openSession: (id) => input.probeSessions.open(id),
        newSession: () => input.probeSessions.newSession(),
        board: (record) => getBoard(record),
        putBoard: (b) => putBoard(b),

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

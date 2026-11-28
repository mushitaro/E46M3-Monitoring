'use client';

import { formatErrorCode, type ErrorMemoryEntry } from '@tsunagi/ds2-mss54';
import type { RawFaultRead, useDs2Link } from '@/hooks/useDs2Link';
import type { useProbe } from '@/hooks/useProbe';
import type { FreshFaults, TabFacade } from '@/lib/bridge/handlers';
import { jobRiskOf, loadEcuCatalog, text as resolveText, type DecodedFault, type EcuIndex, type EcuProfile, type JobClass } from '@tsunagi/monitoring-engine';
import { normCode } from '@/lib/faultCode';
import { CHROME } from '@/lib/i18n/chrome';
import { LINE_LOST_MESSAGE } from '@tsunagi/monitoring-engine';
import { en } from '@/lib/i18n/en';
import { ja } from '@/lib/i18n/ja';
import { TUNER_WORKS } from '@/lib/links';
import type { Ledger } from '@tsunagi/monitoring-engine';
import { hasIdent, mayTryFaultRead, type ModuleProtocol } from '@tsunagi/monitoring-engine';
import { addEntries, listAllEntries } from '@/lib/notebook/store';
import { getBoard, putBoard } from '@/lib/probe/boardStore';
import { listRuns } from '@/lib/probe/runStore';
import { probeKept } from '@/lib/probeKept';
import { MSS54_PRESENT_SOURCE, mss54Present, mss54Sporadic, presentFromKinds, readCutShort, scanCounts, scanSummary, type ScanRun, type SgbdFault } from '@tsunagi/monitoring-engine';
import { codeText, faultName, freezeFrameConditions } from '@/lib/faultText';
import { isUnnamedLocation, kindsJa } from '@/lib/faultKinds';
import type { RunBlockKey } from '@tsunagi/monitoring-engine';
import { mayRun, mayRunProtocolRead, telegramBytes } from '@tsunagi/monitoring-engine';
import { isCommonIdent } from '@tsunagi/monitoring-engine';
import { canSync } from '@/lib/sync/cloud';
import { needsSync, sessionLabel, summarise } from '@tsunagi/monitoring-engine';
import { expiresAt } from '@tsunagi/monitoring-engine';
import { channelsForJob, datalogSummary, describeChannels, findChannels, momentOf, selectionCost, unknownChannels } from '@/lib/datalogQuery';
import { segmentStats } from '@/lib/datalogRun';
import { planBlockReads } from '@tsunagi/ds2-mss54';
import type { ChannelId } from '@tsunagi/ds2-mss54';
import { listLocal } from '@/lib/sync/sessionStore';
import type { Mode, Tab } from '@/lib/tabs';
import type { ProbeSessions } from '@/views/probe/useProbeSessions';
import { PROCEDURE_PREFIX, bestTelegram, decisionFor, loadTelegrams, telegramOfAgreed, type CatalogJob } from '@tsunagi/monitoring-engine';
import { assistantPick, loadChoices } from '@/lib/agreedChoices';
import { LAUNCHER_QUERY, deviceLabel, isHeadUnit, type DeviceKind } from '@/hooks/useAssistantBridge';
import type { Datalog } from '@/views/datalog/useDatalog';
import type { Sessions } from '@/views/sessions/useSessions';
import { appNow, isModuleChannel, monoNow } from '@tsunagi/monitoring-engine';
import { mayActuate } from '@tsunagi/monitoring-engine';
import { NOT_SENT_STOP, RUN_BLOCK_STOP } from '@tsunagi/monitoring-engine';
import { refusal, type Refusal } from '@/lib/refusal';
import { assistantMayStart, startActuation, tableRefusal } from '@/lib/actuation';
import { MIN_RUN_VOLTAGE, actuationTerms, operationFor } from '@tsunagi/monitoring-engine';
import type { Stopped } from '@/lib/arming';
import type { LeftRunning } from '@/hooks/useActuatorArming';
import { partName, partTable } from '@/lib/partName';
import { notSentSentence } from '@/lib/notSentText';
import { isOn } from '@/lib/jobSurface';
import type { ProcedureEnd } from '@/lib/procedureEnd';
import { procedureAsJob } from '@/views/service/ServiceView';
import type { Smg2Workflows } from '@/lib/smg2Workflows';
import { isProcedureStart, procedureRows, runWith } from '@/lib/catalogRoutes';
import type { Arming } from '@/hooks/useActuatorArming';


/** What a fault-memory clear takes with it: said in the catalogue's answer for the read-back (SC02 step 4). */
const CLEAR_CONSEQUENCE = {
    en: "Clears this module's stored fault codes and, with them, the freeze frames (the conditions recorded with each fault). They cannot be brought back; save first (monitoring_save). Parked only.",
    ja: 'このモジュールの故障コードと、一緒に記録されたフリーズフレーム（記録したときの条件）が消えます。戻せません。先に保存してください。停車中だけ。',
};

/** What the assistant is told with codes read from a module's own layout (engine faultLayouts). */
const UNVERIFIED_LAYOUT = "Codes read where this module's own SGBD reads them (checked against EDIABAS in simulation); not yet confirmed on a car. The bytes are the answer.";
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

/** Said with every recording and moment the assistant reads: where its gear comes from. */
const GEAR_NOTE =
    "83:gang is the DME's own calculated gear (block 83), read beside the channels once a second; a moment's gear is the last read at most 1.5 s before it (`readS` says how long), null when none was.";

/**
 * MSS54 entries as the assistant reads them: the code, its name from the SGBD's own table (English, the
 * Japanese the screen shows, and the German original), whether it is there now, how often, and the
 * conditions its freeze frames recorded, with units — what the screen's ALL MODULES row opens to (U3).
 */
function describeEntries(entries: readonly ErrorMemoryEntry[], profile: EcuProfile | null) {
    const byCode = new Map((profile?.faultText ?? []).map((f) => [normCode(f.code), f]));
    return entries.map((f) => {
        const code = formatErrorCode(f.errorCode);
        const known = byCode.get(normCode(code));
        const ja = faultName(profile, code, 'ja');
        const present = mss54Present(f.errorType);
        return {
            code,
            type: formatErrorCode(f.errorType),
            text: known && profile ? resolveText(profile, known.text, 'en').text : null,
            textJa: ja?.text ?? null,
            original: ja?.original ?? null,
            inTable: !!known,
            present,
            state: present ? 'present now' : 'stored, not present now',
            stateJa: present ? '今出ている' : '記録のみ（今は出ていない）',
            sporadic: mss54Sporadic(f.errorType),
            presentSource: MSS54_PRESENT_SOURCE,
            frequency: f.frequencyCounter,
            freezeFrames: f.environmentSets.length,
            conditions: f.environmentSets.map((s) =>
                (freezeFrameConditions(profile, code, [s.condition1, s.condition2, s.condition3, s.condition4], 'en') ?? [])
                    .flatMap((c) => (c ? [{ name: c.name, value: c.value, unit: c.unit ?? null }] : [])),
            ),
        };
    });
}

/**
 * Entries a module's own SGBD read (FS_LESEN), as the assistant reads them: the location number and the
 * code as its catalogue spells it, the SGBD's own German, the Japanese the screen shows, whether it is
 * there now in the SGBD's own words, and those words in Japanese.
 */
function describeSgbdFaults(faults: readonly SgbdFault[], profile: EcuProfile | null) {
    return faults.map((f) => {
        const ja = faultName(profile, f.code, 'ja');
        const en = faultName(profile, f.code, 'en');
        const unnamed = !ja && isUnnamedLocation(f.text);
        const present = presentFromKinds(f.kinds);
        return {
            location: f.code,
            code: codeText(profile, f.code),
            text: unnamed ? null : f.text,
            textJa: ja?.text ?? (unnamed ? 'この場所の名前は SGBD に無い' : null),
            textEn: en?.text ?? null,
            ...(unnamed ? { unnamed: 'Its SGBD has no name for this location.' } : {}),
            present,
            ...(present === null ? {} : { stateJa: present ? '今出ている' : '記録のみ（今は出ていない）' }),
            kinds: f.kinds,
            kindsJa: kindsJa(f.kinds),
            values: f.values,
        };
    });
}

/** Why a SYNC stopped, for the assistant (views/sessions/useSessions `SyncOutcome`). */
const SYNC_STOPPED: Record<string, string> = {
    noSync: 'This build does not send: it is not the WORKS build, or its notice is not confirmed.',
    offline: 'This device has no network now. The sessions waiting are kept on it and sent by themselves, once, when the network is back.',
    notSaved: 'What is on the screen could not be saved first, so nothing was sent.',
    unreachable: 'No answer from where sessions go (the request did not complete). They are kept on this device; SYNC again where there is signal.',
    expired: 'The sign-in has expired: the owner signs in again on the screen. The sessions are kept on this device.',
    noDestination: 'This build has nowhere to send to (HTTP 404: no server behind it). The sessions are kept on this device; the WORKS build with the owner signed in sends them.',
    refused: 'Where sessions go answered and did not take them (see status). They are kept on this device.',
};


/** The next step for a module the owner has not said is fitted (variantChoice.ts). */
const VARIANT_NEXT = 'Ask the owner which module is fitted at the address and record it with monitoring_variant (or they choose on ACTUATOR); once per car.';
/** The next step while the link is not connected and idle. */
const LINK_NEXT = 'monitoring_connect reconnects the cable already allowed; or wait until the job or the reading going ends (monitoring_status).';

/** The gate's refusal, as the stop it is (engine stopReasons.ts RUN_BLOCK_STOP). */
function gateRefusal(key: RunBlockKey): Refusal {
    const stop = RUN_BLOCK_STOP[key];
    return stop === 'route' ? refusal('route', en.runBlock[key], 'Use the tool the sentence names.') : refusal(stop, en.runBlock[key]);
}

/** The assistant's own pre-gate refusal (actuation.ts assistantMayStart), as the stop it is. */
function mayRefusal(may: { reason: string; stop: 'route' | 'S1' | 'S3' | 'S6'; screen?: boolean }): Refusal {
    return may.stop === 'route' ? refusal('route', may.reason, may.screen ? 'A person presses it on the screen.' : 'Read it with the read tools.') : refusal(may.stop, may.reason);
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
    /** The outputs on now, and how to start and stop them (useActuatorArming). */
    arming: Arming;
    /** Opens an SMG II procedure's dialog and runs it on the owner's spoken OK (page.tsx, views/service/WizardDialog). */
    startProcedure: (job: EcuProfile['jobs'][number], ownerSaid: string, gear?: number) => void;
    /** SMG II's test programs (smg2-workflows.json), the procedures monitoring_procedure starts. */
    workflows: Smg2Workflows | null;
    /** Another module on the screen, the link opened again for it if it was open (page.tsx). */
    switchModule: (id: string) => Promise<{ reason: string | null; stopped: Stopped[] }>;
    /** Every module's fault read, shown on DIAGNOSIS under ALL MODULES (page.tsx). How many addresses, or why not. */
    startScan: () => Promise<{ addresses: number } | string>;
    /** A newer build is downloaded; it is taken once the link has been down a minute (lib/adoptBuild). */
    updateWaiting: boolean;
    /** DIAGNOSIS shows ALL MODULES (the last scan's list) rather than the module. */
    allModules: boolean;
    /** Bring the delegated investigations level with the account (hooks/useInvestigationSync). */
    syncInvestigations: () => void;
    /** The name a device answers as when the owner gave it none. */
    defaultDevice: Record<DeviceKind, string>;
    /** A job sent once and not left on: the screen says it went (page.tsx). */
    noteSentOnce: (moduleId: string, jobId: string, args: readonly string[] | null) => void;
    /** Put a job's set of values on its ACTUATOR row, as the assistant chose it (page.tsx). */
    pickSet: (moduleId: string, jobId: string, args: readonly string[] | null) => void;
    /** Why a module's jobs may not be started until the owner says which module answers at its address, or null. */
    variantUnconfirmed: (moduleId: string) => string | null;
    /** Record the owner's words on which module answers at a shared address, where the screen's choice goes. */
    recordVariant: (moduleId: string) => { ok: true; address: number } | { ok: false; reason: string };
    /** What the page before this one left on when it went away (useActuatorArming `leave`). */
    leftRunning: readonly LeftRunning[];
    /** How the last procedure ended (views/service/WizardDialog), or null. */
    lastProcedure: ProcedureEnd | null;
}): TabFacade {
    const { link, ecuId, ecuIndex, catalog, target, ledger, datalog, sessions, probe, tab } = input;
    const moduleName = (id: string) => ecuIndex?.modules.find((m) => m.id === id)?.name_en ?? id;
    const running = probe.progress !== null;

    /**
     * The screen follows what the assistant was asked to do (operator, 2026-11-12: 「ユーザーの指示によって
     * 何か作業をするとき、その目的に合った画面を自動で切り替えて表示するようにしてほしい」). A PROBE run in
     * progress keeps its board: nothing the assistant does beside it takes the screen away from it.
     */
    const show = (where: Tab, pane: 'list' | 'visu') => {
        if (running && where !== 'probe') return;
        // Always asked, not compared with `tab`: this facade may be a render behind a switch just made.
        input.changeTab(where);
        input.showPane(pane);
    };

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
                    return {
                        code: d.code,
                        status: `0x${d.status.toString(16).padStart(2, '0')}`,
                        text: known && catalog ? resolveText(catalog, known.text, 'en').text : null,
                        textJa: faultName(catalog, d.code, 'ja')?.text ?? null,
                    };
                });
                return { module: ecuId, read: true, decoded: false, estimated: true, note: 'Codes read as ISO 14230 lays out a $58 answer; not yet confirmed on a MK60. The bytes are the answer.', codes, raw };
            }
            const job = rows.find((r) => r.jobFaults)?.jobFaults;
            if (job) {
                return {
                    module: ecuId,
                    read: true,
                    decoded: true,
                    sgbdRead: {
                        sgbd: ecuId,
                        complete: job.status === 'OKAY' && job.stopped === null,
                        faults: describeSgbdFaults(job.faults, catalog),
                        note: "Read by the module's own SGBD fault-read job, run in the app against the car. text is the SGBD's own German; textJa is the screen's Japanese from the module's own fault-text table.",
                    },
                    raw,
                };
            }
            // Another module's codes, read where its own SGBD reads them (engine faultLayouts): checked
            // against EDIABAS in simulation, not yet on a car; the bytes stay the answer.
            if (rows.some((r) => r.decoded)) {
                return { module: ecuId, read: true, decoded: false, unverified: true, note: UNVERIFIED_LAYOUT, codes: codesOf(rows.flatMap((r) => r.decoded ?? []), catalog), raw };
            }
            return { module: ecuId, read: true, decoded: false, note: 'No decoder for this module: the answer is kept as bytes.', raw };
        }
        return { module: ecuId, read: false, reason: 'Not read yet in this session.' };
    };

    /** Decoded codes with their module's own fault text (FORTTEXTE), in English. */
    const codesOf = (faults: readonly DecodedFault[], profile: EcuProfile | null) => {
        const byCode = new Map((profile?.faultText ?? []).map((f) => [normCode(f.code), f]));
        return faults.map((f) => {
            const known = byCode.get(normCode(f.code));
            return {
                code: f.code,
                text: known && profile ? resolveText(profile, known.text, 'en').text : null,
                textJa: faultName(profile, f.code, 'ja')?.text ?? null,
                count: f.count,
                present: f.present,
            };
        });
    };

    /** A scan result's fault reads, without the IDENT that chose its module. */
    const reads = (x: ScanRun['results'][number]) => x.exchanges.filter((e) => !isCommonIdent(telegramBytes(e.request) ?? new Uint8Array(0)));

    /** A scan, module by module: what answered, the MSS54's codes decoded, the others read by their own SGBD's code where it can, and the bytes. */
    const describeScan = async (r: ScanRun) => {
        const mss54 = ecuId === 'mss54' && catalog ? catalog : await loadEcuCatalog('mss54').catch(() => null);
        // DSC MK60 (lib/kwpOnDs2): its codes with its own SGBD's text — an estimate, as on its screen.
        const kwpId = r.results.find((x) => x.kwpDtcs)?.modules[0];
        const kwpCatalog = !kwpId ? null : kwpId === ecuId && catalog ? catalog : await loadEcuCatalog(kwpId).catch(() => null);
        const kwpText = new Map((kwpCatalog?.faultText ?? []).map((f) => [normCode(f.code), f]));
        const kwpCodes = (dtcs: NonNullable<ScanRun['results'][number]['kwpDtcs']>) =>
            dtcs.map((d) => {
                const known = kwpText.get(normCode(d.code));
                return {
                    code: d.code,
                    status: `0x${d.status.toString(16).padStart(2, '0')}`,
                    text: known && kwpCatalog ? resolveText(kwpCatalog, known.text, 'en').text : null,
                    textJa: faultName(kwpCatalog, d.code, 'ja')?.text ?? null,
                };
            });
        // The catalogue of each module whose codes were read from its own layout, for their text.
        const profiles = new Map<string, EcuProfile | null>();
        for (const x of r.results) {
            const id = x.sgbdFaults?.module ?? (x.faults ? (x.variant?.moduleId ?? (x.modules.length === 1 ? x.modules[0] : null)) : null);
            if (id) profiles.set(x.address, id === 'mss54' ? mss54 : await loadEcuCatalog(id).catch(() => null));
        }
        const summary = scanSummary(r.results);
        return {
            end: r.end,
            at: new Date(r.endedAt).toISOString(),
            practice: link.mode === 'practice',
            counts: scanCounts(r.results),
            // What the screen's ALL MODULES line says: answered modules and the faults their reads hold.
            summary: { modules: summary.modules, faults: summary.faults, ...(summary.cutShort ? { readPartWay: summary.cutShort } : {}) },
            modules: r.results.map((x) => ({
                address: x.address,
                modules: x.modules.map((id) => ({ id, name: moduleName(id) })),
                outcome: x.outcome,
                ...(x.reason ? { reason: en.runBlock[x.reason as RunBlockKey] ?? x.reason } : {}),
                // Read part of the way: what was read is kept, and the list may be short (IJ16).
                ...(readCutShort(x) ? { complete: false, readPartWay: 'The read stopped part of the way: what was read is here, and the list may be short. The screen says 途中までしか読めませんでした.' } : {}),
                // Which module its IDENT chose (`?`: none), never the IDENT answer itself: an identity
                // read stays with the owner (lib/investigation/redact), so only the fault reads go as bytes.
                ...(x.variant ? { variant: { sgbd: x.variant.sgbd ?? '?', carried: x.variant.moduleId !== null, ...(x.variant.basis ? { basis: x.variant.basis } : {}) } } : {}),
                ...(x.decoded ? { faults: describeEntries(x.decoded as ErrorMemoryEntry[], mss54) } : {}),
                // Read by the module's own SGBD FS_LESEN code (lib/sgbd/results): its entries and its texts.
                ...(!x.decoded && x.sgbdFaults
                    ? {
                          sgbdRead: {
                              sgbd: x.sgbdFaults.module,
                              complete: x.sgbdFaults.stopped === null && x.sgbdFaults.status === 'OKAY',
                              ...(x.sgbdFaults.stopped ? { stopped: x.sgbdFaults.stopped.reason } : {}),
                              faults: describeSgbdFaults(x.sgbdFaults.faults, profiles.get(x.address) ?? null),
                              note: "Read by the module's own SGBD fault-read code run in the app (the reading INPA gives). text is the SGBD's own German; textJa is what the screen shows, from the module's own fault-text table. Not yet compared with INPA on this car.",
                          },
                      }
                    : {}),
                // Read where its own SGBD reads the codes (engine faultLayouts): not yet confirmed on a car.
                ...(x.faults && !x.sgbdFaults ? { codes: codesOf(x.faults, profiles.get(x.address) ?? null), unverified: true } : {}),
                ...(x.kwpDtcs
                    ? { estimated: true, codes: kwpCodes(x.kwpDtcs), raw: reads(x), note: 'Codes read as ISO 14230 lays out a $58 answer; not yet confirmed on a MK60. The bytes are the answer.' }
                    : !x.decoded && reads(x).some((e) => e.response !== null)
                      ? {
                            raw: reads(x),
                            ...(x.sgbdFaults ? {} : { note: x.faults ? UNVERIFIED_LAYOUT : 'No decoder for this module: the answer is kept as bytes.' }),
                        }
                      : {}),
            })),
        };
    };


    /** Whether every module that may answer at this address carries this job with the very same frame. */
    const commonToCandidates = async (address: number, jobId: string): Promise<boolean> => {
        const ids = (ecuIndex?.modules ?? []).filter((m) => m.address === address).map((m) => m.id);
        if (ids.length < 2) return false;
        const hexes = await Promise.all(ids.map(async (id) => bestTelegram(await loadTelegrams(id), jobId)?.hex ?? null));
        return hexes.every((h) => h !== null && h === hexes[0]);
    };

    /** A job the table keeps for a person on the screen, put on SERVICE for them to press (IJ F19). */
    const stageOnScreen = async (module: string, job: CatalogJob): Promise<boolean> => {
        if (module !== ecuId) return false;
        input.selectJob(job);
        input.changeTab('service');
        return true;
    };

    /** What the assistant reads back before a job starts: the part in the owner's words, how long, and what it needs (SC07, F34). */
    const readBackOf = (module: string, job: CatalogJob, args?: readonly string[]) => {
        const terms = actuationTerms(job, decisionFor(module, job, catalog?.group, args));
        const hold = operationFor(job).kind === 'hold' && !!operationFor(job).stopJob;
        const part = partName(module, job, args, input.workflows);
        const seconds = hold ? terms.timeoutS : null;
        return {
            ...(args ? { part: part.part, partName: part.en, partNameJa: part.ja } : {}),
            stopsByItselfAfterS: seconds,
            needs: { parked: true, minV: MIN_RUN_VOLTAGE, ...(terms.engine ? { engine: terms.engine === 'off' ? 'stopped' : 'running' } : {}) },
            say:
                (args ? `${part.ja}を` : `${job.ja}を`) +
                (seconds ? `${seconds} 秒動かします。` : '一度動かします。') +
                `停車中、電圧 ${MIN_RUN_VOLTAGE} V 以上が前提です` +
                (terms.engine === 'off' ? '（エンジン停止）' : terms.engine === 'run' ? '（エンジン始動）' : '') +
                '。いいですか？',
        };
    };

    /**
     * The sets a job takes, for the assistant: every part listed by name (the first value), and the sets
     * themselves — all of a part named by `query` or by the values asked for, else the plain ones of
     * each part (AKTIV first), so no part is ever cut off the end of a long list (IJ F07, SC07 F33).
     */
    const setsAnswer = (module: string, job: CatalogJob, sets: readonly string[][], query?: string, values?: readonly string[]) => {
        const byPart = new Map<string, string[][]>();
        for (const s of sets) byPart.set(s[0] ?? '', [...(byPart.get(s[0] ?? '') ?? []), [...s]]);
        const words = (query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
        const parts = [...byPart].map(([part, list]) => {
            const n = partName(module, job, [part], input.workflows);
            return { part, name: n.en, nameJa: n.ja, sets: list.length };
        });
        const matches = (p: (typeof parts)[number]) => words.some((w) => `${p.part} ${p.name} ${p.nameJa}`.toLowerCase().includes(w));
        const named = words.length ? parts.filter(matches) : values?.[0] && byPart.has(values[0]) ? parts.filter((p) => p.part === values[0]) : [];
        const plainFirst = (list: string[][]) => [...list].sort((a, b) => Number(b[1] === 'AKTIV') - Number(a[1] === 'AKTIV'));
        const shown = named.length ? named.flatMap((p) => byPart.get(p.part) ?? []) : [...byPart.values()].flatMap((list) => plainFirst(list).slice(0, 4));
        return {
            parts,
            sets: shown,
            ...(named.length ? { setsOf: named.map((p) => p.part) } : { setsNote: `The plain sets of each part. Ask with query (the part, in any language the list carries) for all of one part's ${sets.length > shown.length ? 'sets' : 'sets'}.` }),
        };
    };

    /** What is on now, by the part it drives: 「油圧ポンプ (HYDROPUMPE, STEUERN_STELLGLIED)」. */
    const armedNow = () =>
        [...(input.arming?.armed?.values() ?? [])].map((e) => {
            const p = partName(e.moduleId ?? ecuId, catalog?.jobs.find((j) => j.id === e.jobId) ?? { id: e.jobId }, e.args, input.workflows);
            const left = e.timeoutS ? Math.max(0, Math.ceil((e.at + e.timeoutS * 1000 - Date.now()) / 1000)) : null;
            return { job: e.jobId, part: p.part, partName: p.en, partNameJa: p.ja, stopsInS: left };
        });
    const onNow = () => armedNow().map((a) => (a.part ? `${a.partNameJa} (${a.partName === a.part ? a.part : `${a.partName}, ${a.part}`}, ${a.job})` : `${a.partNameJa} (${a.job})`)).join(', ');

    /** A stop, as the assistant reads it. */
    const stoppedOf = (s: Stopped) => {
        const p = partName(s.entry.moduleId ?? ecuId, catalog?.jobs.find((j) => j.id === s.entry.jobId) ?? { id: s.entry.jobId }, s.entry.args, input.workflows);
        return { job: s.entry.jobId, part: p.part, partNameJa: p.ja, how: s.how, answered: s.confirmed, at: new Date(s.at).toISOString() };
    };

    /**
     * How fast a selection would record: one DME round trip per block and per other module's read,
     * timed on this page — from the recording so far, or, before one, a DME block read now. Stated
     * with its basis: an estimate, the screen's 実効レート is the measurement.
     */
    const expectedRate = async (ids: readonly ChannelId[]): Promise<{ rateHz: number | null; rateBasis: string }> => {
        const own = ids.filter((c) => !isModuleChannel(c));
        const jobs = new Set(ids.filter((c) => isModuleChannel(c)).map((c) => c.split(':').slice(0, 2).join(':'))).size;
        const blocks = planBlockReads(own).blocks;
        const perSample = blocks.length + jobs + (jobs > 0 && !blocks.some((b) => b.selection === 19) ? 1 : 0);
        let rt = datalog.roundTripS();
        let basis = 'estimated from the DME round trip of the recording on this page';
        if (rt === null && link.state === 'connected') {
            const t0 = monoNow();
            const ok = (await link.readVehicleState().catch(() => 'unknown')) !== 'unknown';
            if (ok) {
                rt = (monoNow() - t0) / 1000;
                basis = 'estimated from one DME block read just now; a longer block takes longer';
            }
        }
        if (rt === null || perSample === 0) return { rateHz: null, rateBasis: 'not known until the recording runs: the screen shows the measured rate (実効レート)' };
        return { rateHz: Math.round((1 / (perSample * rt)) * 10) / 10, rateBasis: basis };
    };

    return {
        now: () => appNow(),
        newId: () => crypto.randomUUID(),

        status: () => ({
            device: deviceLabel(input.defaultDevice),
            practice: link.mode === 'practice',
            link: link.state,
            // What the module select on the screen says. With ALL MODULES chosen on DIAGNOSIS no one module
            // is selected, and saying the link's module here read as "MSS54 is selected" (operator, 2026-11-19).
            module: tab === 'diagnosis' && input.allModules ? { id: null, name: CHROME.module_all, all: true } : { id: ecuId, name: moduleName(ecuId) },
            // The one module the link opens on, and the single-module tools act on, whatever the select says.
            linkModule: { id: ecuId, name: moduleName(ecuId) },
            speedKmh: link.vehicleState?.speedKmh ?? null,
            // DSC's speed over CAN. Above 1 km/h it alone makes the car moving (lib/vehicleState).
            speedCanKmh: link.vehicleState?.speedCanKmh ?? null,
            speedReadAt: link.vehicleState ? new Date(link.vehicleState.at).toISOString() : null,
            // The speed preflight's verdict: parked, moving or unknown (not read, or too old).
            car: link.motion,
            // Which module each address said it is on this link: the SGBD its group chose, or '?'.
            // An M3 is a car whose 0x12 said MSS54DS0; on any other, '?' addresses get their IDENT only.
            variants: Object.fromEntries([...link.fitment.values()].map((f) => [`0x${f.address.toString(16).toUpperCase().padStart(2, '0')}`, f.sgbd ?? (f.answer === null ? 'silent' : '?')])),
            recording: (link.state === 'logging' || datalog.isRunning()) && !running,
            datalog: { selected: datalog.current(), samples: datalog.snapshot().samples.length, segments: datalog.snapshot().segments.length },
            probe: running
                ? { running: true, ...probe.progress }
                : { running: false, planReady: probe.available ? { v: probe.available.v, purpose: probe.available.purpose } : null },
            screen: tab,
            // What DIAGNOSIS shows: the module, or ALL MODULES (the scan's list). monitoring_module puts the module back.
            showing: tab === 'diagnosis' && input.allModules ? 'all-modules' : 'module',
            error: link.lineLost ? LINE_LOST_MESSAGE : link.error,
            // The module stopped answering its heartbeat: the cable or the line is gone (IJ04).
            lineLost: link.lineLost,
            // What is on now, by part, with the seconds until it stops by itself (U3, U4).
            on: armedNow(),
            // The last stop and how it came (STOP, its own time-out, a switch, the line back).
            lastStop: input.arming?.last ? stoppedOf(input.arming.last) : null,
            // A page before this one went away with something on (IJ13): its stop was written as it went,
            // and the ECU's own time-out ends it regardless.
            ...(input.leftRunning?.length
                ? {
                      previousPage: input.leftRunning.map((l) => ({
                          job: l.jobId,
                          part: l.args?.[0] ?? null,
                          partNameJa: partName(l.moduleId ?? ecuId, { id: l.jobId }, l.args, input.workflows).ja,
                          stopWrittenAsThePageWent: l.stopWritten,
                          leftAt: new Date(l.leftAt).toISOString(),
                          note: `The page closed while it was on. Its stop was sent as the page went; the module's own time-out (${l.timeoutS ?? 10} s) ends it regardless: it timed out by itself if the stop did not arrive.`,
                      })),
                  }
                : {}),
            lastProcedure: input.lastProcedure ?? null,
            scan: link.scanProgress
                ? { running: true, ...link.scanProgress }
                : link.scan
                  ? (() => {
                        const sum = scanSummary(link.scan.results);
                        return {
                            running: false,
                            end: link.scan.end,
                            at: new Date(link.scan.endedAt).toISOString(),
                            counts: scanCounts(link.scan.results),
                            // The screen's line, word for word in numbers: 「n モジュール、故障 m 件」.
                            summary: { modules: sum.modules, faults: sum.faults, line: `${sum.modules} モジュール、故障 ${sum.faults} 件` },
                        };
                    })()
                  : null,
            // Said so the assistant can tell the driver: UPDATE is in the header, and it is taken by itself once the link is down a minute.
            newBuildWaiting: input.updateWaiting,
        }),

        faults: async (moduleId, fresh) => {
            if (!moduleId && link.scan) return { inSession: inSession(undefined, fresh), scan: await describeScan(link.scan) };
            return inSession(moduleId, fresh);
        },

        refreshFaults: async () => {
            if (link.state !== 'connected') return `The link is ${link.state}; faults are read when it is connected and idle.`;
            if (!hasIdent(target) && !mayTryFaultRead(target)) return en.faults_notEstablished;
            // The gate's answer for each read (a withdrawn read, a car measured moving), then the
            // link's own preflight measures the speed again just before the bytes go.
            const ident = mayRunProtocolRead(`${ecuId}:IDENT`, 'fault-read', ledger, link.motion);
            const fs = mayRunProtocolRead(`${ecuId}:FS_LESEN`, 'fault-read', ledger, link.motion);
            if (!fs.allowed) return en.runBlock[fs.reason];
            show('diagnosis', 'list');
            try {
                // The link reports a refused or failed read as null and keeps its sentence: a read the
                // preflight stopped (the car moving) must reach the assistant as not sent, and why.
                if (hasIdent(target) && ident.allowed && (await link.readIdent(ident.requires)) === null) {
                    return link.lastError() ?? 'The identity read did not complete.';
                }
                if (mayTryFaultRead(target)) {
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
            const partsOf = partTable(module, input.workflows);
            const words = (query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
            const classes = kind ? KINDS[kind] : null;
            const jobs = profile.jobs
                .filter((j) => !classes || classes.includes(j.class))
                .filter((j) => {
                    if (words.length === 0) return true;
                    const desc = j.desc ? resolveText(profile, j.desc, 'en').text : '';
                    // The parts a job drives, by name, so 「油圧ポンプ」 finds the job that drives it (F32).
                    const parts = (j.args[0]?.options ?? []).map((o) => { const n = partsOf.get(o.value); return n ? `${o.value} ${n.ja} ${n.en}` : o.value; }).join(' ');
                    const hay = `${j.id} ${j.ja} ${j.en} ${desc} ${j.system} ${parts}`.toLowerCase();
                    return words.some((w) => hay.includes(w));
                })
                .slice(0, limit)
                .map((j) => {
                    // A job that drives something is asked as the screen asks it: PRACTICE runs what it
                    // rehearses (F11: a clear read "practise first" while PRACTICE was on).
                    const drives = j.class !== 'read';
                    const v = drives
                        ? mayActuate(j as CatalogJob, bestTelegram(table, j.id), ledger, { moduleId: module, mode: link.mode, motion: link.motion, group: profile.group })
                        : mayRun(j, bestTelegram(table, j.id), ledger, { moduleId: module, motion: link.motion });
                    const rec = ledger.records[`${module}:${j.id}`];
                    const named = (j.args[0]?.options ?? []).filter((o) => partsOf.has(o.value)).map((o) => ({ part: o.value, nameJa: partsOf.get(o.value)!.ja }));
                    return {
                        job: j.id,
                        name: j.en,
                        nameJa: j.ja,
                        kind: j.class,
                        risk: jobRiskOf(j),
                        preconditions: j.preconditions,
                        mayRunNow: v.allowed,
                        reason: v.allowed ? null : en.runBlock[v.reason],
                        // The screen's own sentence for the same refusal, so the two say one thing (U2, MM01).
                        reasonJa: v.allowed ? null : ja.runBlock[v.reason],
                        // What a clear takes with it, for the read-back before it (SC02 step 4).
                        ...(/^FS_LOESCHEN/.test(j.id) ? { clears: CLEAR_CONSEQUENCE } : {}),
                        // A job that takes values has its own door (car, 2026-11-19: a bare "takes values" read as "cannot be run").
                        ...(runWith(module, j) ? { runWith: runWith(module, j) } : {}),
                        ledger: rec ? { status: rec.status, observations: rec.observations ?? 0, practiced: rec.practiced ?? 0 } : null,
                        ...(named.length ? { parts: named } : {}),
                        ...(drives && module === ecuId ? { readBack: readBackOf(module, j as CatalogJob) } : {}),
                    };
                });
            // SMG II's procedures are not SGBD jobs (one job, TESTPRG_STARTEN, with a program number):
            // listed here so monitoring_procedure's number can be found (lib/catalogRoutes).
            const procedures =
                !kind || kind === 'calibration' || kind === 'test'
                    ? procedureRows(module, input.workflows, profile.jobs.find((j) => j.id === 'TESTPRG_STARTEN'), profile.group, ledger, link.motion, words).map((p) => ({
                          ...p,
                          reason: p.reason ? en.runBlock[p.reason] : null,
                      }))
                    : [];
            return { module, name: moduleName(module), jobs, ...(procedures.length ? { procedures } : {}), inSession: module === ecuId };
        },

        entries: () => listAllEntries(),
        add: async (es) => {
            await addEntries(es);
            input.probeSessions.note(es);
            await probe.refresh();
            // A delegated record goes to the account as it is written, so the desk reads it soon.
            input.syncInvestigations();
        },
        live: probe.live,
        lastRun: () => probe.lastRun,

        ledger: (moduleId) => {
            const rows = Object.values(ledger.records)
                .filter((r) => !moduleId || r.id.startsWith(`${moduleId}:`))
                .map((r) => ({
                    id: r.id,
                    status: r.status,
                    observations: r.observations ?? 0,
                    lastObservedAt: r.lastObservedAt ?? null,
                    movingOk: r.status === 'moving-ok',
                    // Practised in PRACTICE (policy: once there before it runs on a car), per part it drives.
                    practiced: r.practiced ?? 0,
                    practicedAt: r.practicedAt ?? null,
                    reason: r.reason ?? null,
                }));
            return {
                records: rows,
                note: 'Reads are cleared for a moving car by the owner, on the screen. practiced: how often a job that drives something ran in PRACTICE (per part for a job that takes values); one that was never practised runs on a car only after it has.',
            };
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

        actuate: async ({ module, job: jobId, phase, ownerSaid, values, query }) => {
            if (module !== ecuId) {
                return refusal('route', `The screen is on ${moduleName(ecuId)}. Put ${moduleName(module)} on it first (monitoring_module).`, `monitoring_module ${module}, then ask again.`);
            }
            const job = catalog?.jobs.find((j) => j.id === jobId);
            if (!job) return refusal('route', `${jobId} is not a job of ${moduleName(module)}.`, `monitoring_catalog ${module} lists its jobs.`);
            // A test program is a procedure: stopped first and last, followed to its end by its dialog.
            if (isProcedureStart(module, job.id))
                return refusal('route', `${job.id} is started as a procedure: monitoring_procedure with its program number (monitoring_catalog lists the procedures).`, 'monitoring_procedure with its program number.');
            // The owner's table first, before any value (IJ F08): a write is refused as a write, an item
            // kept for a person on the screen is put there for them.
            const table = tableRefusal(module, job, catalog?.group);
            if (table) {
                const staged = table.screen ? await stageOnScreen(module, job) : false;
                return { ...mayRefusal(table), ...(staged ? { staged: true } : {}) };
            }
            // An address several modules may answer at (0x56: ASC MK20 on an early car, DSC on a late one)
            // gets nothing but the common frames until the owner has said which, once, on the screen.
            const unconfirmed = input.variantUnconfirmed(module);
            // A job without values whose frame every candidate at the address carries byte for byte (a
            // fault-memory clear, mostly) is the common frame the house rule allows: whichever module is
            // fitted, the bytes are its own (MM01: the sunroof's clear).
            if (unconfirmed && !(job.args.length === 0 && catalog && (await commonToCandidates(catalog.address, job.id)))) return refusal('S5', unconfirmed, VARIANT_NEXT);
            // The phase and the set of values (lib/agreedChoices: the screen and the coverage count ask
            // the same; a job that stays on until its stop always starts with it armed).
            const choices = job.args.length > 0 && catalog ? await loadChoices(module, catalog.address, job, catalog.jobs as CatalogJob[]) : [];
            const pick = assistantPick(job, choices, phase, values, (args) => decisionFor(module, job, catalog?.group, args).who === 'ai');
            if (!pick.ok) return { ...(pick.stop === 'S4' ? refusal('S4', pick.reason) : refusal('route', pick.reason, 'Read back the set meant, wait for the OK, and pass it as values.')), ...(pick.sets ? setsAnswer(module, job, pick.sets, query, values) : {}), readBack: readBackOf(module, job) };
            const { runPhase, choice } = pick;
            const args = choice?.start.args;
            const may = assistantMayStart(module, job, catalog?.group, link.motion, ownerSaid, args);
            if (!may.ok) {
                const staged = may.screen ? await stageOnScreen(module, job) : false;
                return { ...mayRefusal(may), ...(staged ? { staged: true } : {}), readBack: readBackOf(module, job, args) };
            }
            if (link.lineLost) return refusal('state', 'The line is lost (the module stopped answering): nothing starts until it is back.', 'Wait for the line to come back (monitoring_status), or reconnect with monitoring_connect.');
            if (link.state !== 'connected') return refusal('state', `The link is ${link.state}; a job starts from connected and idle.`, LINK_NEXT);
            // One thing driven at a time (the owner's rule, 2026-11-15), said by the part that is on.
            if (input.arming.anyArmed) return { ...refusal('S7', `${onNow()} is on. Stop it first (monitoring_stop_outputs).`), on: armedNow() };
            const telegrams = await loadTelegrams(module);
            // The very gate ACTUATOR's row asks, with the same inputs.
            const v = mayActuate(job, choice ? telegramOfAgreed(choice.start) : bestTelegram(telegrams, job.id), ledger, {
                moduleId: module,
                mode: link.mode,
                motion: link.motion,
                group: catalog?.group,
                ...(choice ? { args, agreed: choice.start } : {}),
            });
            if (!v.allowed) return { ...gateRefusal(v.reason), refused: v.reason, readBack: readBackOf(module, job, args) };
            // Everything the app decides has passed: the job's row is put on the screen with its set, so
            // the owner sees it measured and started there — or, if the car refuses at the wire, why.
            input.pickSet(module, job.id, args ?? null);
            input.selectJob(job);
            if (isOn('actuator')(job)) input.changeTab('actuator');
            const r = await startActuation({
                moduleId: module,
                job,
                phase: runPhase,
                verdict: v,
                telegrams,
                args,
                stop: choice?.stop,
                send: link.runRead,
                arm: input.arming.arm,
                now: Date.now(),
            });
            const part = partName(module, job, args, input.workflows);
            if (r.sent && !r.armed) input.noteSentOnce(module, job.id, args ?? null);
            if (!r.sent) {
                // The link's own reason, measured just now (moving with its speed, the battery with its
                // volts), read straight after the await — not the render's `link.error`, which is older.
                const ns = link.lastNotSent();
                return {
                    ...(ns
                        ? refusal(NOT_SENT_STOP[ns.reason], notSentSentence(ns))
                        : refusal('state', link.lastError() ?? 'Not sent: the link refused or the module did not answer.', 'monitoring_status says the link’s state; ask again once it answers.')),
                    job: job.id,
                    part: part.part,
                    partNameJa: part.ja,
                    ...(ns ? { why: ns.reason, measured: ns.measured } : {}),
                };
            }
            return {
                started: true,
                job: job.id,
                ...(args ? { values: args } : {}),
                name: job.en,
                part: part.part,
                partName: part.en,
                partNameJa: part.ja,
                mode: link.mode,
                on: r.armed,
                stopsByItselfAfterS: r.timeoutS,
                ownerSaid,
                reason: null,
                ...(r.armed
                    ? { say: `${part.ja}を動かしました。${r.timeoutS} 秒で止まります。` }
                    : { say: `${part.ja}に一度送りました。モジュールが答え、自分で終えます。`, note: 'Sent once: the job ends by itself in the module (its SGBD gives no stop), so nothing stays on and there is no STOP.' }),
            };
        },

        procedure: async ({ procedure, gear, ownerSaid }) => {
            if (ecuId !== 'smg2') return refusal('route', `Procedures are SMG II's. Put SMG II on the screen first (monitoring_module).`, 'monitoring_module smg2, then ask again.');
            const want = procedure.trim().toLowerCase();
            const p = input.workflows?.procedures.find((x) => x.id.toLowerCase() === want || x.testprg.toLowerCase() === want);
            const job = p ? procedureAsJob(p) : undefined;
            const startJob = catalog?.jobs.find((j) => j.id === 'TESTPRG_STARTEN');
            if (!job || !startJob) return refusal('route', `${procedure} is not one of SMG II's procedures (monitoring_catalog lists them).`, 'monitoring_catalog smg2 lists the procedures.');
            const program = job.id.slice(PROCEDURE_PREFIX.length);
            const unconfirmed = input.variantUnconfirmed(ecuId);
            if (unconfirmed) return refusal('S5', unconfirmed, VARIANT_NEXT);
            const may = assistantMayStart(ecuId, startJob, catalog?.group, link.motion, ownerSaid, [program]);
            if (!may.ok) return mayRefusal(may);
            // A procedure that engages a gear the owner picks does not start on a default (SC08 F07).
            if (p?.auswahl && gear === undefined)
                return { ...refusal('route', `${p.name.en} engages the gear the owner chooses: ask which (「何速ですか？」: 0 neutral, 1–6, 7 reverse) and pass it as gear.`, 'Ask the owner which gear, and pass it as gear.'), takesGear: true };
            if (link.state !== 'connected') return refusal('state', `The link is ${link.state}; a procedure starts from connected and idle.`, LINK_NEXT);
            if (input.arming.anyArmed) return { ...refusal('S7', `${onNow()} is on. Stop it first (monitoring_stop_outputs).`), on: armedNow() };
            const g = gear === undefined ? undefined : Number(gear);
            if (g !== undefined && !Number.isInteger(g)) return refusal('route', `${gear} is not a gear its dialog offers.`, 'Pass a gear its dialog offers: 0 neutral, 1–6, 7 reverse.');
            input.startProcedure(job, ownerSaid, g);
            return {
                started: true,
                procedure: program,
                name: job.en,
                mode: link.mode,
                ownerSaid,
                note: 'Its dialog is on the screen and runs it through the gate; it may still refuse there (not measured parked, battery, engine), or the module may refuse a step, and the dialog says why. It ends by itself, or with ABORT or monitoring_stop_outputs. monitoring_status lastProcedure says how it ended.',
            };
        },

        variant: ({ module, ownerSaid }) => {
            // The owner's own statement of the car's equipment: nothing is sent, and their words are what is recorded.
            const said = ownerSaid.trim();
            if (!said) return { recorded: false, reason: "Ask the owner which module is fitted and pass their words as owner_said." };
            const r = input.recordVariant(module);
            if (!r.ok) return { recorded: false, reason: r.reason };
            const hex = `0x${r.address.toString(16).toUpperCase().padStart(2, '0')}`;
            const others = (ecuIndex?.modules ?? []).filter((m) => m.address === r.address && m.id !== module).map((m) => m.id);
            return { recorded: true, address: hex, module, ownerSaid: said, ruledOut: others, note: `Kept on this device for this car, as the screen keeps it. ${moduleName(module)} at ${hex}: what drives goes there through the same gate as any other module's.` };
        },

        stopOutputs: async () => {
            const done = await input.arming.stopAll('stop');
            return {
                stopped: done.map((d) => d.entry.jobId),
                parts: done.map(stoppedOf),
                ...(done.some((d) => !d.confirmed) ? { note: 'A stop went with no answer (the line): it is sent again when the line is back, and the ECU ends it by its own time-out regardless.' } : {}),
            };
        },

        startLog: () => {
            if (link.state !== 'connected' || datalog.isRunning()) return `The link is ${datalog.isRunning() ? 'logging' : link.state}; a recording starts from connected and idle.`;
            if (target.decoder !== 'mss54') return en.datalog_noDecoder;
            if (datalog.current().length === 0) return 'No DATALOG channel is selected: choose them first (monitoring_log_channels).';
            void datalog.start();
            // The owner asked for the values and the trace while a recording runs, not the fault list.
            show('datalog', 'visu');
            return null;
        },

        datalog: (opts) => {
            const snap = datalog.snapshot();
            const recording = datalog.isRunning() && !running;
            return {
                selected: datalog.current(),
                cost: selectionCost(datalog.current()),
                running: recording,
                recorded: snap.recorded,
                // The run in segments: where its channels changed while it recorded, and the ten-minute
                // cuts (lib/datalogRun). Every segment's samples are in the summary below; nothing earlier is lost.
                segments: segmentStats(snap.segments, snap.samples).map((x) => ({ fromS: Math.round(x.from * 10) / 10, why: x.why, part: x.part, channels: x.channels, blocks: x.blocks, samples: x.samples, rateHz: x.rateHz })),
                ...datalogSummary(snap.recorded, snap.samples, { ...opts, gear: true }, datalog.moduleInfo),
                gearNote: GEAR_NOTE,
                ...(snap.samples.length === 0 ? { note: recording ? 'Recording has begun; the first samples are on their way.' : 'Nothing recorded yet on this page: choose channels (monitoring_log_channels), then monitoring_start_log.' } : {}),
            };
        },

        datalogMoment: ({ secondsAgo, windowS, channels, after }) => {
            const snap = datalog.snapshot();
            if (snap.samples.length === 0 || snap.startedAt === null) return null;
            const lastAt = snap.startedAt + snap.samples[snap.samples.length - 1].time * 1000;
            // A PROBE run that ended after this recording is the newer record of the drive.
            if (after !== null && after > lastAt) return null;
            const centre = (appNow() - secondsAgo * 1000 - snap.startedAt) / 1000;
            const m = momentOf(snap.samples, centre, windowS, channels ?? null);
            if (!m) {
                return {
                    recorded: false,
                    source: 'datalog',
                    reason: centre < 0 ? 'That moment is before the recording began.' : 'No samples of the recording in that window.',
                };
            }
            // The screen's cursor stands where the answer was taken, and DATALOG comes up to show it.
            datalog.setCursor(m.cursor.t);
            show('datalog', 'visu');
            return {
                recorded: true,
                source: 'datalog',
                running: datalog.isRunning(),
                window: m.window,
                cursor: m.cursor,
                samples: m.samples,
                segments: segmentStats(snap.segments, snap.samples)
                    .filter((x, i, all) => x.from <= m.window.to && (all[i + 1]?.from ?? Infinity) >= m.window.from)
                    .map((x) => ({ fromS: Math.round(x.from * 10) / 10, why: x.why, channels: x.channels.length, blocks: x.blocks, rateHz: x.rateHz })),
                captures: [],
                driverWords: [],
                gearNote: GEAR_NOTE,
            };
        },

        logChannels: async ({ query, channels }) => {
            const recording = datalog.isRunning() && !running;
            if (channels) {
                if (running) return { selected: datalog.current(), changed: false, reason: 'A PROBE run holds the link; its plan chooses what it reads.' };
                // Another module's read values (smg2:JOB:RESULT) are channels where DATALOG offers them.
                const unknown = unknownChannels(channels).filter((c) => !datalog.moduleInfo(c));
                if (unknown.length) {
                    return { changed: false, reason: `Not a live channel of the MSS54: ${unknown.join(', ')}.`, suggestions: unknown.flatMap((u) => { const byJob = channelsForJob(u); return byJob.length ? byJob : findChannels(u.split(':').pop() ?? u, 5); }) };
                }
                if (channels.length === 0) return { changed: false, reason: 'Choose at least one channel.' };
                const ids = channels as ChannelId[];
                // While recording, the run goes on: a segment of the same recording from the next sample.
                if (recording) {
                    const ok = await datalog.retune(ids);
                    if (!ok) return { selected: datalog.current(), changed: false, reason: 'The recording would not take these channels: the DME must keep at least one block to read.' };
                } else {
                    datalog.select(ids);
                }
                show('datalog', recording ? 'visu' : 'list');
                const others = channels.filter((c) => datalog.moduleInfo(c));
                const cost = { ...selectionCost(channels.filter((c) => !datalog.moduleInfo(c)) as ChannelId[]), ...(await expectedRate(ids)) };
                return {
                    changed: true,
                    selected: channels,
                    channels: describeChannels(ids, datalog.moduleInfo),
                    cost,
                    ...(others.length ? { otherModules: { channels: others, note: 'Read once per sample by the module’s own SGBD code. Status reads go while the car moves too (the owner’s table); a read that goes only parked is empty while the car moves.' } } : {}),
                    ...(recording
                        ? { recording: true, segment: 'The recording goes on: from its next sample it reads these, a segment of the same run (marked on the graph, kept in the record).' }
                        : { then: 'monitoring_start_log records them.' }),
                };
            }
            const words = (query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
            const others = words.length
                ? datalog.moduleInfos.filter((i) => words.every((w) => `${i.channel} ${i.name} ${i.ja} ${i.module}`.toLowerCase().includes(w))).slice(0, 20)
                : [];
            const found = query ? [...findChannels(query), ...others] : [];
            const foundIds = found.map((c) => c.channel as ChannelId);
            return {
                selected: datalog.current(),
                found,
                // What choosing every channel found would cost, before choosing: the round trips and the rate.
                ...(foundIds.length ? { estimate: { ...selectionCost(foundIds.filter((c) => !datalog.moduleInfo(c))), ...(await expectedRate(foundIds)) } } : {}),
                cost: { ...selectionCost(datalog.current().filter((c) => !datalog.moduleInfo(c))), ...(await expectedRate(datalog.current())) },
            };
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
            // PROBE's samples are the investigation's, never MEMORY's: say where they are, so a
            // count of 0 here is not read as a loss.
            const record = input.probeSessions.opened();
            const probeRuns = probeKept(record, record ? await listRuns(record).catch(() => []) : []);
            return s
                ? { saved: true, label: s.label, ...summarise(s), ...(probeRuns ? { probeRuns } : {}) }
                : { saved: false, reason: 'Nothing was written to this device.', ...(probeRuns ? { probeRuns } : {}) };
        },

        connect: async () => {
            if (link.state !== 'disconnected') return { connected: link.state !== 'connecting', reason: `The link is ${link.state}.` };
            const reason = await link.reconnectPermitted();
            if (reason !== null) return { connected: false, reason };
            const opened = { id: ecuId, name: moduleName(ecuId) };
            // ALL MODULES on the screen, one module on the link (owner, 2026-11-28: the screen said ALL
            // MODULES and the link had quietly opened on MSS54). Say both, so the assistant does too.
            if (tab === 'diagnosis' && input.allModules) {
                return {
                    connected: true,
                    module: opened,
                    showing: 'all-modules',
                    note: `The screen stays on ALL MODULES; the link opened on ${opened.name} (linkModule, shown as LINK beside the ALL MODULES title). monitoring_scan reads every module's faults through this link; single-module tools act on ${opened.name}. Tell the owner both.`,
                };
            }
            return { connected: true, module: opened };
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
            if (typeof r === 'string') return refusal('state', r, 'monitoring_status says what the tab is doing; ask again once it is idle and connected.');
            show('diagnosis', 'list');
            return {
                started: true,
                addresses: r.addresses,
                takes: 'up to about 2 s for each address that does not answer, less for those that do',
                then: 'monitoring_status shows how far it has got; monitoring_faults without module gives every module once it ends. The screen shows it on DIAGNOSIS under ALL MODULES.',
                ...(link.mode === 'practice' ? { practice: 'PRACTICE: the practice car — a late E46 M3 with SMG II, DSC and navigation — answers at the addresses such a car has; the rest are silent. Its values are simulated.' } : {}),
            };
        },

        switchModule: async (id) => {
            const { reason, stopped } = await input.switchModule(id);
            if (!reason) show('diagnosis', 'list');
            // What was on is stopped before the switch, and said (IJ05).
            const off = stopped.length ? { stopped: stopped.map(stoppedOf), stoppedNote: `${stopped.map((x) => stoppedOf(x).partNameJa).join('、')} was on: it was stopped before the switch.` } : {};
            return reason
                ? { switched: false, reason, ...off }
                : { switched: true, module: { id, name: moduleName(id) }, note: 'The screen shows it; an open link was opened again for it.', ...off };
        },

        probe: async (record) => {
            if (link.state !== 'connected') return refusal('state', `The link is ${link.state}; PROBE starts from connected and idle.`, LINK_NEXT);
            const r = await probe.start(record);
            if (r.started) {
                // Its board, with the values and the trace (show() lets a run keep it from here on).
                input.changeTab('probe');
                input.showPane('visu');
            }
            if (r.started) return { started: true, record: r.record, plan: r.v, run: r.n, stop: 'monitoring_stop_log, after a read-back' };
            const why: Record<typeof r.reason, string> = {
                off: 'PROBE is not in this build, or the module index has not loaded.',
                running: 'A PROBE run is already going.',
                none: 'No plan may run: write one under a standing mandate (monitoring_plan).',
                forked: 'Two plans rewrite the same one; the driver chooses which to keep.',
                'mandate-ended': 'The mandate has ended (withdrawn or expired); carry the record on with monitoring_investigate and record.',
            };
            return refusal('state', why[r.reason], r.reason === 'none' || r.reason === 'mandate-ended' ? 'monitoring_plan or monitoring_investigate, as the sentence says.' : r.reason === 'running' ? 'monitoring_stop_log ends the run going, after a read-back.' : r.reason === 'forked' ? 'Ask the driver which plan to keep.' : 'Reload the page; the module index loads with it.');
        },

        runs: (record) => listRuns(record).catch(() => []),

        mode: () => input.mode,
        session: () => input.probeSessions.opened(),
        openSession: (id) => input.probeSessions.open(id),
        openSaved: async (id) => {
            const s = (await listLocal().catch(() => [])).find((x) => x.id === id);
            if (!s) return null;
            sessions.view(s.id);
            input.changeTab('memory');
            return { opened: s.id, label: s.label, screen: 'memory' as const };
        },
        newSession: () => input.probeSessions.newSession(),
        board: (record) => getBoard(record),
        putBoard: (b) => putBoard(b),

        sync: async () => {
            if (!canSync()) return { sent: 0, reason: 'This build does not send: it is not the WORKS build, or its notice is not confirmed.' };
            const before = new Map((await listLocal().catch(() => [])).map((s) => [s.id, s.syncedAt]));
            // No network (IJ18): nothing goes now, and the answer says so — the send is kept and made
            // once by itself when the network is back (useSessions), with the sent mark after it.
            if (!sessions.online) {
                await sessions.sync();
                const waiting = (await listLocal().catch(() => [])).filter(needsSync).length;
                return {
                    sent: 0,
                    waiting,
                    reason: 'offline',
                    willSendWhenOnline: true,
                    note: 'This device has no network now. The sessions waiting are kept on it and sent by themselves, once, when the network is back; MEMORY marks each sent then.',
                };
            }
            const outcome = await sessions.sync();
            const after = await listLocal().catch(() => []);
            const sent = after.filter((s) => s.syncedAt !== null && s.syncedAt !== before.get(s.id)).length;
            const waiting = after.filter(needsSync).length;
            // What did not go, and why, in the same terms as the screen's notice line (SC05).
            const why = SYNC_STOPPED[outcome.stopped ?? ''];
            return {
                sent,
                waiting,
                ...(why ? { reason: outcome.stopped, ...(outcome.status ? { status: outcome.status } : {}), note: why } : {}),
                ...(outcome.tooLarge.length ? { tooLarge: outcome.tooLarge, tooLargeNote: 'Too large ever to send as they are; kept on this device.' } : {}),
            };
        },
    };
}

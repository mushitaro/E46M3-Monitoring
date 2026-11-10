/**
 * One link to the car, with no screen: the session the app's hook (`src/hooks/useDs2Link.ts`) and
 * any other app's screens drive.
 *
 * Moved out of the hook unchanged in what it sends and when (2026-11-11). What it owns is the
 * session state machine and the discipline that the two apps share:
 *
 *   - error and errorKind are set by ONE helper and cleared by ONE helper. A
 *     stale "electrical" beside a fresh timeout is worse than no classification.
 *   - the keep-alive TIMER lives in the hook; the decision to skip lives here (`heartbeat`) and in
 *     the link. Gating the interval on UI state would be a second, weaker copy of the gate's rule.
 *   - both endings of a telemetry run land in the same teardown. A run stops
 *     because the user pressed stop OR because the link failed, and on an
 *     unstable cable the second is the common one.
 *
 * What the screen sees is one immutable snapshot (`getSnapshot`), replaced whenever a field changes
 * and announced to `subscribe`rs — the shape `useSyncExternalStore` reads. What the operations read
 * at send time (the mode, the module, the fitment, the car's state) are fields of this object, never
 * the snapshot: a value captured at render time can be stale in the one direction that matters.
 */

import {
    Ds2Address,
    Ds2Error,
    Ds2Link,
    FTDI_VENDOR_ID,
    buildDs2Frame,
    describeStatus,
    isPositiveResponse,
    WebSerialTransport,
    createDs2Transport,
    detectTransportKind,
    isDs2Error,
    latencyTimerOf,
    toHex,
    type Ds2ByteTransport,
    type Ds2ErrorKind,
    type Ds2Frame,
    type Ds2Target,
    type RetryOptions,
    type TransportKind,
} from '@tsunagi/ds2-core';
import {
    ERROR_MEMORY_ENTRIES,
    ERROR_MEMORY_QUICKTEST,
    MSS54_ADAPTATION_BLOCKS,
    adaptationBlockMinLength,
    blockBySelection,
    decodeAdaptationBlock,
    decodeLiveBlock,
    liveBlockRequest,
    parseErrorMemoryEntries,
    parseQuickTest,
    channelId,
    planBlockReads,
    type ChannelId,
    type ErrorMemoryEntry,
    type ErrorMemoryQuickTest,
} from '@tsunagi/ds2-mss54';
import { appNow } from '../clock';
import { kwpExchange, parseDtcsByStatus, type KwpFrame } from '../kwpOnDs2';
import { whyNotSendable } from '../actuationGate';
import type { ReadRecord } from '../investigation/readRecord';
import type { ModuleProtocol } from '../moduleProtocol';
import { PracticePort } from '../practiceEcu';
import { practiceCar } from '../practiceCar';
import { runProbe, type ProbeDeps, type ProbePlan, type ProbeRun } from '../probe/executor';
import { modulesOf } from '../probe/plan';
import { runScan, type ScanRun, type ScanTarget } from '../probe/scan';
import { EMPTY_IDENTITY, loadIdentity, type Identity } from '../identity';
import { DME_ADDRESS, commonIdent, fittedFrom, frameVerdict, isCommonIdent, isM3, mayModuleBeSent, ruleFor, type Fitment, type Fitted } from '../variants';
import type { Ledger } from '../ledger';
import { clearFaultsCommand, telegramBytes, type SendRequirement } from '../runGate';
import {
    VEHICLE_STATE_MAX_AGE_MS,
    motionOf,
    vehicleStateFrom,
    type LiveValues,
    type Motion,
    type VehicleState,
} from '../vehicleState';
import type {
    AdaptationRead,
    CommsLogLine,
    JobRunResult,
    LinkFailure,
    LinkMode,
    LinkState,
    LiveSample,
    ParkedObservation,
    RawFaultRead,
} from './types';

/** How often the hook calls `heartbeat`. */
export const KEEP_ALIVE_INTERVAL_MS = 2000;

/**
 * Hand the event loop back once per sample.
 *
 * This is a YIELD, not a cadence — the sample rate is still the round-trip time.
 * It is here because of a failure mode that only a fast device produces: when
 * the ECU answers synchronously (PRACTICE, or a future in-process simulator),
 * every await in an exchange resolves as a MICROTASK, and microtasks do not
 * yield to the macrotask queue. The poll loop then starves timers, rendering
 * and input outright — the tab simply stops responding.
 *
 * Real hardware hides this completely: a 197 ms round trip is a real wait, and
 * so was the 30 ms resync settle that used to be paid on every clean attempt.
 * Removing that settle (correctly — it was 30 ms of pure loss per exchange) is
 * what exposed the starvation. That is the shape of the bug worth remembering:
 * the accidental yield was load-bearing, and nothing said so.
 *
 * Deliberately setTimeout and NOT scheduler.yield(). scheduler.yield() resumes
 * in a continuation that is prioritised ahead of newly queued tasks, which is
 * the point of it — and it means a tight loop calling it still starves
 * rendering. Measured: the tab stayed unresponsive with scheduler.yield() and
 * recovered with setTimeout.
 *
 * setTimeout(0) is clamped to ~4 ms once nested, so this puts a ~250 Hz ceiling
 * on the loop. That is far above anything DS2 can do — a real round trip is
 * ~197 ms, i.e. about 5 Hz — so the ceiling is never the binding constraint on
 * a vehicle, only on a simulator that has no rate to report anyway.
 */
function yieldToEventLoop(): Promise<void> {
    return new Promise((r) => setTimeout(r, 0));
}

/**
 * The comms log is a ring buffer, not an unbounded array and not a DOM node.
 * The old app kept it only in the DOM, trimmed at 400 lines and lost it on
 * every reload — including the reloads its own service worker triggered — so
 * there was never anything to attach to a bug report.
 */
const LOG_CAPACITY = 5000;

/** What the connect log calls each backend. It has to name the one actually in use: the two do
 *  not measure the same thing, so a session that says the wrong one makes every timing in it
 *  unattributable. */
const TRANSPORT_LABEL: Record<Exclude<TransportKind, 'none'>, string> = {
    'web-serial': 'Web Serial',
    'web-usb-ftdi': 'WebUSB (FTDI)',
};

/**
 * A dismissed device chooser, from either backend.
 *
 * `navigator.serial.requestPort()` and `navigator.usb.requestDevice()` both reject with a
 * NotFoundError when the picker is closed without choosing. Neither transport wraps that
 * rejection — deliberately, and both say so in a comment — so the name survives to here. The
 * message test is a belt-and-braces for an engine that gets the name wrong.
 */
function isUserCancel(e: unknown): boolean {
    if (!(e instanceof Error)) return false;
    return e.name === 'NotFoundError' || /no (port|device) selected/i.test(e.message);
}

/**
 * Thrown where the app refuses before anything is sent. A plain Error on purpose: the
 * electrical-fault dialog must not claim a wiring problem for a decision of our own.
 */
function refuse(message: string): never {
    throw new Error(message);
}

const hex2 = (n: number) => `0x${n.toString(16).padStart(2, '0')}`;

/** The DME, which is where the car's speed is read from whichever module is in session. */
const DME = Ds2Address.DME;
/** MSS54 live block 19, "operating measurements": `v` and `v_asc` at offsets 0 and 2. */
const SPEED_BLOCK = 19;

/** A cable this browser has already been allowed: an FTDI device over WebUSB, or a port over Web Serial. */
async function hasPermittedCable(): Promise<boolean> {
    const nav = navigator as unknown as {
        usb?: { getDevices(): Promise<{ vendorId: number }[]> };
        serial?: { getPorts(): Promise<unknown[]> };
    };
    try {
        const kind = detectTransportKind();
        if (kind === 'web-usb-ftdi') return (await nav.usb!.getDevices()).some((d) => d.vendorId === FTDI_VENDOR_ID);
        if (kind === 'web-serial') return (await nav.serial!.getPorts()).length > 0;
        return false;
    } catch {
        return false;
    }
}

/**
 * The transport for a reconnect: over WebUSB the FTDI transport already takes an allowed device
 * before it would ask; over Web Serial the first allowed port is handed in, so `requestPort` — the
 * chooser — is never reached.
 */
function permittedTransport(): ReturnType<typeof createDs2Transport> {
    const selected = createDs2Transport();
    if (selected.kind !== 'web-serial') return selected;
    const serial = (navigator as unknown as { serial: { getPorts(): Promise<unknown[]> } }).serial;
    return {
        kind: 'web-serial',
        transport: new WebSerialTransport({
            requestPort: async () => {
                const [port] = await serial.getPorts();
                if (!port) throw new Error('No allowed serial port.');
                return port as never;
            },
        }),
    };
}

/** What the screen sees of the link: replaced, never mutated, whenever one field changes. */
export interface LinkSnapshot {
    state: LinkState;
    mode: LinkMode;
    error: string | null;
    errorKind: Ds2ErrorKind | null;
    log: CommsLogLine[];
    ident: { hex: string; length: number } | null;
    /** Which module each address said it is on this link (variants), the DME's first. */
    fitment: Fitment;
    faults: ErrorMemoryEntry[] | null;
    quickTest: ErrorMemoryQuickTest | null;
    rawFaults: RawFaultRead[] | null;
    adaptations: AdaptationRead[] | null;
    lastRun: JobRunResult | null;
    /** The last all-module scan, and how far one in progress has got. */
    scan: ScanRun | null;
    scanProgress: { done: number; total: number } | null;
    vehicleState: VehicleState | null;
    motion: Motion;
}

/** Who is told what, as it happens. Each may change at any time (`setHandlers`). */
export interface LinkHandlers {
    onFailure?: (failure: LinkFailure) => void;
    /** Told about each read that answered on a car measured stationary. Vehicle only. */
    onObserved?: (o: ParkedObservation) => void;
    /** Told about every read sent to the car and what came back, either way (the preview's read
     *  records). Vehicle only: PRACTICE sends nothing to a car. */
    onRead?: (r: Omit<ReadRecord, 'id'>) => void;
}

const INITIAL: LinkSnapshot = {
    state: 'disconnected',
    mode: 'vehicle',
    error: null,
    errorKind: null,
    log: [],
    ident: null,
    fitment: new Map(),
    faults: null,
    quickTest: null,
    rawFaults: null,
    adaptations: null,
    lastRun: null,
    scan: null,
    scanProgress: null,
    vehicleState: null,
    motion: 'unknown',
};

export class LinkSession {
    private snap: LinkSnapshot = INITIAL;
    private readonly listeners = new Set<() => void>();

    /**
     * The mode, read at send time rather than at render time.
     *
     * The byte-level refusal in `runRead` is the last thing between a control
     * byte and the car, and a `mode` captured in a closure can be stale in the
     * one direction that matters: a callback created while PRACTICE was on,
     * still held after a reconnect to a vehicle, would wave through 0x0c. A field
     * is read when the bytes go, so it cannot be older than the link.
     *
     * Written in exactly one place, next to the snapshot's `mode`, so the two cannot drift.
     */
    private modeNow: LinkMode = 'vehicle';
    /** The module the reads on screen came from; a connect to another one drops them. */
    private readsOf: string | null = null;
    /**
     * What each address said to its common IDENT on this link, and which module that makes it
     * (variants). Empty at every connect: it is a fact about the car on the other end, and the
     * next connect may be another car. The link's send guard reads this; the screen the snapshot.
     */
    private fitmentNow: Map<number, Fitted> = new Map();
    /** The group rules and the module map, loaded once a page; connect waits for them. */
    private identity: Identity = EMPTY_IDENTITY;
    private identityLoad: Promise<Identity> | null = null;
    private vehicleNow: VehicleState | null = null;

    private link: Ds2Link | null = null;
    /** Held alongside the link because the latency timer is a BACKEND capability, not a link one,
     *  and the run boundary that operates it lives here. */
    private transport: Ds2ByteTransport | null = null;
    private logLines: CommsLogLine[] = [];
    private polling = false;
    private finished = true;
    /** An operation (`run`) is between its frames: the heartbeat keeps out of its gaps. */
    private busy = false;
    // The last failure's sentence, readable at once by a caller that awaited the operation — the
    // assistant's facade, which must say why a read was not sent rather than that it was.
    private lastErrorNow: string | null = null;
    private handlers: LinkHandlers = {};
    private transportKindNow: TransportKind | null = null;
    /**
     * The module this session talks to, and the frames its own SGBD lets the app send it.
     *
     * Read at send time. The address is LATCHED at connect: a module picked while a link is open
     * would otherwise retarget it under whatever the operator was looking at, which is why the
     * picker is disabled while connected — and why every operation below re-checks it rather than
     * trusting that it was.
     */
    private target: ModuleProtocol;
    /** The address the open link was connected for. Null when there is no link. */
    private sessionAddress: number | null = null;
    /** The last identity read, for the failure report. */
    private identNow: { hex: string; length: number } | null = null;
    private motionTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(options: { target: ModuleProtocol } & LinkHandlers) {
        this.target = options.target;
        const { onFailure, onObserved, onRead } = options;
        this.handlers = { onFailure, onObserved, onRead };
    }

    // -- What the screen reads -----------------------------------------------------------------

    readonly subscribe = (listener: () => void): (() => void) => {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    };

    readonly getSnapshot = (): LinkSnapshot => this.snap;

    /** Why the last operation failed, or null: read straight after awaiting it. */
    readonly lastError = (): string | null => this.lastErrorNow;

    /** The module operations go to (latched at connect; see `target`). */
    readonly setTarget = (target: ModuleProtocol): void => {
        this.target = target;
    };

    readonly setHandlers = (handlers: LinkHandlers): void => {
        this.handlers = handlers;
    };

    /** An operation or a run is in progress: what the unload guard and the wake lock protect. */
    get inFlight(): boolean {
        return this.snap.state === 'busy' || this.snap.state === 'logging';
    }

    private update(patch: Partial<LinkSnapshot>): void {
        let changed = false;
        for (const k of Object.keys(patch) as (keyof LinkSnapshot)[]) {
            if (!Object.is(patch[k], this.snap[k])) {
                changed = true;
                break;
            }
        }
        if (!changed) return;
        this.snap = { ...this.snap, ...patch };
        for (const l of [...this.listeners]) l();
    }

    private readonly append = (kind: CommsLogLine['kind'], text: string): void => {
        const line = { t: appNow(), kind, text };
        const next = this.logLines.concat(line);
        if (next.length > LOG_CAPACITY) next.splice(0, next.length - LOG_CAPACITY);
        this.logLines = next;
        this.update({ log: next });
    };

    /** One helper sets both. */
    private failWith(e: unknown): void {
        const message = e instanceof Error ? e.message : String(e);
        this.lastErrorNow = message;
        this.update({ error: message, errorKind: isDs2Error(e) ? e.kind : 'unclassified' });
        this.append('error', message);
    }

    /** One helper clears both. */
    readonly clearError = (): void => {
        this.lastErrorNow = null;
        this.update({ error: null, errorKind: null });
    };

    /**
     * The module in session, and the link's view of it.
     *
     * Refuses when the target moved since connect: an operation must go to the module the link was
     * opened for or nowhere. The bytes for every frame below come from `target`, so this is the
     * one place an operation learns where it is sending.
     */
    private session(link: Ds2Link): { target: ModuleProtocol; to: Ds2Target } {
        const target = this.target;
        const at = this.sessionAddress;
        if (at === null || target.address !== at) {
            refuse(`The module changed under an open link (connected to ${at === null ? 'none' : hex2(at)}, now ${hex2(target.address)}). Disconnect and connect again.`);
        }
        return { target, to: link.to(at) };
    }

    /**
     * Tell `onRead` about one read: the frame as it went, and the frame that came back or the error
     * that came instead. Only the car's — PRACTICE sends nothing to one — and never into the read:
     * a record of a read must not become a failure of it.
     */
    private noteRead(to: Ds2Target, moduleId: string, job: string, control: number, payload: Uint8Array, result: { frame: Ds2Frame } | { error: unknown }): void {
        const onRead = this.handlers.onRead;
        if (this.modeNow !== 'vehicle' || !onRead) return;
        try {
            const state = this.vehicleNow;
            const base = {
                at: appNow(),
                module: moduleId,
                job,
                request: toHex(buildDs2Frame(to.address, control, payload)),
                speedKmh: state?.speedKmh ?? null,
                motion: motionOf(state, appNow()),
            };
            if ('frame' in result) {
                const ok = isPositiveResponse(result.frame);
                const status = result.frame.controlOrStatus;
                onRead({
                    ...base,
                    response: toHex(result.frame.payload),
                    outcome: ok ? 'ok' : 'rejected',
                    reason: ok ? null : `${describeStatus(status)} (status 0x${status.toString(16).padStart(2, '0')})`,
                });
            } else {
                const message = result.error instanceof Error ? result.error.message : String(result.error);
                onRead({ ...base, response: null, outcome: 'failed', reason: message.slice(0, 300) });
            }
        } catch {
            /* the record is lost, the read is not */
        }
    }

    /**
     * Send `address` the common IDENT, once a link, and record which module its group's rule says it
     * is (variants). Silence is not kept — a module asleep now may answer in a minute — and an
     * address whose common IDENT is not its own is refused rather than asked.
     */
    private async identify(link: Ds2Link, address: number, fresh = false): Promise<Fitted> {
        const known = this.fitmentNow.get(address);
        if (known && !fresh) return known;
        const id = this.identity;
        if (!id.identOk.has(address)) refuse(`${hex2(address)}: the common IDENT is not this address's own; which module is here is not asked.`);
        const to = link.to(address);
        const frameHex = toHex(commonIdent(address));
        this.append('tx', `IDENT ${frameHex} (which module is at ${hex2(address)}${ruleFor(id.rules, address) ? `, chosen by ${ruleFor(id.rules, address)!.group}` : ''})`);
        let answer: Uint8Array | null = null;
        try {
            const frame = await to.exchangeWithRetry(0x00, new Uint8Array(0), { attempts: 2 });
            answer = Uint8Array.from([frame.address, frame.length, frame.controlOrStatus, ...frame.payload, frame.checksum]);
            this.noteRead(to, hex2(address), 'IDENT', 0x00, new Uint8Array(0), { frame });
        } catch (e) {
            this.noteRead(to, hex2(address), 'IDENT', 0x00, new Uint8Array(0), { error: e });
            if (isDs2Error(e) && e.code === 'NOT_SENT') throw e;
        }
        const f = fittedFrom(id.rules, id.modules, address, answer);
        if (f.answer !== null) {
            this.fitmentNow = new Map(this.fitmentNow).set(address, f);
            this.update({ fitment: this.fitmentNow });
        }
        this.append(
            f.answer === null ? 'info' : 'rx',
            f.answer === null
                ? `${hex2(address)}: no answer to its IDENT`
                : `${hex2(address)} is ${f.sgbd ?? '?'}${f.sgbd && !f.moduleId ? ' (its SGBD is not carried: IDENT only)' : ''}${f.moduleId ? ` → ${f.moduleId}` : ''}`,
        );
        return f;
    }

    /**
     * Before any frame but the common IDENT goes to `address` for `moduleId`: identify what decides
     * (the DME — is this an M3? — and the address itself, when it has a rule), then refuse unless
     * variants says this module's frames may go there. The link's send guard is the backstop
     * under this; this is where the module is known and the refusal can say so.
     */
    private async clearFor(address: number, moduleId: string): Promise<void> {
        const link = this.link ?? refuse('No open link.');
        const id = this.identity;
        if (mayModuleBeSent(address, moduleId, this.fitmentNow, id.rules).ok) return;
        if (!this.fitmentNow.has(DME_ADDRESS) && id.identOk.has(DME_ADDRESS)) await this.identify(link, DME_ADDRESS);
        if (address !== DME_ADDRESS && ruleFor(id.rules, address) && !this.fitmentNow.has(address)) await this.identify(link, address);
        const v = mayModuleBeSent(address, moduleId, this.fitmentNow, id.rules);
        if (!v.ok) {
            this.append('warn', `${moduleId}: not sent — ${v.reason}`);
            throw new Ds2Error('NOT_SENT', `${moduleId}: not sent — ${v.reason}`, { kind: 'refused', detail: { address, moduleId, reason: v.reason } });
        }
    }

    /**
     * `exchangeWithRetry`, with the read told to `onRead` whichever way it went — after `clearFor`
     * has said the module is the one at that address, for every frame but the common IDENT.
     */
    private async readFrame(to: Ds2Target, moduleId: string, job: string, control: number, payload: Uint8Array, options?: RetryOptions): Promise<Ds2Frame> {
        if (!isCommonIdent(buildDs2Frame(to.address, control, payload))) await this.clearFor(to.address, moduleId);
        try {
            const frame = await to.exchangeWithRetry(control, payload, options);
            this.noteRead(to, moduleId, job, control, payload, { frame });
            return frame;
        } catch (e) {
            this.noteRead(to, moduleId, job, control, payload, { error: e });
            throw e;
        }
    }

    /**
     * A new reading of the car. The motion it implies lapses to `unknown` by itself once the
     * reading is older than VEHICLE_STATE_MAX_AGE_MS — a "parked" that nobody refreshed must not
     * keep saying so.
     */
    private noteVehicle(values: LiveValues): VehicleState | null {
        const next = vehicleStateFrom(values, appNow(), this.vehicleNow);
        if (!next) return null;
        this.vehicleNow = next;
        this.update({ vehicleState: next, motion: motionOf(next, next.at) });
        if (this.motionTimer) clearTimeout(this.motionTimer);
        this.motionTimer = setTimeout(() => this.update({ motion: 'unknown' }), VEHICLE_STATE_MAX_AGE_MS + 1);
        return next;
    }

    /** Let go of the timer the session keeps (the motion lapse). The link itself is left as it is. */
    readonly dispose = (): void => {
        if (this.motionTimer) clearTimeout(this.motionTimer);
        this.motionTimer = null;
    };

    /**
     * Read the car's speed from the DME, now, and say whether it is standing still.
     *
     * The preflight PLAN §4-4 asked for: what the gate decided at render time is checked against a
     * measurement taken immediately before the bytes go. Anything short of a decoded zero —
     * no DME, a refusal, a short block, a speed above zero — is not `parked`.
     */
    private async measureMotion(link: Ds2Link): Promise<Motion> {
        const block = blockBySelection(SPEED_BLOCK);
        if (!block) return 'unknown';
        const req = liveBlockRequest(SPEED_BLOCK);
        try {
            this.append('tx', `Speed preflight (DME block ${SPEED_BLOCK})`);
            const frame = await this.readFrame(link.to(DME), 'mss54', `LIVE_${SPEED_BLOCK}`, req.control, req.payload, { attempts: 2 });
            link.assertPositive(frame, `Speed (DME block ${SPEED_BLOCK})`);
            const values: LiveValues = {};
            for (const v of decodeLiveBlock(block, frame)) values[channelId(SPEED_BLOCK, v.symbol)] = v.value;
            const state = this.noteVehicle(values);
            const motion = motionOf(state, appNow());
            // The evidence the read below was sent on, kept with it.
            this.append('rx', `speed ${state?.speedKmh ?? '—'} km/h, CAN ${state?.speedCanKmh ?? '—'} km/h → ${motion}`);
            return motion;
        } catch (e) {
            this.append('warn', `speed preflight failed: ${e instanceof Error ? e.message : String(e)}`);
            return 'unknown';
        }
    }

    /**
     * The car, measured now, before a read that may go only parked: every read the app sends — the
     * screen's DIAGNOSIS READ, a SERVICE read, an assistant's refresh — waits on the DME saying
     * 0 km/h in the same call. The verdict that let a control light was computed earlier and is not
     * evidence about this moment. Returns the motion measured, or null when none was needed.
     */
    private async preflight(link: Ds2Link, what: string, requires: SendRequirement): Promise<Motion | null> {
        if (requires !== 'parked') return null;
        const measured = await this.measureMotion(link);
        if (measured !== 'parked') {
            throw new Error(
                `${what}: not sent — the car could not be shown to be stationary (${measured}). ` +
                    'Just before sending, the DME speed (block 19) is read; only 0 km/h lets a read go.',
            );
        }
        return measured;
    }

    /**
     * One KWP-on-DS2 read (kwpOnDs2; DSC MK60). Parked only, measured now: whether the MK60 minds
     * being asked while it works is not known yet (operator, 2026-11-10: the first reads parked, moving
     * once it has answered). Under the link's gate, so one frame is in flight; recorded like a read.
     */
    private async kwpRead(link: Ds2Link, moduleId: string, job: string, frame: KwpFrame) {
        await this.preflight(link, `${moduleId} ${job}`, 'parked');
        const transport = this.transport ?? refuse('No open transport.');
        this.append('tx', `${job} ${frame.hex} (${frame.source})`);
        const record = (response: string | null, outcome: 'ok' | 'rejected' | 'failed', reason: string | null) => {
            const onRead = this.handlers.onRead;
            if (this.modeNow !== 'vehicle' || !onRead) return;
            try {
                const state = this.vehicleNow;
                onRead({ at: appNow(), module: moduleId, job, request: frame.hex, response, outcome, reason, speedKmh: state?.speedKmh ?? null, motion: motionOf(state, appNow()) });
            } catch {
                /* the record is lost, the read is not */
            }
        };
        try {
            // One more try on silence, after a longer quiet: the answer to the first may be what
            // the line lacked (2026-11-10). A refusal or a wrong answer is an answer, not tried again.
            const answer = await link.withGate(() => kwpExchange(transport, frame)).catch(async (e) => {
                if (!(isDs2Error(e) && e.code === 'READ_TIMEOUT')) throw e;
                this.append('warn', `${job}: no answer; once more after 500 ms of quiet`);
                await new Promise((r) => setTimeout(r, 500));
                return link.withGate(() => kwpExchange(transport, frame));
            });
            this.append('rx', toHex(answer.bytes));
            record(toHex(answer.bytes), 'ok', null);
            return answer;
        } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            record(null, isDs2Error(e) && e.code === 'NEGATIVE_RESPONSE' ? 'rejected' : 'failed', message.slice(0, 300));
            throw e;
        }
    }

    /**
     * Tell the shell an operation failed, for the preview's error records. Wrapped so that nothing
     * the receiver does can turn into a second failure of the operation being reported: this runs
     * on the error path of a link talking to a car.
     */
    private notifyFailure(job: string, e: unknown, mode: LinkMode = this.modeNow, transport = this.transportKindNow): void {
        try {
            this.handlers.onFailure?.({
                job,
                error: e instanceof Error ? e.message : String(e),
                errorKind: isDs2Error(e) ? e.kind : 'unclassified',
                mode,
                transport,
                ident: this.identNow,
                log: this.logLines,
            });
        } catch {
            /* a report about a failure must never become one */
        }
    }

    /**
     * `permittedOnly`: open only a device this browser has already been allowed — never the
     * chooser. The assistant's reconnect (operator, 2026-10-28) goes this way: a voice cannot
     * pick a device, and must not be the one to allow a new one.
     *
     * `target`: the module to open for, when it was chosen in the same breath — the assistant's
     * module switch (operator, 2026-11-01) — and the page has not rendered it yet.
     */
    readonly connect = async (nextMode: LinkMode, permittedOnly = false, target?: ModuleProtocol): Promise<void> => {
        if (target) this.target = target;
        // What was read belongs to the module it was read from. Another module's link must not
        // show the previous one's faults as its own (a DSC switch showed the DME's 0x2C).
        if (this.readsOf !== null && this.readsOf !== this.target.moduleId) {
            this.update({ ident: null, faults: null, quickTest: null, rawFaults: null, adaptations: null, lastRun: null });
        }
        this.readsOf = this.target.moduleId;
        this.clearError();
        this.update({ state: 'connecting' });
        try {
            // PRACTICE deliberately does not go through createDs2Transport: it wraps the
            // simulated port in a REAL WebSerialTransport, so the simulator drives the actual
            // transport class rather than a mock of it.
            const address = this.target.address;
            const selected =
                nextMode === 'practice'
                    ? {
                          kind: 'web-serial' as const,
                          transport: new WebSerialTransport({
                              // The practice car: the DME, the module asked for, and every module such a
                              // car carries (practiceCar), so a scan finds what a car would.
                              requestPort: async () => new PracticePort([address, ...practiceCar.fitted]),
                          }),
                      }
                    : permittedOnly
                      ? permittedTransport()
                      : createDs2Transport();
            // The link's own address is the DME's only because it has to be something; every
            // operation below names the module it sends to (`session`).
            const link = new Ds2Link(selected.transport, { address: Ds2Address.DME });
            // Which module is where is asked again on every link, and nothing but a common IDENT
            // goes anywhere until it has been (variants): the guard is on before the port opens.
            this.identity = await (this.identityLoad ??= loadIdentity());
            this.fitmentNow = new Map();
            this.update({ fitment: this.fitmentNow });
            link.setSendGuard((frame) => frameVerdict(frame, this.fitmentNow, this.identity.rules, this.identity.identOk));
            await link.connect();
            this.link = link;
            this.sessionAddress = address;
            this.transport = selected.transport;
            this.transportKindNow = selected.kind;
            this.modeNow = nextMode;
            this.update({ mode: nextMode, state: 'connected' });
            this.append(
                'info',
                nextMode === 'practice'
                    ? `PRACTICE mode — no vehicle attached. Values are synthetic. Module ${this.target.moduleId} at ${hex2(address)}.`
                    : `Connected over ${TRANSPORT_LABEL[selected.kind]} at 9600 8E1. Module ${this.target.moduleId} at ${hex2(address)}.`,
            );
        } catch (e) {
            this.link = null;
            this.transport = null;
            this.sessionAddress = null;
            this.update({ state: 'disconnected' });
            // Closing the picker is not a failure. Turning "changed their mind" into a red
            // error line is how people learn to ignore the red line that means something.
            if (isUserCancel(e)) {
                this.append('info', 'Connection cancelled — no device selected.');
                return;
            }
            this.failWith(e);
            // The transport that was tried, re-detected: `selected` is out of scope here, and a
            // connect can fail before one was chosen. Recorded because a failed connect is the
            // failure that leaves nothing else behind.
            this.notifyFailure('Connect', e, nextMode, nextMode === 'practice' ? 'web-serial' : detectTransportKind());
        }
    };

    /**
     * Connect again, to the car, through a cable this browser has already been allowed. Null when the
     * link is open; otherwise why not, in a sentence. The chooser is never shown: no allowed cable is
     * a refusal, and the first connection stays a person's, on the screen.
     */
    readonly reconnectPermitted = async (target?: ModuleProtocol): Promise<string | null> => {
        if (this.link) return 'The link is already open.';
        if (!(await hasPermittedCable())) {
            return 'No cable has been allowed on this device yet. The first connection is made on the screen (CONNECT); after that it can be made again by voice.';
        }
        await this.connect('vehicle', true, target);
        return this.link ? null : 'The allowed cable did not open. Check that it is plugged in, then try again or connect on the screen.';
    };

    readonly disconnect = async (): Promise<void> => {
        this.polling = false;
        const link = this.link;
        this.link = null;
        this.transport = null;
        this.transportKindNow = null;
        this.sessionAddress = null;
        // Back to the strict default. A field left reading 'practice' after the
        // link is gone would greet the next connection with the wrong answer if
        // anything ever read it before connect() writes it.
        this.modeNow = 'vehicle';
        this.update({ state: 'disconnected' });
        if (link) {
            try {
                await link.disconnect();
                this.append('info', 'Disconnected.');
            } catch (e) {
                this.failWith(e);
            }
        }
    };

    /** Wraps an operation in the busy state and the shared error handling. */
    private async run<T>(what: string, fn: (link: Ds2Link) => Promise<T>): Promise<T | null> {
        const link = this.link;
        if (!link) return null;
        this.clearError();
        this.update({ state: 'busy' });
        this.busy = true;
        try {
            const result = await fn(link);
            this.update({ state: 'connected' });
            return result;
        } catch (e) {
            this.update({ state: 'connected' });
            this.append('warn', `${what} failed`);
            this.failWith(e);
            this.notifyFailure(what, e);
            return null;
        } finally {
            this.busy = false;
        }
    }

    // The identity and the fault memory are read while the car moves too (operator, 2026-11-04;
    // runGate `fault-read`). A caller that holds a ledger verdict passes its `requires`.
    readonly readIdent = (requires: SendRequirement = 'none') =>
        this.run('Read identity', async (link) => {
            const { target, to } = this.session(link);
            if (target.kwp) {
                const f = target.kwp.ident ?? refuse(`${target.moduleId}: its SGBD carries no identity frame; nothing is sent.`);
                const answer = await this.kwpRead(link, target.moduleId, 'IDENT', f);
                const value = { hex: toHex(answer.data), length: answer.data.length };
                this.identNow = value;
                this.update({ ident: value });
                return value;
            }
            const ident = target.ident ?? refuse(`${target.moduleId}: its SGBD carries no short IDENT frame; nothing is sent.`);
            await this.preflight(link, 'Identity read', requires);
            this.append('tx', `IDENT ${ident.hex} (${ident.source})`);
            const frame = await this.readFrame(to, target.moduleId, 'IDENT', ident.control, ident.payload);
            link.assertPositive(frame, 'Identity read');
            this.append('rx', toHex(frame.payload));
            // The screen's IDENT is the common one (moduleProtocol takes no other): what it says
            // about which module this is counts as much as the scan's.
            if (isCommonIdent(buildDs2Frame(to.address, ident.control, ident.payload))) {
                const answer = Uint8Array.from([frame.address, frame.length, frame.controlOrStatus, ...frame.payload, frame.checksum]);
                const f = fittedFrom(this.identity.rules, this.identity.modules, to.address, answer);
                this.fitmentNow = new Map(this.fitmentNow).set(to.address, f);
                this.update({ fitment: this.fitmentNow });
            }
            const value = { hex: toHex(frame.payload), length: frame.payload.length };
            this.identNow = value;
            this.update({ ident: value });
            return value;
        });

    readonly readFaults = (requires: SendRequirement = 'none') =>
        this.run('Read fault memory', async (link) => {
            const { target, to } = this.session(link);
            if (target.kwp) {
                if (target.kwp.faults.length === 0) refuse(`${target.moduleId}: its SGBD carries no fault-read frame; nothing is sent.`);
                const out: RawFaultRead[] = [];
                for (const f of target.kwp.faults) {
                    const answer = await this.kwpRead(link, target.moduleId, 'FS_LESEN', f);
                    const dtcs = parseDtcsByStatus(answer.data);
                    this.append('rx', dtcs ? `${dtcs.length} code(s), read as ISO 14230 lays a $58 answer out — not yet confirmed on a MK60` : `${answer.data.length} bytes — not the $58 shape`);
                    out.push({ request: f.hex, response: toHex(answer.data), source: f.source, ...(dtcs ? { kwpDtcs: dtcs } : {}) });
                }
                this.update({ faults: null, quickTest: null, rawFaults: out });
                return out;
            }
            if (target.decoder !== 'mss54' && target.faults.length === 0) {
                refuse(`${target.moduleId}: its SGBD carries no short fault-read frame; nothing is sent.`);
            }
            await this.preflight(link, 'Fault read', requires);
            if (target.decoder !== 'mss54') {
                // No decoder: send the module's own FS_LESEN frames and keep what came back.
                const out: RawFaultRead[] = [];
                for (const f of target.faults) {
                    this.append('tx', `FS ${f.hex} (${f.source})`);
                    const frame = await this.readFrame(to, target.moduleId, 'FS_LESEN', f.control, f.payload);
                    link.assertPositive(frame, `Fault read ${f.hex}`);
                    this.append('rx', `${frame.payload.length} bytes — no decoder for this module`);
                    out.push({ request: f.hex, response: toHex(frame.payload), source: f.source });
                }
                this.update({ faults: null, quickTest: null, rawFaults: out });
                return out;
            }
            this.append('tx', 'FS quicktest (control 0x04, arg 0x00)');
            const q = await this.readFrame(to, target.moduleId, 'FS_QUICKTEST', ERROR_MEMORY_QUICKTEST.control, ERROR_MEMORY_QUICKTEST.payload);
            link.assertPositive(q, 'Fault quicktest');
            const parsedQuick = parseQuickTest(q, 'errorMemory');
            this.update({ quickTest: parsedQuick });
            this.append('rx', `quicktest status 0x${parsedQuick.status.toString(16)}`);

            this.append('tx', 'FS entries (control 0x04, arg 0x01)');
            const e = await this.readFrame(to, target.moduleId, 'FS_LESEN', ERROR_MEMORY_ENTRIES.control, ERROR_MEMORY_ENTRIES.payload);
            link.assertPositive(e, 'Fault entries');
            const entries = parseErrorMemoryEntries(e, 'errorMemory');
            this.append('rx', `${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}`);
            this.update({ rawFaults: null, faults: entries });
            return entries;
        });

    /**
     * The learned values: lambda trim, throttle and pedal zeroes, crank-wheel
     * segment deviation and knock adaptation per cylinder, lifetime misfire
     * counters, highest RPM and speed ever seen.
     *
     * Same control byte as a live block (0x0B) and the same decoder — the only
     * difference is which selections and which field table, which is exactly why
     * this is one loop and not a second protocol.
     *
     * Two honesty properties this deliberately keeps:
     *
     *   - a block whose payload is SHORTER than its field table needs is
     *     recorded as `short`, and its out-of-range fields decode to null rather
     *     than to a plausible number from adjacent bytes. Block 6 declares
     *     `ExpectedLength = 83` while its own fields reach offset 92, so this is
     *     not hypothetical.
     *   - one failing block does not abandon the rest. Reading four of five and
     *     saying which one failed beats reading none, and the per-block error is
     *     kept beside the block instead of being flattened into the link error.
     */
    readonly readAdaptations = () =>
        this.run('Read adaptations', async (link) => {
            const { target, to } = this.session(link);
            if (target.decoder !== 'mss54') refuse(`${target.moduleId}: no adaptation-block decoder; nothing is sent.`);
            const out: AdaptationRead[] = [];
            for (const block of MSS54_ADAPTATION_BLOCKS) {
                const req = liveBlockRequest(block.selection);
                this.append('tx', `Adaptation block ${block.selection} (control 0x${req.control.toString(16)})`);
                try {
                    const frame = await this.readFrame(to, target.moduleId, `ADAPT_${block.selection}`, req.control, req.payload);
                    link.assertPositive(frame, `Adaptation block ${block.selection}`);
                    const need = adaptationBlockMinLength(block);
                    const short = frame.payload.length < need;
                    if (short) this.append('warn', `block ${block.selection}: ${frame.payload.length} bytes, needs ${need}`);
                    else this.append('rx', `${frame.payload.length} bytes`);
                    out.push({
                        selection: block.selection,
                        name: block.name,
                        values: decodeAdaptationBlock(block, frame.payload),
                        payloadLength: frame.payload.length,
                        requiredLength: need,
                        short,
                        error: null,
                    });
                } catch (e) {
                    const message = e instanceof Error ? e.message : String(e);
                    this.append('warn', `block ${block.selection} failed: ${message}`);
                    out.push({
                        selection: block.selection,
                        name: block.name,
                        values: [],
                        payloadLength: 0,
                        requiredLength: adaptationBlockMinLength(block),
                        short: false,
                        error: message,
                    });
                }
            }
            this.update({ adaptations: out });
            return out;
        });

    /**
     * Sends one gated read and keeps what came back.
     *
     * Takes the FRAME, not a job id. The caller has already been through
     * `mayRun`, which is where the decision lives; this function's job is to put
     * those exact bytes on the wire and report what returned. It re-parses and
     * re-checks the frame anyway — a function that transmits should not take
     * "somebody upstream checked" on trust.
     */
    readonly runRead = (jobId: string, hex: string, requires: SendRequirement = 'parked') =>
        this.run(`Run ${jobId}`, async (link) => {
            const { target, to } = this.session(link);
            // A KWP-on-DS2 module is sent its identity and its fault read, and nothing else: the
            // catalogue path builds DS2 frames, which this module would read as something else.
            if (target.kwp) refuse(`${jobId}: ${target.moduleId} speaks KWP2000-shaped frames; only its identity and fault read are built for it.`);
            const bytes = telegramBytes(hex);
            if (!bytes) {
                // A plain Error on purpose: this is the APP refusing, not
                // the link failing, and the electrical-fault dialog must not
                // claim a wiring problem for a bug in our own data.
                throw new Error(`${jobId}: telegram is not a well-formed frame: ${hex}`);
            }
            // The frame names its module in its first byte, and it goes to that module or nowhere.
            // The link used to strip the byte and send the rest to the DME.
            if (bytes[0] !== target.address) {
                throw new Error(
                    `${jobId}: the telegram is addressed to ${hex2(bytes[0])}, the link is talking to ${target.moduleId} at ${hex2(target.address)}`,
                );
            }
            const control = bytes[2];
            // Belt and braces. If this fires on a vehicle, the gate above it
            // has a hole and the car is one line away from being written to.
            //
            // PRACTICE is the one thing that widens it, and it widens ONLY
            // here — `mayActuate` still hands a vehicle whatever `mayRun`
            // said, unchanged. The simulated ECU is where the actuator send
            // path gets to execute before an M3 is the first thing it
            // executes against.
            const refusal = whyNotSendable(control, this.modeNow);
            if (refusal) throw new Error(`${jobId}: ${refusal}`);
            const payload = bytes.slice(3, bytes.length - 1);
            // A read the owner has not cleared for a moving car goes only when the DME says
            // 0 km/h in this same call.
            const measured = await this.preflight(link, jobId, requires);
            this.append('tx', `${jobId}: ${hex}`);
            const frame = await this.readFrame(to, target.moduleId, jobId, control, payload);
            link.assertPositive(frame, jobId);
            const result: JobRunResult = {
                jobId,
                request: hex,
                response: toHex(frame.payload),
                payloadLength: frame.payload.length,
                at: appNow(),
                error: null,
            };
            this.append('rx', `${frame.payload.length} bytes`);
            this.update({ lastRun: result });
            if (measured === 'parked' && this.modeNow === 'vehicle') {
                try {
                    this.handlers.onObserved?.({
                        moduleId: target.moduleId,
                        jobId,
                        telegram: hex,
                        response: result.response,
                        at: new Date(result.at).toISOString(),
                        ecuIdent: this.identNow?.hex,
                    });
                } catch {
                    /* recording a fact must never fail the read it is about */
                }
            }
            return result;
        });

    /**
     * Clears fault memory. The one mutating command this app sends.
     *
     * The frame is BUILT from the protocol (`clearFaultsCommand`), not replayed
     * from the telegram scrape — see runGate.ts for why, and for the check that
     * both derivations agree on all three modules.
     *
     * Callers must confirm first. This function does not ask: a transmit
     * function that also owns the confirmation is a transmit function that can
     * be called without one.
     */
    readonly clearFaults = () =>
        this.run('Clear fault memory', async (link) => {
            const { target, to } = this.session(link);
            // Built from the protocol, and sent only where the module's own FS_LOESCHEN sends the
            // same bytes — the two derivations have to agree before this goes anywhere.
            const { control, payload } = clearFaultsCommand();
            if (!target.clear || target.clear.control !== control || target.clear.payload.length !== payload.length) {
                refuse(`${target.moduleId}: its SGBD does not clear fault memory with this frame; nothing is sent.`);
            }
            // Parked, measured now (CLAUDE.md: the clear is a person's, on the screen, stopped). Since
            // fault reads go while moving (2026-11-04) the button can show on the road, so the speed
            // is read right before, as for every parked-only read: only 0 km/h lets it go.
            await this.preflight(link, 'Clear fault memory', 'parked');
            this.append('tx', `Clear fault memory ${target.clear.hex} (${target.clear.source})`);
            // Recorded like a read (operator, 2026-11-09): the frame sent and what came back, so
            // the owner's record shows the clear and the read after it side by side.
            const frame = await this.readFrame(to, target.moduleId, 'FS_LOESCHEN', control, payload);
            link.assertPositive(frame, 'Clear fault memory');
            this.append('info', 'fault memory cleared — freeze frames are gone with it');
            // The displayed faults are now a claim about a memory that no
            // longer holds them. Drop them and make the operator re-read.
            this.update({ faults: null, quickTest: null, rawFaults: null });
            return { moduleId: target.moduleId, telegram: toHex(buildDs2Frame(to.address, control, payload)), response: toHex(frame.payload), ecuIdent: this.identNow?.hex };
        });

    /**
     * Telemetry.
     *
     * No interval. Requests are awaited back to back, so the sample rate IS the
     * round-trip time — and one sample costs one exchange PER BLOCK, which is
     * why the caller is shown the block count rather than being asked for a
     * cadence it cannot honour.
     */
    readonly startLog = (channels: readonly ChannelId[], onSample: (s: LiveSample) => void, onEnd: (failure: string | null) => void): void => {
        const link = this.link;
        if (!link || this.polling) return;
        let to: Ds2Target;
        try {
            const s = this.session(link);
            if (s.target.decoder !== 'mss54') refuse(`${s.target.moduleId}: no live-block layout; nothing is recorded.`);
            to = s.to;
        } catch (e) {
            this.failWith(e);
            return;
        }
        const { blocks } = planBlockReads(channels);
        if (blocks.length === 0) return;
        const wanted = new Set<ChannelId>(channels);

        this.polling = true;
        this.finished = false;
        this.update({ state: 'logging' });
        const t0 = performance.now();
        this.append('info', `Recording ${channels.length} channel(s) across ${blocks.length} block(s).`);

        // Arm the low latency timer for the duration of the run.
        //
        // The 16 ms default was ruled out as a throughput lever by a sweep on the BULK READ,
        // and that conclusion does not carry here: a bulk read moves 122-byte chunks where the
        // packetisation tail is a small share of a long response, while a datalog exchange is
        // 13 to 94 bytes and there are two or three of them per sample, so the tail dominates
        // and is paid several times a second. The price is real — 4 ms is 250 idle wakeups a
        // second against 62.5, each one a transferIn resolving on this thread — which is why it
        // is armed for a run rather than made the default.
        //
        // Null on Web Serial: no equivalent knob exists there, so a run gets whatever the
        // driver does. That is worth knowing when comparing sample rates across backends.
        const latency = this.transport ? latencyTimerOf(this.transport) : null;
        void latency?.('log');

        void (async () => {
            let failure: string | null = null;
            try {
                // The blocks are the MSS54's: only to a DME that has said it is one.
                await this.clearFor(to.address, this.target.moduleId);
                while (this.polling && this.link) {
                    const values: Partial<Record<ChannelId, number | null>> = {};
                    let incomplete = false;
                    for (const block of blocks) {
                        const req = liveBlockRequest(block.selection);
                        // The heartbeat can hold the gate when a poll comes
                        // round. That is contention, not a link fault, and
                        // it must not end a run — exchangeWithRetry takes
                        // the gate once around its whole retry loop, so the
                        // only losing window is acquisition. Wait a tick and
                        // ask again rather than tearing the run down.
                        let frame: Ds2Frame | null = null;
                        for (let attempt = 0; attempt < 3 && frame === null; attempt++) {
                            try {
                                frame = await to.exchangeWithRetry(req.control, req.payload, {
                                    attempts: 2,
                                });
                            } catch (e) {
                                if (!isDs2Error(e) || e.code !== 'GATE_HELD') throw e;
                                await new Promise((r) => setTimeout(r, 20));
                            }
                        }
                        // Every retry lost the gate. Skip the whole sample
                        // rather than emitting one with holes in it — a
                        // partial row is worse than a missing one, because
                        // it looks like a reading.
                        if (frame === null) { incomplete = true; break; }
                        this.noteRead(to, this.target.moduleId, `LIVE_${block.selection}`, req.control, req.payload, { frame });
                        link.assertPositive(frame, `Live block ${block.selection}`);
                        // Keyed by (selection, symbol). `block.selection` was
                        // already in hand here; the old line threw it away
                        // and used `v.symbol`, which is how one column ended
                        // up holding two blocks' readings.
                        const decoded = decodeLiveBlock(block, frame);
                        for (const v of decoded) {
                            const id = channelId(block.selection, v.symbol);
                            if (wanted.has(id)) values[id] = v.value;
                        }
                        // A recording that reads the speed block keeps the car's state fresh as
                        // a side effect, whether or not the speed is among the logged channels.
                        if (block.selection === 3 || block.selection === SPEED_BLOCK) {
                            const all: LiveValues = {};
                            for (const v of decoded) all[channelId(block.selection, v.symbol)] = v.value;
                            if (block.selection === SPEED_BLOCK) this.noteVehicle(all);
                            else if (this.vehicleNow) {
                                this.vehicleNow = { ...this.vehicleNow, rpm: all['3:n'] ?? null, voltageV: all['3:ub'] ?? null };
                            }
                        }
                    }
                    if (!incomplete) onSample({ time: (performance.now() - t0) / 1000, values });
                    await yieldToEventLoop();
                }
            } catch (e) {
                failure = e instanceof Error ? e.message : String(e);
                this.failWith(e);
                this.notifyFailure('Datalog', e);
            } finally {
                // Single exit point — a double-fire is impossible, and a
                // failed run cannot quietly return the link to idle.
                this.polling = false;
                this.update({ state: 'connected' });
                // Restored HERE and nowhere else, for the reason the comment above gives: a
                // run that ended by failing must not leave the chip waking four times a
                // second more than it needs to for the rest of the session, and stopLog is
                // not that place — it only asks the loop to stop, and the loop is still
                // finishing a sample when it returns.
                void latency?.('idle');
                if (!this.finished) {
                    this.finished = true;
                    onEnd(failure);
                }
            }
        })();
    };

    readonly stopLog = (): void => {
        this.polling = false;
    };

    /**
     * Every module's fault memory, one address at a time (probe/scan): the assistant's
     * `monitoring_scan`, the start of an AI-mode investigation.
     *
     * One operation, like a READ: the link is busy for its length (about a second an address, most
     * of it waiting on modules that are not fitted). Each frame is a read record; an address with
     * one candidate SGBD that answered on a car measured still is a ledger fact, as on DIAGNOSIS.
     */
    readonly scanAll = (targets: readonly ScanTarget[], ledger: () => Ledger) =>
        this.run('Scan all modules', async (link) => {
            this.append('info', `Scan: ${targets.length} address(es), each module's own fault read.`);
            let done = 0;
            this.update({ scanProgress: { done, total: targets.length } });
            try {
                const result = await runScan(targets, {
                    ledger,
                    identity: {
                        rules: this.identity.rules,
                        identOk: this.identity.identOk,
                        fitment: () => this.fitmentNow,
                        identify: (address) => this.identify(link, address),
                    },
                    // On an M3 the speed read says the DME is there; on another car its IDENT, asked again.
                    dmeAnswers: async () =>
                        isM3(this.fitmentNow) ? (await this.measureMotion(link)) !== 'unknown' : (await this.identify(link, DME_ADDRESS, true).catch(() => null))?.answer != null,
                    // PRACTICE answers only the DME and the module on the screen; the rest are silent there by
                    // design, and the car's two-second wait for each would make a practice scan a minute of nothing.
                    exchange: (address, moduleId, job, f, options) =>
                        this.readFrame(link.to(address), moduleId, job, f.control, f.payload, this.modeNow === 'practice' ? { ...options, timeoutMs: 400 } : options),
                    // The MSS54 alone: its entries are the frame whose argument is 01.
                    decode: (t, frames) => {
                        const i = t.frames.findIndex((f) => f.payload[0] === 0x01);
                        return i >= 0 && frames[i] ? parseErrorMemoryEntries(frames[i], 'errorMemory') : null;
                    },
                    stopped: () => this.link !== link,
                    pause: yieldToEventLoop,
                    now: () => appNow(),
                    onResult: (r) => {
                        this.update({ scanProgress: { done: ++done, total: targets.length } });
                        this.append(r.outcome === 'answered' ? 'rx' : 'info', `${r.address} ${r.modules.join('/')}: ${r.outcome}${r.reason ? ` — ${r.reason}` : ''}`);
                    },
                });
                if (this.modeNow === 'vehicle') {
                    for (const r of result.results) {
                        if (r.outcome !== 'answered' || r.modules.length !== 1) continue;
                        for (const x of r.exchanges) {
                            if (x.response === null) continue;
                            try {
                                this.handlers.onObserved?.({ moduleId: r.modules[0], jobId: 'FS_LESEN', telegram: x.request, response: x.response, at: new Date().toISOString(), ecuIdent: this.identNow?.hex });
                            } catch {
                                /* recording a fact must never fail the scan it is about */
                            }
                        }
                    }
                }
                // The module the link is for was among them: what the scan read of it is its fault
                // read, the same frames DIAGNOSIS sends, so opening it shows them rather than asking again.
                const own = result.results.find(
                    (r) => r.outcome === 'answered' && this.sessionAddress !== null && parseInt(r.address, 16) === this.sessionAddress && r.modules.includes(this.target.moduleId),
                );
                if (own && Array.isArray(own.decoded)) {
                    this.update({ rawFaults: null, quickTest: null, faults: own.decoded as ErrorMemoryEntry[] });
                } else if (own) {
                    this.update({
                        faults: null,
                        quickTest: null,
                        rawFaults: own.exchanges
                            .filter((x) => !isCommonIdent(telegramBytes(x.request) ?? new Uint8Array(0)))
                            .map((x) => ({ request: x.request, response: x.response ?? '', source: 'FS_LESEN (SGBD telegram)' })),
                    });
                }
                this.update({ scan: result });
                this.append('info', `Scan ended (${result.end}).`);
                return result;
            } finally {
                this.update({ scanProgress: null });
            }
        });

    /**
     * Run a PROBE plan on this link until it ends or `stopLog` is called.
     *
     * The same run boundary as a datalog — state `logging`, the low latency timer armed, one exit —
     * because to the link it is one: back-to-back exchanges until told to stop. What differs is in
     * probe/executor, which asks runGate for every frame and records everything it declined.
     * The module in session does not limit it: a plan names its modules, and `link.to` reaches them.
     */
    readonly startProbe = async (
        plan: ProbePlan,
        deps: Pick<ProbeDeps, 'module' | 'ledger' | 'onSample' | 'onExchange' | 'onStep'>,
    ): Promise<ProbeRun | null> => {
        const link = this.link;
        if (!link || this.polling) return null;
        this.polling = true;
        this.finished = false;
        this.update({ state: 'logging' });
        this.append('info', `PROBE plan v${plan.v}: ${plan.steps.length} step(s).`);
        const latency = this.transport ? latencyTimerOf(this.transport) : null;
        void latency?.('log');
        try {
            // The executor sends on `link.to` directly; the link's guard holds back anything to an
            // address not yet identified. So identify first what the plan reaches: the DME (its speed
            // block every cycle) and every address of its modules that has a rule.
            const id = this.identity;
            const addresses = new Set<number>([DME_ADDRESS]);
            for (const m of modulesOf(plan.steps)) {
                const a = deps.module(m)?.protocol.address;
                if (a !== undefined && ruleFor(id.rules, a)) addresses.add(a);
            }
            for (const a of addresses) {
                if (id.identOk.has(a)) await this.identify(link, a).catch((e) => this.append('warn', `IDENT ${hex2(a)}: ${e instanceof Error ? e.message : String(e)}`));
            }
            const run = await runProbe(plan, {
                ...deps,
                // The run reads the speed block every cycle (executor `SPEED_CHANNELS`): the car's
                // state is kept from it, as a recording keeps it, so the status and the read
                // records say how fast the car is while a plan runs (2026-11-09: null all drive).
                onSample: (sample) => {
                    this.noteVehicle(sample.values);
                    deps.onSample?.(sample);
                },
                // Each frame the plan sent is a read record too; a frame the gate held back was
                // never sent, and is not.
                onExchange: (x) => {
                    deps.onExchange?.(x);
                    if (x.outcome === 'refused' || this.modeNow !== 'vehicle') return;
                    try {
                        this.handlers.onRead?.({
                            at: appNow(),
                            module: x.module,
                            job: x.what,
                            request: x.request,
                            response: x.response,
                            outcome: x.outcome,
                            reason: x.reason?.slice(0, 300) ?? null,
                            speedKmh: this.vehicleNow?.speedKmh ?? null,
                            motion: x.motion,
                        });
                    } catch {
                        /* the record is lost, the run is not */
                    }
                },
                link,
                now: () => appNow(),
                pause: yieldToEventLoop,
                stopped: () => !this.polling || this.link !== link,
                onObserved: (o) => {
                    if (this.modeNow !== 'vehicle') return;
                    const [moduleId, jobId] = [o.id.slice(0, o.id.indexOf(':')), o.id.slice(o.id.indexOf(':') + 1)];
                    try {
                        this.handlers.onObserved?.({ moduleId, jobId, telegram: o.telegram, response: o.response, at: new Date(o.at).toISOString(), ecuIdent: this.identNow?.hex });
                    } catch {
                        /* recording a fact must never fail the run it is about */
                    }
                },
            });
            this.append('info', `PROBE ended (${run.end}): ${run.samples.length} sample(s), ${run.exchanges.length} exchange(s) recorded.`);
            if (run.end === 'link-lost') this.notifyFailure('PROBE', new Error('the DME stopped answering'));
            return run;
        } catch (e) {
            this.failWith(e);
            this.notifyFailure('PROBE', e);
            return null;
        } finally {
            this.polling = false;
            this.finished = true;
            this.update({ state: 'connected' });
            void latency?.('idle');
        }
    };

    /** Read the car's speed (DME block 19) now, as an operation of its own. */
    readonly readVehicleState = () => this.run('Read vehicle state', async (link) => this.measureMotion(link));

    /**
     * One beat of the heartbeat, called every KEEP_ALIVE_INTERVAL_MS by whoever keeps the timer (the
     * hook). Runs on every state, because the case it exists for is a human reading values with the
     * bus otherwise silent.
     *
     * To the module in session, and only where there is evidence it takes one: the MSS54
     * (measured) and modules whose own SGBD has DIAGNOSE_AUFRECHT. SMG II and DSC have no
     * such job, and a frame they never send themselves is not ours to send every 2 s.
     * Only on a quiet line. An operation or a run sends its own frames, and the link's gate is
     * free for an instant between two of them: a tester-present that lands there makes the
     * next frame of the run fail as if the line were gone. That is how PROBE runs on
     * 2026-11-09 ended "link-lost" after about three minutes on a link that was still up.
     */
    readonly heartbeat = (): void => {
        if (this.busy || this.polling) return;
        const link = this.link;
        const at = this.sessionAddress;
        const target = this.target;
        if (!link || at === null || target.address !== at || !target.keepAlive) return;
        void link.to(at).keepAlive();
    };

    /**
     * Let the cable go when the page is hidden and the link idle (operator, 2026-10-28). The
     * interface is the device's one claim, and a tab that keeps it while out of sight starves the
     * next one: on the head unit the launcher pauses this app, and TUNER WORKS opened beside it then
     * failed claimInterface on a cable this tab was not using. Only an idle link on the car — never
     * while a read is in flight (`busy`) or a recording or a PROBE run is going (`logging`): those
     * the owner left running. Connecting again is on the screen, as always.
     */
    readonly releaseWhileHidden = (): void => {
        if (this.snap.state !== 'connected' || this.modeNow !== 'vehicle') return;
        this.append('info', 'The screen was hidden while the link was idle: the cable is released for other apps.');
        void this.disconnect();
    };

    readonly clearLog = (): void => {
        this.logLines = [];
        this.update({ log: [] });
    };
}

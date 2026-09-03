'use client';

/**
 * The hook layer: link STATE for the UI, error surfacing, the heartbeat timer.
 *
 * It must not contain protocol logic — that is the link's job. What it owns is
 * the session state machine, and the discipline that the two apps share:
 *
 *   - error and errorKind are set by ONE helper and cleared by ONE helper. A
 *     stale "electrical" beside a fresh timeout is worse than no classification.
 *   - the keep-alive timer lives here; the decision to skip lives in the link.
 *     Gating the interval on UI state would be a second, weaker copy of the
 *     gate's rule.
 *   - both endings of a telemetry run land in the same teardown. A run stops
 *     because the user pressed stop OR because the link failed, and on an
 *     unstable cable the second is the common one.
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useHiddenWitness } from './useHiddenWitness';
import { useScreenWakeLock } from './useScreenWakeLock';
import { useUnloadGuard } from './useUnloadGuard';
import {
    Ds2Address,
    Ds2Link,
    WebSerialTransport,
    createDs2Transport,
    detectTransportKind,
    isDs2Error,
    latencyTimerOf,
    simulatedPort,
    toHex,
    type Ds2ByteTransport,
    type Ds2ErrorKind,
    type Ds2Frame,
    type TransportKind,
} from '@tsunagi/ds2-core';
import {
    ERROR_MEMORY_ENTRIES,
    ERROR_MEMORY_QUICKTEST,
    IDENT_REQUEST,
    MSS54_ADAPTATION_BLOCKS,
    adaptationBlockMinLength,
    decodeAdaptationBlock,
    decodeLiveBlock,
    liveBlockRequest,
    parseErrorMemoryEntries,
    parseQuickTest,
    channelId,
    planBlockReads,
    type ChannelId,
    type DecodedAdaptation,
    type ErrorMemoryEntry,
    type ErrorMemoryQuickTest,
} from '@tsunagi/ds2-mss54';
import { whyNotSendable } from '@/lib/actuationGate';
import { practiceEcu } from '@/lib/practiceEcu';
import { clearFaultsCommand, telegramBytes } from '@/lib/runGate';

const KEEP_ALIVE_INTERVAL_MS = 2000;

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

export type LinkState = 'disconnected' | 'connecting' | 'connected' | 'busy' | 'logging';
export type LinkMode = 'vehicle' | 'practice';

export interface CommsLogLine {
    t: number;
    kind: 'tx' | 'rx' | 'info' | 'warn' | 'error';
    text: string;
}

/**
 * What one gated read returned.
 *
 * The bytes are kept verbatim. For most jobs that is ALL we can honestly show:
 * the SGBD names a job's results but gives no byte offsets for them, so mapping
 * this payload onto those names would be inventing a layout. Where a real
 * decoder exists — live blocks, adaptation blocks, fault memory, ident — the
 * app uses that decoder instead of coming through here.
 */
export interface JobRunResult {
    jobId: string;
    /** The frame we sent, as sent. */
    request: string;
    /** The payload that came back, as received. */
    response: string;
    payloadLength: number;
    at: number;
    error: string | null;
}

export interface LiveSample {
    /** Monotonic seconds since the run began. */
    time: number;
    /**
     * Keyed by `ChannelId` — `selection:symbol` — never by symbol alone.
     *
     * 10 of the 213 quantities appear in two blocks. A symbol-keyed row records
     * whichever block was read last under a name that cannot say which, so a run
     * covering blocks 3 and 35 wrote one column called `n` holding a mixture.
     * The saved CSV was wrong, not just vaguely labelled.
     */
    values: Partial<Record<ChannelId, number | null>>;
}

/**
 * One adaptation block, read or not read.
 *
 * `error` and `short` are separate states because they are separate facts: the
 * ECU refusing to answer and the ECU answering with fewer bytes than the field
 * table needs are different problems with different fixes, and collapsing them
 * into "no data" would hide which one happened.
 */
export interface AdaptationRead {
    selection: number;
    name: string;
    values: DecodedAdaptation[];
    payloadLength: number;
    requiredLength: number;
    short: boolean;
    error: string | null;
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
 * Which backend can reach a car here, read in a way that survives a static export.
 *
 * The detection is 'none' during prerender (there is no navigator) and a real backend in a
 * supporting browser, so reading it directly during render produced a hydration mismatch — and
 * React then abandoned that subtree's attributes, which left the connect buttons inert.
 * useSyncExternalStore with an explicit server snapshot makes the first client render agree with
 * the HTML and the second render tell the truth.
 *
 * This answers a different question from the one `connect()` asks. This one is "can anything
 * reach a car", for enabling a control; connect() re-detects at the moment of the tap, so a phone
 * that gains an OTG adapter in between does not need a reload.
 */
const noopSubscribe = () => () => {};
function useTransportKind(): TransportKind {
    return useSyncExternalStore(
        noopSubscribe,
        () => detectTransportKind(),
        () => 'none' as const,
    );
}

export function useDs2Link() {
    const [state, setState] = useState<LinkState>('disconnected');
    const [mode, setMode] = useState<LinkMode>('vehicle');
    /**
     * The same value, read at send time rather than at render time.
     *
     * The byte-level refusal in `runRead` is the last thing between a control
     * byte and the car, and a `mode` captured in a closure can be stale in the
     * one direction that matters: a callback created while PRACTICE was on,
     * still held after a reconnect to a vehicle, would wave through 0x0c. A ref
     * is read when the bytes go, so it cannot be older than the link.
     *
     * Written in exactly one place, next to `setMode`, so the two cannot drift.
     */
    const modeRef = useRef<LinkMode>('vehicle');
    const [error, setError] = useState<string | null>(null);
    const [errorKind, setErrorKind] = useState<Ds2ErrorKind | null>(null);
    const [log, setLog] = useState<CommsLogLine[]>([]);
    const [ident, setIdent] = useState<{ hex: string; length: number } | null>(null);
    const [faults, setFaults] = useState<ErrorMemoryEntry[] | null>(null);
    const [quickTest, setQuickTest] = useState<ErrorMemoryQuickTest | null>(null);
    const [adaptations, setAdaptations] = useState<AdaptationRead[] | null>(null);
    const [lastRun, setLastRun] = useState<JobRunResult | null>(null);

    const transportKind = useTransportKind();

    const linkRef = useRef<Ds2Link | null>(null);
    /** Held alongside the link because the latency timer is a BACKEND capability, not a link one,
     *  and the run boundary that operates it lives here. */
    const transportRef = useRef<Ds2ByteTransport | null>(null);
    const logRef = useRef<CommsLogLine[]>([]);
    const pollingRef = useRef(false);
    const finishedRef = useRef(true);

    const append = useCallback((kind: CommsLogLine['kind'], text: string) => {
        const line = { t: Date.now(), kind, text };
        const next = logRef.current.concat(line);
        if (next.length > LOG_CAPACITY) next.splice(0, next.length - LOG_CAPACITY);
        logRef.current = next;
        setLog(next);
    }, []);

    /** One helper sets both. */
    const failWith = useCallback(
        (e: unknown) => {
            const message = e instanceof Error ? e.message : String(e);
            setError(message);
            setErrorKind(isDs2Error(e) ? e.kind : 'unclassified');
            append('error', message);
        },
        [append],
    );

    /** One helper clears both. */
    const clearError = useCallback(() => {
        setError(null);
        setErrorKind(null);
    }, []);

    const connect = useCallback(
        async (nextMode: LinkMode) => {
            clearError();
            setState('connecting');
            try {
                // PRACTICE deliberately does not go through createDs2Transport: it wraps the
                // simulated port in a REAL WebSerialTransport, so the simulator drives the actual
                // transport class rather than a mock of it.
                const selected =
                    nextMode === 'practice'
                        ? {
                              kind: 'web-serial' as const,
                              transport: new WebSerialTransport({
                                  requestPort: simulatedPort(practiceEcu()).requestPort,
                              }),
                          }
                        : createDs2Transport();
                const link = new Ds2Link(selected.transport, { address: Ds2Address.DME });
                await link.connect();
                linkRef.current = link;
                transportRef.current = selected.transport;
                modeRef.current = nextMode;
                setMode(nextMode);
                setState('connected');
                append(
                    'info',
                    nextMode === 'practice'
                        ? 'PRACTICE mode — no vehicle attached. Values are synthetic.'
                        : `Connected over ${TRANSPORT_LABEL[selected.kind]} at 9600 8E1.`,
                );
            } catch (e) {
                linkRef.current = null;
                transportRef.current = null;
                setState('disconnected');
                // Closing the picker is not a failure. Turning "changed their mind" into a red
                // error line is how people learn to ignore the red line that means something.
                if (isUserCancel(e)) {
                    append('info', 'Connection cancelled — no device selected.');
                    return;
                }
                failWith(e);
            }
        },
        [append, clearError, failWith],
    );

    const disconnect = useCallback(async () => {
        pollingRef.current = false;
        const link = linkRef.current;
        linkRef.current = null;
        transportRef.current = null;
        // Back to the strict default. A ref left reading 'practice' after the
        // link is gone would greet the next connection with the wrong answer if
        // anything ever read it before connect() writes it.
        modeRef.current = 'vehicle';
        setState('disconnected');
        if (link) {
            try {
                await link.disconnect();
                append('info', 'Disconnected.');
            } catch (e) {
                failWith(e);
            }
        }
    }, [append, failWith]);

    /** Wraps an operation in the busy state and the shared error handling. */
    const run = useCallback(
        async <T,>(what: string, fn: (link: Ds2Link) => Promise<T>): Promise<T | null> => {
            const link = linkRef.current;
            if (!link) return null;
            clearError();
            setState('busy');
            try {
                const result = await fn(link);
                setState('connected');
                return result;
            } catch (e) {
                setState('connected');
                append('warn', `${what} failed`);
                failWith(e);
                return null;
            }
        },
        [append, clearError, failWith],
    );

    const readIdent = useCallback(
        () =>
            run('Read identity', async (link) => {
                append('tx', `IDENT (control 0x${IDENT_REQUEST.control.toString(16)})`);
                const frame = await link.exchangeWithRetry(IDENT_REQUEST.control, IDENT_REQUEST.payload);
                link.assertPositive(frame, 'Identity read');
                append('rx', toHex(frame.payload));
                const value = { hex: toHex(frame.payload), length: frame.payload.length };
                setIdent(value);
                return value;
            }),
        [append, run],
    );

    const readFaults = useCallback(
        () =>
            run('Read fault memory', async (link) => {
                append('tx', 'FS quicktest (control 0x04, arg 0x00)');
                const q = await link.exchangeWithRetry(
                    ERROR_MEMORY_QUICKTEST.control,
                    ERROR_MEMORY_QUICKTEST.payload,
                );
                link.assertPositive(q, 'Fault quicktest');
                const parsedQuick = parseQuickTest(q, 'errorMemory');
                setQuickTest(parsedQuick);
                append('rx', `quicktest status 0x${parsedQuick.status.toString(16)}`);

                append('tx', 'FS entries (control 0x04, arg 0x01)');
                const e = await link.exchangeWithRetry(
                    ERROR_MEMORY_ENTRIES.control,
                    ERROR_MEMORY_ENTRIES.payload,
                );
                link.assertPositive(e, 'Fault entries');
                const entries = parseErrorMemoryEntries(e, 'errorMemory');
                append('rx', `${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}`);
                setFaults(entries);
                return entries;
            }),
        [append, run],
    );

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
    const readAdaptations = useCallback(
        () =>
            run('Read adaptations', async (link) => {
                const out: AdaptationRead[] = [];
                for (const block of MSS54_ADAPTATION_BLOCKS) {
                    const req = liveBlockRequest(block.selection);
                    append('tx', `Adaptation block ${block.selection} (control 0x${req.control.toString(16)})`);
                    try {
                        const frame = await link.exchangeWithRetry(req.control, req.payload);
                        link.assertPositive(frame, `Adaptation block ${block.selection}`);
                        const need = adaptationBlockMinLength(block);
                        const short = frame.payload.length < need;
                        if (short) append('warn', `block ${block.selection}: ${frame.payload.length} bytes, needs ${need}`);
                        else append('rx', `${frame.payload.length} bytes`);
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
                        append('warn', `block ${block.selection} failed: ${message}`);
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
                setAdaptations(out);
                return out;
            }),
        [append, run],
    );

    /**
     * Telemetry.
     *
     * No interval. Requests are awaited back to back, so the sample rate IS the
     * round-trip time — and one sample costs one exchange PER BLOCK, which is
     * why the caller is shown the block count rather than being asked for a
     * cadence it cannot honour.
     */
    /**
     * Sends one gated read and keeps what came back.
     *
     * Takes the FRAME, not a job id. The caller has already been through
     * `mayRun`, which is where the decision lives; this function's job is to put
     * those exact bytes on the wire and report what returned. It re-parses and
     * re-checks the frame anyway — a function that transmits should not take
     * "somebody upstream checked" on trust.
     */
    const runRead = useCallback(
        (jobId: string, hex: string) =>
            run(`Run ${jobId}`, async (link) => {
                const bytes = telegramBytes(hex);
                if (!bytes) {
                    // A plain Error on purpose: this is the APP refusing, not
                    // the link failing, and the electrical-fault dialog must not
                    // claim a wiring problem for a bug in our own data.
                    throw new Error(`${jobId}: telegram is not a well-formed frame: ${hex}`);
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
                const refusal = whyNotSendable(control, modeRef.current);
                if (refusal) throw new Error(`${jobId}: ${refusal}`);
                const payload = bytes.slice(3, bytes.length - 1);
                append('tx', `${jobId}: ${hex}`);
                const frame = await link.exchangeWithRetry(control, payload);
                link.assertPositive(frame, jobId);
                const result: JobRunResult = {
                    jobId,
                    request: hex,
                    response: toHex(frame.payload),
                    payloadLength: frame.payload.length,
                    at: Date.now(),
                    error: null,
                };
                append('rx', `${frame.payload.length} bytes`);
                setLastRun(result);
                return result;
            }),
        [append, run],
    );

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
    const clearFaults = useCallback(
        () =>
            run('Clear fault memory', async (link) => {
                const { control, payload } = clearFaultsCommand();
                append('tx', `Clear fault memory (control 0x${control.toString(16)})`);
                const frame = await link.exchangeWithRetry(control, payload);
                link.assertPositive(frame, 'Clear fault memory');
                append('info', 'fault memory cleared — freeze frames are gone with it');
                // The displayed faults are now a claim about a memory that no
                // longer holds them. Drop them and make the operator re-read.
                setFaults(null);
                setQuickTest(null);
                return true;
            }),
        [append, run],
    );

    const startLog = useCallback(
        (
            channels: readonly ChannelId[],
            onSample: (s: LiveSample) => void,
            onEnd: (failure: string | null) => void,
        ) => {
            const link = linkRef.current;
            if (!link || pollingRef.current) return;
            const { blocks } = planBlockReads(channels);
            if (blocks.length === 0) return;
            const wanted = new Set<ChannelId>(channels);

            pollingRef.current = true;
            finishedRef.current = false;
            setState('logging');
            const t0 = performance.now();
            append('info', `Recording ${channels.length} channel(s) across ${blocks.length} block(s).`);

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
            const latency = transportRef.current ? latencyTimerOf(transportRef.current) : null;
            void latency?.('log');

            void (async () => {
                let failure: string | null = null;
                try {
                    while (pollingRef.current && linkRef.current) {
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
                                    frame = await link.exchangeWithRetry(req.control, req.payload, {
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
                            link.assertPositive(frame, `Live block ${block.selection}`);
                            // Keyed by (selection, symbol). `block.selection` was
                            // already in hand here; the old line threw it away
                            // and used `v.symbol`, which is how one column ended
                            // up holding two blocks' readings.
                            for (const v of decodeLiveBlock(block, frame)) {
                                const id = channelId(block.selection, v.symbol);
                                if (wanted.has(id)) values[id] = v.value;
                            }
                        }
                        if (!incomplete) onSample({ time: (performance.now() - t0) / 1000, values });
                        await yieldToEventLoop();
                    }
                } catch (e) {
                    failure = e instanceof Error ? e.message : String(e);
                    failWith(e);
                } finally {
                    // Single exit point — a double-fire is impossible, and a
                    // failed run cannot quietly return the link to idle.
                    pollingRef.current = false;
                    setState('connected');
                    // Restored HERE and nowhere else, for the reason the comment above gives: a
                    // run that ended by failing must not leave the chip waking four times a
                    // second more than it needs to for the rest of the session, and stopLog is
                    // not that place — it only asks the loop to stop, and the loop is still
                    // finishing a sample when it returns.
                    void latency?.('idle');
                    if (!finishedRef.current) {
                        finishedRef.current = true;
                        onEnd(failure);
                    }
                }
            })();
        },
        [append, failWith],
    );

    const stopLog = useCallback(() => {
        pollingRef.current = false;
    }, []);

    // The heartbeat. Runs on every state, because the case it exists for is a
    // human reading values with the bus otherwise silent.
    useEffect(() => {
        const id = setInterval(() => {
            void linkRef.current?.keepAlive();
        }, KEEP_ALIVE_INTERVAL_MS);
        return () => clearInterval(id);
    }, []);

    /**
     * The three things that protect an operation in flight, all derived from one state.
     *
     * `inFlight` is computed, never stored: there is no flag for a failure path to forget to
     * clear, and every operation here returns the link to `connected` on both its success and its
     * catch path, so a throw releases all three by itself.
     *
     * This replaces an inline `beforeunload` that had neither a `returnValue` — which older
     * engines still read, and this is the one place where a silently ignored call costs a held
     * actuator its warning — nor a watchdog, so a transport that hung rather than threw would
     * have trapped the tab for the rest of the day.
     *
     * The budget is sized to the operation, which is why it is not one constant: a job run is
     * seconds, a datalog is a drive. One figure taken from the longer would let a hang hold the
     * tab for hours; taken from the shorter it would drop the guard in the middle of a real run.
     */
    const inFlight = state === 'busy' || state === 'logging';
    useUnloadGuard(inFlight, state === 'logging' ? 6 * 60 * 60 * 1000 : 5 * 60 * 1000);
    // Android's screen timeout is the ordinary way a phone interrupts itself. On desktop this is
    // close to a no-op, which is the right amount of effort for the platform that does not need
    // it. Best-effort throughout: a run must never fail because the screen could not be pinned.
    useScreenWakeLock(inFlight);
    // Cannot prevent a frozen tab; records that it happened, so a failure names its cause instead
    // of sending the next reader to look at the cable. Read at failure time, never rendered.
    const wasHidden = useHiddenWitness(inFlight);
    // Handed out rather than consumed here: this hook classifies the LINK, and whether the app was
    // backgrounded is a fact about the session. The surfaces that report a failure ask for it.
    void wasHidden;

    const clearLog = useCallback(() => {
        logRef.current = [];
        setLog([]);
    }, []);

    return {
        state,
        mode,
        error,
        errorKind,
        log,
        ident,
        faults,
        quickTest,
        adaptations,
        transportKind,
        connect,
        disconnect,
        readIdent,
        readFaults,
        readAdaptations,
        runRead,
        clearFaults,
        lastRun,
        startLog,
        stopLog,
        clearLog,
        clearError,
    };
}

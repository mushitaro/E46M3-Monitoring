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
import {
    Ds2Address,
    Ds2Link,
    WebSerialTransport,
    isDs2Error,
    isWebSerialSupported,
    simulatedPort,
    toHex,
    type Ds2ErrorKind,
    type Ds2Frame,
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
    planBlockReads,
    type DecodedAdaptation,
    type ErrorMemoryEntry,
    type ErrorMemoryQuickTest,
} from '@tsunagi/ds2-mss54';
import { practiceEcu } from '@/lib/practiceEcu';

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

export interface LiveSample {
    /** Monotonic seconds since the run began. */
    time: number;
    values: Record<string, number | null>;
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

/**
 * Web Serial support, read in a way that survives a static export.
 *
 * `isWebSerialSupported()` is false during prerender (there is no navigator) and
 * true in a supporting browser, so reading it directly during render produced a
 * hydration mismatch — and React then abandoned that subtree's attributes,
 * which left the connect buttons inert. useSyncExternalStore with an explicit
 * server snapshot makes the first client render agree with the HTML and the
 * second render tell the truth.
 */
const noopSubscribe = () => () => {};
function useWebSerialSupported(): boolean {
    return useSyncExternalStore(
        noopSubscribe,
        () => isWebSerialSupported(),
        () => false,
    );
}

export function useDs2Link() {
    const [state, setState] = useState<LinkState>('disconnected');
    const [mode, setMode] = useState<LinkMode>('vehicle');
    const [error, setError] = useState<string | null>(null);
    const [errorKind, setErrorKind] = useState<Ds2ErrorKind | null>(null);
    const [log, setLog] = useState<CommsLogLine[]>([]);
    const [ident, setIdent] = useState<{ hex: string; length: number } | null>(null);
    const [faults, setFaults] = useState<ErrorMemoryEntry[] | null>(null);
    const [quickTest, setQuickTest] = useState<ErrorMemoryQuickTest | null>(null);
    const [adaptations, setAdaptations] = useState<AdaptationRead[] | null>(null);

    const webSerialSupported = useWebSerialSupported();

    const linkRef = useRef<Ds2Link | null>(null);
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
                const transport =
                    nextMode === 'practice'
                        ? new WebSerialTransport({ requestPort: simulatedPort(practiceEcu()).requestPort })
                        : new WebSerialTransport();
                const link = new Ds2Link(transport, { address: Ds2Address.DME });
                await link.connect();
                linkRef.current = link;
                setMode(nextMode);
                setState('connected');
                append(
                    'info',
                    nextMode === 'practice'
                        ? 'PRACTICE mode — no vehicle attached. Values are synthetic.'
                        : 'Connected over Web Serial at 9600 8E1.',
                );
            } catch (e) {
                linkRef.current = null;
                setState('disconnected');
                failWith(e);
            }
        },
        [append, clearError, failWith],
    );

    const disconnect = useCallback(async () => {
        pollingRef.current = false;
        const link = linkRef.current;
        linkRef.current = null;
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
    const startLog = useCallback(
        (symbols: string[], onSample: (s: LiveSample) => void, onEnd: (failure: string | null) => void) => {
            const link = linkRef.current;
            if (!link || pollingRef.current) return;
            const { blocks } = planBlockReads(symbols);
            if (blocks.length === 0) return;

            pollingRef.current = true;
            finishedRef.current = false;
            setState('logging');
            const t0 = performance.now();
            append('info', `Recording ${symbols.length} channel(s) across ${blocks.length} block(s).`);

            void (async () => {
                let failure: string | null = null;
                try {
                    while (pollingRef.current && linkRef.current) {
                        const values: Record<string, number | null> = {};
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
                            for (const v of decodeLiveBlock(block, frame)) {
                                if (symbols.includes(v.symbol)) values[v.symbol] = v.value;
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

    // Do not let the tab close mid-operation without a word. The old app had no
    // beforeunload handler at all, which is how a held actuator could be left
    // energised by closing a tab.
    useEffect(() => {
        if (state !== 'busy' && state !== 'logging') return;
        const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
        window.addEventListener('beforeunload', onBeforeUnload);
        return () => window.removeEventListener('beforeunload', onBeforeUnload);
    }, [state]);

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
        webSerialSupported,
        connect,
        disconnect,
        readIdent,
        readFaults,
        readAdaptations,
        startLog,
        stopLog,
        clearLog,
        clearError,
    };
}

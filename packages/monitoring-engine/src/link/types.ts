/**
 * What the link session hands out: its state, its log, and the shapes of what it read.
 *
 * These were declared in the app's hook (`src/hooks/useDs2Link.ts`), which re-exports them, so a
 * screen that imports them from there keeps working. They live here because the session
 * (`./session.ts`) and the record shapes (`../sync/session.ts`, `../journal.ts`) are made of them,
 * and neither may reach into a screen.
 */
import type { Ds2ErrorKind, TransportKind } from '@tsunagi/ds2-core';
import type { ChannelId, DecodedAdaptation } from '@tsunagi/ds2-mss54';
import type { KwpDtc } from '../kwpOnDs2.ts';
import type { DecodedFault } from '../faultLayouts.ts';

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
 * A fault-memory read from a module this app has no decoder for: what was sent, what came back.
 *
 * Kept as bytes on purpose. The MSS54's record layout is the only one ported, and reading another
 * module's answer through it would turn an unknown layout into confident nonsense.
 */
export interface RawFaultRead {
    request: string;
    response: string;
    /** The module's own job whose telegram this frame is. */
    source: string;
    /** A KWP-on-DS2 `$58` answer read as ISO 14230 lays it out (kwpOnDs2); not yet confirmed on a MK60. */
    kwpDtcs?: KwpDtc[];
    /**
     * The faults in this read, where the module's own SGBD reads them (faultLayouts; on the entries read
     * only). Not yet confirmed on a car: the bytes stay the answer.
     */
    decoded?: DecodedFault[];
}

/**
 * One operation that failed, as the link saw it — handed to `onFailure` for the preview's automatic
 * error records (the app's lib/sync/errorRecords.ts). The log is the ring buffer at that moment,
 * error line included; the receiver decides how much of it to keep.
 */
export interface LinkFailure {
    /** What was being attempted, in the same words the log's `… failed` line uses. */
    job: string;
    error: string;
    errorKind: Ds2ErrorKind | 'unclassified';
    mode: LinkMode;
    transport: TransportKind | null;
    /** The identity last read on this link, if any. */
    ident: { hex: string; length: number } | null;
    log: readonly CommsLogLine[];
}

/**
 * A read answered positively on a car measured stationary in the same call — the fact the
 * ledger's `observed-parked` is made of (ledger `recordParkedObservation`).
 */
export interface ParkedObservation {
    moduleId: string;
    jobId: string;
    telegram: string;
    response: string;
    /** ISO 8601. */
    at: string;
    /** The module's IDENT answer, hex, when it has been read this session. */
    ecuIdent?: string;
}

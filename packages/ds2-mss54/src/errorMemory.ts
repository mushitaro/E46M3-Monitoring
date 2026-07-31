/**
 * DS2 error-memory decoding.
 *
 * The old PWA got fault text from EdiabasLib (F_ORT_NR / F_ORT_TEXT) and had no
 * decoder of its own; dropping the host meant this had to exist. The record
 * layout below is taken from the reference tool's DmeErrorMemoryParser — see
 * THIRD-PARTY-NOTICES.md §3.
 *
 * Two sources, two record shapes:
 *
 *   Error memory (control 0x04), 22 bytes per record
 *     +0  error code
 *     +1  error type
 *     +2  frequency counter
 *     +3  logistics counter
 *     +4  environment set 1   (4 condition bytes + uint16 counter)
 *     +10 environment set 2
 *     +16 environment set 3
 *
 *   Shadow memory (control 0x14), 24 bytes per record
 *     +0  error code
 *     +1  error type
 *     +2  current error type
 *     +3  current filter
 *     +4  frequency counter
 *     +5  logistics counter
 *     +6/+12/+18  environment sets
 *
 * The environment sets are the freeze frames (Umweltbedingungen) — the
 * conditions recorded when the fault was stored. The old app displayed none of
 * this, and it is often what actually identifies an intermittent fault.
 *
 * NOT VERIFIED ON A VEHICLE.
 */

import { Ds2Error } from '@tsunagi/ds2-core';
import type { Ds2Frame } from '@tsunagi/ds2-core';

export const ERROR_MEMORY_RECORD_LENGTH = 22;
export const SHADOW_RECORD_LENGTH = 24;
/** A DS2 response payload cannot exceed this, so neither can a batch of records. */
export const MAX_RESPONSE_PAYLOAD_LENGTH = 251;

export type ErrorMemorySource = 'errorMemory' | 'shadow';

export interface EnvironmentSet {
    condition1: number;
    condition2: number;
    condition3: number;
    condition4: number;
    counter: number;
}

export interface ErrorMemoryEntry {
    source: ErrorMemorySource;
    /** 1-based position in the ECU's memory, continued across batched reads. */
    number: number;
    errorCode: number;
    errorType: number;
    /** Shadow memory only. */
    currentErrorType: number | null;
    /** Shadow memory only. */
    currentFilter: number | null;
    frequencyCounter: number;
    logisticsCounter: number;
    /** Three freeze frames, oldest to newest as the ECU stores them. */
    environmentSets: EnvironmentSet[];
}

export interface ErrorMemoryQuickTest {
    source: ErrorMemorySource;
    status: number;
    /** Two 16-bit counters whose exact meaning is unconfirmed — reported verbatim. */
    counterA: number;
    counterB: number;
}

export function recordLength(source: ErrorMemorySource): number {
    return source === 'errorMemory' ? ERROR_MEMORY_RECORD_LENGTH : SHADOW_RECORD_LENGTH;
}

/** How many records the ECU can return in one response. */
export function maxRecordsPerResponse(source: ErrorMemorySource): number {
    return Math.floor(250 / recordLength(source));
}

export function parseQuickTest(frame: Ds2Frame, source: ErrorMemorySource): ErrorMemoryQuickTest {
    const p = frame.payload;
    if (p.length !== 5) {
        throw new Ds2Error(
            'PAYLOAD_TOO_SHORT',
            `Invalid ${source} quicktest payload length ${p.length}; expected 5`,
            { detail: { length: p.length, expected: 5, source } },
        );
    }
    return {
        source,
        status: p[0],
        counterA: readUint16(p, 1),
        counterB: readUint16(p, 3),
    };
}

/**
 * Parses a batch of entries.
 *
 * `startNumber` continues the numbering across batched reads, so entry numbers
 * stay stable when the memory does not fit one response.
 *
 * A length that is not a whole number of records is an error, not something to
 * truncate: a short-but-checksum-valid response would otherwise silently drop
 * the tail of the fault list, which for a diagnostic tool is the worst possible
 * failure — it looks like a clean car.
 */
export function parseErrorMemoryEntries(
    frame: Ds2Frame,
    source: ErrorMemorySource,
    startNumber = 1,
): ErrorMemoryEntry[] {
    const p = frame.payload;
    if (p.length === 0) {
        throw new Ds2Error('PAYLOAD_TOO_SHORT', `Invalid ${source} payload: missing error count`, {
            detail: { source },
        });
    }
    // [count, 0] is how the ECU says "nothing stored".
    if (p.length === 2 && p[1] === 0) return [];

    const size = recordLength(source);
    const body = p.length - 1;
    if (body < 0 || body % size !== 0) {
        throw new Ds2Error(
            'PAYLOAD_TOO_SHORT',
            `Invalid ${source} payload length ${p.length}; records must be ${size} bytes`,
            { detail: { length: p.length, recordLength: size, source } },
        );
    }

    const entries: ErrorMemoryEntry[] = [];
    let offset = 1;
    let number = startNumber;
    while (offset + size <= p.length) {
        entries.push(
            source === 'errorMemory'
                ? parseErrorRecord(p, offset, number)
                : parseShadowRecord(p, offset, number),
        );
        offset += size;
        number++;
    }
    return entries;
}

function parseErrorRecord(p: Uint8Array, o: number, number: number): ErrorMemoryEntry {
    return {
        source: 'errorMemory',
        number,
        errorCode: p[o],
        errorType: p[o + 1],
        currentErrorType: null,
        currentFilter: null,
        frequencyCounter: p[o + 2],
        logisticsCounter: p[o + 3],
        environmentSets: [readEnvironmentSet(p, o + 4), readEnvironmentSet(p, o + 10), readEnvironmentSet(p, o + 16)],
    };
}

function parseShadowRecord(p: Uint8Array, o: number, number: number): ErrorMemoryEntry {
    return {
        source: 'shadow',
        number,
        errorCode: p[o],
        errorType: p[o + 1],
        currentErrorType: p[o + 2],
        currentFilter: p[o + 3],
        frequencyCounter: p[o + 4],
        logisticsCounter: p[o + 5],
        environmentSets: [readEnvironmentSet(p, o + 6), readEnvironmentSet(p, o + 12), readEnvironmentSet(p, o + 18)],
    };
}

function readEnvironmentSet(p: Uint8Array, o: number): EnvironmentSet {
    return {
        condition1: p[o],
        condition2: p[o + 1],
        condition3: p[o + 2],
        condition4: p[o + 3],
        counter: readUint16(p, o + 4),
    };
}

function readUint16(p: Uint8Array, o: number): number {
    return (p[o] << 8) | p[o + 1];
}

export function formatErrorCode(code: number): string {
    return `0x${code.toString(16).toUpperCase().padStart(2, '0')}`;
}

/**
 * Adaptation blocks — the values the DME has LEARNED, as opposed to the live
 * values it is measuring right now.
 *
 * This is the module's real answer to "what is my car's current calibration
 * value": lambda trim offsets, throttle and pedal zero positions, crank-wheel
 * segment deviation per cylinder, knock adaptation per cylinder, lifetime
 * misfire counters, maximum RPM and speed ever reached, total overrev time.
 *
 * ## It is a TABLE, not a code path
 *
 * `AdaptationService` in the reference tool reads these with the same
 * `ReadIoStatusExchangeAsync(selection)` used for live values — DS2 control
 * 0x0B. So `liveBlockRequest`, `decodeField` and `minPayloadLength` in
 * ds2-core already do all the work; this file adds a second table and two thin
 * wrappers, and deliberately does not duplicate the decoder.
 *
 * ## Why they are NOT offered as datalog channels
 *
 * `planBlockReads()` builds the polling plan for the live view. A lifetime
 * misfire counter or "maximum RPM ever reached" polled at 5 Hz is noise, and
 * mixing them into the channel picker would bury the 213 values that do change.
 * Separate export, separate reader.
 */

import { decodeField, minPayloadLength, type FieldDef } from '@tsunagi/ds2-core';
import {
    MSS54_ADAPTATION_BLOCKS,
    MSS54_ADAPTATION_DIVERGENCES,
    MSS54_ADAPTATION_UNREADABLE,
    type AdaptationBlock,
    type AdaptationField,
} from './adaptationBlocks.generated';

export {
    MSS54_ADAPTATION_BLOCKS,
    MSS54_ADAPTATION_DIVERGENCES,
    MSS54_ADAPTATION_UNREADABLE,
    MSS54_ADAPTATION_FIELD_COUNT,
    type AdaptationBlock,
    type AdaptationField,
    type AdaptationDivergence,
    type UnreadableAdaptationBlock,
} from './adaptationBlocks.generated';

export function adaptationBlockBySelection(selection: number): AdaptationBlock | undefined {
    return MSS54_ADAPTATION_BLOCKS.find((b) => b.selection === selection);
}

/**
 * One decoded adaptation value.
 *
 * `de` is carried alongside `name` on purpose. `name` is the decompiled tool's
 * English; `de` is the SGBD's own German, which is authoritative — and where
 * the two disagree, the German is the one that came from BMW.
 */
export interface DecodedAdaptation {
    symbol: string;
    name: string;
    de?: string;
    unit: string;
    group: string;
    /** null when the payload is too short to hold this field. */
    value: number | null;
}

export function decodeAdaptationBlock(
    block: AdaptationBlock,
    payload: Uint8Array,
): DecodedAdaptation[] {
    return block.fields.map((f) => ({
        symbol: f.symbol,
        name: f.name,
        de: f.de,
        unit: f.unit,
        group: f.group,
        value: decodeField(payload, f as FieldDef),
    }));
}

/**
 * The shortest payload that can hold every field.
 *
 * NOT `expectedLength`. Block 6 declares 83 while its own field table reaches
 * offset 92 — trusting the declared length would silently truncate the last
 * four values, and `decodeField` would return null for them rather than
 * complaining.
 */
export function adaptationBlockMinLength(block: AdaptationBlock): number {
    return minPayloadLength(block.fields as readonly FieldDef[]);
}

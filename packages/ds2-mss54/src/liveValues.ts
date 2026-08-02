/**
 * Reading MSS54 live-measurement blocks.
 *
 * A block is one DS2 exchange: control 0x0B (READ_IO_STATUS) with the block's
 * selection byte. The whole block comes back in a single response and every
 * field in the table is an offset into that payload — so the cost of a "sample"
 * is one round trip per BLOCK, not per channel. Selecting twelve channels that
 * happen to live in one block is one exchange; twelve channels spread over four
 * blocks is four.
 *
 * That is the honest sampling model, and it is why there is no interval
 * setting: the sample rate IS the round-trip time. Measure it and show it;
 * do not invent a cadence.
 */

import {
    Ds2Control,
    Ds2Error,
    decodeField,
    minPayloadLength,
    type Ds2Frame,
} from '@tsunagi/ds2-core';
import {
    MSS54_LIVE_BLOCKS,
    type LiveValueBlock,
    type LiveValueField,
} from './liveValueBlocks.generated';

export {
    MSS54_LIVE_BLOCKS,
    MSS54_LIVE_COVERAGE,
    MSS54_LIVE_FIELD_COUNT,
    MSS54_LIVE_JOIN_REFUSALS,
} from './liveValueBlocks.generated';
export type {
    LiveJoinRefusal,
    LiveJoinSource,
    LiveValueBlock,
    LiveValueField,
} from './liveValueBlocks.generated';

/**
 * A channel is identified by BLOCK PLUS SYMBOL, not by symbol alone.
 *
 * 10 of the 213 fields appear in two blocks: `n`, `ml`, `rf`, `wdk1`, `wdk2`,
 * `zustand_motor`, `asc_st`, `ti_ausblend_ist`, `sa_we_st`, `edk_aus` — 203
 * distinct symbols in total. Engine speed, for instance, is readable from both
 * the standard block (3) and the VANOS block (35).
 *
 * That is useful rather than redundant: if a block is already being read for
 * something else, a duplicated quantity costs nothing extra. But it means a
 * symbol-keyed map silently loses one of each pair, which is exactly what an
 * earlier version of this file did.
 */
export type ChannelId = `${number}:${string}`;

export function channelId(selection: number, symbol: string): ChannelId {
    return `${selection}:${symbol}`;
}

export const MSS54_CHANNELS: ReadonlyMap<ChannelId, { block: LiveValueBlock; field: LiveValueField }> =
    new Map(
        MSS54_LIVE_BLOCKS.flatMap((block) =>
            block.fields.map(
                (field) => [channelId(block.selection, field.symbol), { block, field }] as const,
            ),
        ),
    );

/** Every block that can supply a given symbol, in selection order. */
export const MSS54_BLOCKS_BY_SYMBOL: ReadonlyMap<string, readonly LiveValueBlock[]> = (() => {
    const map = new Map<string, LiveValueBlock[]>();
    for (const block of MSS54_LIVE_BLOCKS) {
        for (const field of block.fields) {
            const list = map.get(field.symbol);
            if (list) list.push(block);
            else map.set(field.symbol, [block]);
        }
    }
    return map;
})();

export function blockBySelection(selection: number): LiveValueBlock | undefined {
    return MSS54_LIVE_BLOCKS.find((b) => b.selection === selection);
}

/** The request payload for a block read: just the selection byte. */
export function liveBlockRequest(selection: number): { control: number; payload: Uint8Array } {
    return { control: Ds2Control.READ_IO_STATUS, payload: new Uint8Array([selection]) };
}

export interface DecodedValue {
    symbol: string;
    name: string;
    unit: string;
    group: string;
    /** null means the payload was too short to hold this field — NOT a value of 0. */
    value: number | null;
}

/**
 * Decodes a block response.
 *
 * Validates against the FIELD TABLE's own reach, not against the reference's
 * declared `expectedLength`. Reference documentation is routinely
 * self-contradictory — in this very catalog, selection 19 declares 90 bytes
 * while several of its fields sit inside that and others do not, and selection
 * 21 declares 42 bytes for six fields that end well before it. An equality
 * check against a possibly-stale constant would reject responses the ECU is
 * entitled to send; this fails only where fields would otherwise decode to
 * silent nulls.
 */
export function decodeLiveBlock(block: LiveValueBlock, frame: Ds2Frame): DecodedValue[] {
    const need = minPayloadLength(block.fields);
    if (frame.payload.length < need) {
        throw new Ds2Error(
            'PAYLOAD_TOO_SHORT',
            `Live block ${block.selection} (${block.name}) returned ${frame.payload.length} bytes; ` +
                `its field table needs at least ${need}`,
            {
                detail: {
                    selection: block.selection,
                    received: frame.payload.length,
                    required: need,
                    declared: block.expectedLength,
                },
            },
        );
    }
    return block.fields.map((field) => ({
        symbol: field.symbol,
        name: field.name,
        unit: field.unit,
        group: field.group,
        value: decodeField(frame.payload, field),
    }));
}

/**
 * Works out which blocks must be read to cover a set of channels.
 *
 * The block count IS the cost: one DS2 round trip each. A caller should show it,
 * because "12 channels" and "12 channels spread over 4 blocks" sample at very
 * different rates.
 *
 * ## This used to be a set-cover, and it should not have been
 *
 * It took bare symbols and solved greedily for the fewest blocks — legitimate
 * arithmetic on the wrong question. With a symbol you have to decide WHICH block
 * supplies it; with a `ChannelId` the caller has already said. Choosing for them
 * meant asking for engine speed and being handed block 35's copy, then recording
 * it under a key that could not tell you so. The saving was real and the
 * bookkeeping was not, and the bookkeeping is what ends up in the CSV.
 *
 * The saving is not lost, it moved: `MSS54_BLOCKS_BY_SYMBOL` says which blocks
 * carry a duplicated quantity, so the picker can show that a channel is also
 * available in a block already being read. That is the same optimisation made by
 * the person who will read the file.
 */
export function planBlockReads(channels: readonly ChannelId[]): {
    blocks: LiveValueBlock[];
    unknown: ChannelId[];
} {
    const unknown: ChannelId[] = [];
    const selections = new Set<number>();
    for (const id of channels) {
        const hit = MSS54_CHANNELS.get(id);
        if (hit) selections.add(hit.block.selection);
        else unknown.push(id);
    }
    const blocks = MSS54_LIVE_BLOCKS.filter((b) => selections.has(b.selection)).sort(
        (a, b) => a.selection - b.selection,
    );
    return { blocks, unknown };
}

/**
 * @tsunagi/ds2-mss54 — MSS54 / MSS54HP specifics on top of @tsunagi/ds2-core.
 *
 * Everything here is ECU knowledge: block layouts, record shapes, offsets,
 * scaling. Nothing here is protocol — that belongs in ds2-core, and nothing in
 * this package should reach for a port.
 *
 * NOTHING IN THIS PACKAGE HAS BEEN VERIFIED ON A VEHICLE. The offsets and
 * scaling come from a decompiled third-party tool (THIRD-PARTY-NOTICES.md §3)
 * and the telegram tables from a static scrape of SGBD bytecode. Treat every
 * value as a candidate until a car has confirmed it, and record confirmations
 * in the verified ledger.
 */

export {
    MSS54_LIVE_BLOCKS,
    MSS54_LIVE_FIELD_COUNT,
    MSS54_CHANNELS,
    MSS54_BLOCKS_BY_SYMBOL,
    channelId,
    blockBySelection,
    liveBlockRequest,
    decodeLiveBlock,
    planBlockReads,
    type LiveValueBlock,
    type LiveValueField,
    type DecodedValue,
    type ChannelId,
} from './liveValues';

export {
    parseErrorMemoryEntries,
    parseQuickTest,
    maxRecordsPerResponse,
    recordLength,
    formatErrorCode,
    ERROR_MEMORY_RECORD_LENGTH,
    SHADOW_RECORD_LENGTH,
    MAX_RESPONSE_PAYLOAD_LENGTH,
    type ErrorMemoryEntry,
    type ErrorMemoryQuickTest,
    type ErrorMemorySource,
    type EnvironmentSet,
} from './errorMemory';

export {
    IDENT_REQUEST,
    ERROR_MEMORY_QUICKTEST,
    ERROR_MEMORY_ENTRIES,
    SHADOW_MEMORY_ENTRIES,
} from './requests';

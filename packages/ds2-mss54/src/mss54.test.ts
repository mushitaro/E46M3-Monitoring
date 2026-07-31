import { describe, expect, it } from 'vitest';
import {
    Ds2Address,
    Ds2Status,
    buildDs2Frame,
    minPayloadLength,
    parseDs2Frame,
    toHex,
} from '@tsunagi/ds2-core';
import {
    ERROR_MEMORY_RECORD_LENGTH,
    MSS54_BLOCKS_BY_SYMBOL,
    MSS54_CHANNELS,
    channelId,
    MSS54_LIVE_BLOCKS,
    MSS54_LIVE_FIELD_COUNT,
    SHADOW_RECORD_LENGTH,
    blockBySelection,
    decodeLiveBlock,
    liveBlockRequest,
    maxRecordsPerResponse,
    parseErrorMemoryEntries,
    parseQuickTest,
    planBlockReads,
} from './index';

const positive = (payload: number[]) =>
    parseDs2Frame(buildDs2Frame(Ds2Address.DME, Ds2Status.ACKNOWLEDGE, new Uint8Array(payload)));

describe('the generated live-value catalog', () => {
    it('has the 8 blocks and 213 fields the reference declares', () => {
        expect(MSS54_LIVE_BLOCKS).toHaveLength(8);
        expect(MSS54_LIVE_FIELD_COUNT).toBe(213);
        expect(MSS54_LIVE_BLOCKS.reduce((n, b) => n + b.fields.length, 0)).toBe(213);
    });

    it('covers the documented selections', () => {
        expect(MSS54_LIVE_BLOCKS.map((b) => b.selection)).toEqual([2, 3, 4, 19, 21, 35, 83, 179]);
    });

    it('identifies a channel by block AND symbol, because 10 symbols repeat', () => {
        // n, ml, rf, wdk1, wdk2, zustand_motor, asc_st, ti_ausblend_ist,
        // sa_we_st and edk_aus each appear in two blocks — 203 distinct symbols
        // across 213 fields. A symbol-keyed map silently loses one of each pair.
        const symbols = MSS54_LIVE_BLOCKS.flatMap((b) => b.fields.map((f) => f.symbol));
        expect(new Set(symbols).size).toBe(203);
        expect(MSS54_CHANNELS.size).toBe(213);

        expect(MSS54_BLOCKS_BY_SYMBOL.get('n')!.map((b) => b.selection)).toEqual([3, 35]);
        expect(MSS54_CHANNELS.has(channelId(3, 'n'))).toBe(true);
        expect(MSS54_CHANNELS.has(channelId(35, 'n'))).toBe(true);
    });

    it('carries the fields that use the raw constructor rather than a helper', () => {
        // gks_roh and psau_roh are declared with `new DmeLiveValueFieldDefinition(...)`
        // instead of the A/S/U8/I7/U16/I15 helpers. Missing them silently produced
        // 211 of 213 fields until the generator's count guard caught it.
        for (const symbol of ['gks_roh', 'psau_roh']) {
            const entry = MSS54_CHANNELS.get(channelId(35, symbol));
            expect(entry, symbol).toBeDefined();
            expect(entry!.field.format).toBe('uint10');
            expect(entry!.field.unit).toBe('V');
        }
    });

    it('preserves scales that were C# expressions in the source', () => {
        // psau_local is `1.0 / 32.0` in the decompiled catalog.
        expect(MSS54_CHANNELS.get(channelId(35, 'psau_local'))!.field.scale).toBeCloseTo(1 / 32, 12);
    });

    it('reproduces the tuner-verified standard-measurement fields exactly', () => {
        // The tuner decodes these three from block 3 and verified them against a
        // real Testo log; they are the closest thing to ground truth we have.
        const n = MSS54_CHANNELS.get(channelId(3, 'n'))!.field;
        expect(n).toMatchObject({ offset: 0, format: 'uint16', scale: 1, add: 0 });

        const tmot = MSS54_CHANNELS.get(channelId(3, 'tmot'))!.field;
        expect(tmot).toMatchObject({ offset: 11, format: 'uint8', add: -48 });
    });
});

describe('liveBlockRequest', () => {
    it('is control 0x0B plus the selection byte', () => {
        const { control, payload } = liveBlockRequest(35);
        const frame = buildDs2Frame(Ds2Address.DME, control, payload);
        // The VANOS block read, exactly as documented: 12 05 0B 23 3F
        expect(toHex(frame)).toBe('12 05 0b 23 3f');
    });
});

describe('decodeLiveBlock', () => {
    const block3 = blockBySelection(3)!;

    it('decodes a full block', () => {
        const payload = new Uint8Array(minPayloadLength(block3.fields));
        payload[0] = 0x0b;
        payload[1] = 0xb8; // n = 3000 rpm
        payload[11] = 133; // tmot = 85 degC
        const values = decodeLiveBlock(block3, positive(Array.from(payload)));

        expect(values.find((v) => v.symbol === 'n')!.value).toBe(3000);
        expect(values.find((v) => v.symbol === 'tmot')!.value).toBe(85);
    });

    it('names a short response instead of returning a table of nulls', () => {
        // A short-but-checksum-valid response otherwise produces dashes with
        // nothing saying why.
        expect(() => decodeLiveBlock(block3, positive([0, 0, 0]))).toThrowError(
            expect.objectContaining({ code: 'PAYLOAD_TOO_SHORT' }),
        );
    });

    it('validates against the field table, not the declared length', () => {
        // Several blocks declare a length well beyond where their fields end:
        // selection 2 declares 64 for fields reaching 64, but selection 19
        // declares 90 and selection 179 declares 16 for six fields. Requiring
        // the declared length would reject responses the ECU may legitimately
        // send short.
        const loose = MSS54_LIVE_BLOCKS.filter(
            (b) => minPayloadLength(b.fields) < b.expectedLength,
        );
        expect(loose.length).toBeGreaterThan(0);
        for (const block of loose) {
            const need = minPayloadLength(block.fields);
            expect(() => decodeLiveBlock(block, positive(new Array(need).fill(0)))).not.toThrow();
        }
    });
});

describe('planBlockReads', () => {
    it('collapses symbols to the blocks that carry them — one round trip per block', () => {
        const { blocks, unknown } = planBlockReads(['n', 'tmot', 'evan1_ist']);
        // tmot is only in block 3, evan1_ist only in block 35, and n is in
        // both — so n is free and two round trips cover all three.
        expect(blocks.map((b) => b.selection)).toEqual([3, 35]);
        expect(unknown).toEqual([]);
    });

    it('uses a duplicated symbol from a block it is already reading', () => {
        // n lives in blocks 3 and 35. Asking for n plus a VANOS-only channel
        // must not add block 3 as well.
        const { blocks } = planBlockReads(['n', 'evan1_ist']);
        expect(blocks.map((b) => b.selection)).toEqual([35]);
    });

    it('reports unknown symbols rather than silently dropping them', () => {
        const { unknown } = planBlockReads(['n', 'rpm', 'coolant']);
        // 'rpm' and 'coolant' were the old PWA's dead default selection.
        expect(unknown).toEqual(['rpm', 'coolant']);
    });
});

describe('error memory', () => {
    it('reads an empty memory as no faults', () => {
        expect(parseErrorMemoryEntries(positive([0x00, 0x00]), 'errorMemory')).toEqual([]);
    });

    it('decodes a record with its three freeze frames', () => {
        const record = [
            0x2a, // error code
            0x08, // error type
            0x03, // frequency counter
            0x05, // logistics counter
            // env set 1
            0x11, 0x22, 0x33, 0x44, 0x01, 0x00,
            // env set 2
            0x55, 0x66, 0x77, 0x88, 0x00, 0x0a,
            // env set 3
            0x99, 0xaa, 0xbb, 0xcc, 0x12, 0x34,
        ];
        expect(record).toHaveLength(ERROR_MEMORY_RECORD_LENGTH);

        const [entry] = parseErrorMemoryEntries(positive([0x01, ...record]), 'errorMemory');
        expect(entry).toMatchObject({
            source: 'errorMemory',
            number: 1,
            errorCode: 0x2a,
            errorType: 0x08,
            frequencyCounter: 0x03,
            logisticsCounter: 0x05,
            currentErrorType: null,
        });
        expect(entry.environmentSets).toHaveLength(3);
        expect(entry.environmentSets[0]).toEqual({
            condition1: 0x11, condition2: 0x22, condition3: 0x33, condition4: 0x44, counter: 0x0100,
        });
        expect(entry.environmentSets[2].counter).toBe(0x1234);
    });

    it('decodes shadow records, which carry two extra bytes', () => {
        const record = new Array(SHADOW_RECORD_LENGTH).fill(0);
        record[0] = 0x7f; // code
        record[1] = 0x01; // type
        record[2] = 0x02; // current error type
        record[3] = 0x03; // current filter
        record[4] = 0x04; // frequency
        record[5] = 0x05; // logistics

        const [entry] = parseErrorMemoryEntries(positive([0x01, ...record]), 'shadow');
        expect(entry).toMatchObject({
            source: 'shadow',
            errorCode: 0x7f,
            currentErrorType: 0x02,
            currentFilter: 0x03,
            frequencyCounter: 0x04,
            logisticsCounter: 0x05,
        });
    });

    it('continues numbering across batched reads', () => {
        const two = [...new Array(ERROR_MEMORY_RECORD_LENGTH).fill(0), ...new Array(ERROR_MEMORY_RECORD_LENGTH).fill(0)];
        const entries = parseErrorMemoryEntries(positive([0x02, ...two]), 'errorMemory', 12);
        expect(entries.map((e) => e.number)).toEqual([12, 13]);
    });

    it('rejects a payload that is not a whole number of records', () => {
        // Truncating here would silently drop the tail of the fault list, which
        // for a diagnostic tool looks exactly like a clean car.
        const partial = new Array(ERROR_MEMORY_RECORD_LENGTH - 3).fill(0);
        expect(() => parseErrorMemoryEntries(positive([0x01, ...partial]), 'errorMemory')).toThrowError(
            expect.objectContaining({ code: 'PAYLOAD_TOO_SHORT' }),
        );
    });

    it('sizes a batch so it fits one DS2 response', () => {
        expect(maxRecordsPerResponse('errorMemory')).toBe(11); // floor(250/22)
        expect(maxRecordsPerResponse('shadow')).toBe(10); // floor(250/24)
    });

    it('parses a quicktest', () => {
        const q = parseQuickTest(positive([0x02, 0x00, 0x05, 0x01, 0x00]), 'errorMemory');
        expect(q).toEqual({ source: 'errorMemory', status: 0x02, counterA: 5, counterB: 256 });
    });

    it('rejects a quicktest of the wrong length', () => {
        expect(() => parseQuickTest(positive([0x02, 0x00]), 'errorMemory')).toThrow();
    });
});

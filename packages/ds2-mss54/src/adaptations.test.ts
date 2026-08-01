import { describe, expect, it } from 'vitest';
import { MSS54_LIVE_BLOCKS } from './liveValues';
import {
    MSS54_ADAPTATION_BLOCKS,
    MSS54_ADAPTATION_DIVERGENCES,
    MSS54_ADAPTATION_FIELD_COUNT,
    MSS54_ADAPTATION_UNREADABLE,
    adaptationBlockBySelection,
    adaptationBlockMinLength,
    decodeAdaptationBlock,
} from './adaptations';

describe('the radix hazard', () => {
    /**
     * The SGBD job suffixes are HEX: STATUS_ADAPTIONSBLOCK_06/16/26/83 are
     * selections 6/22/38/131. Live block 83 is DECIMAL and is EGAS
     * Measurements. Read the adaptation 0x83 as decimal 83 and you attach
     * lambda-ageing adaptation names to throttle measurements — a wrong label
     * on a diagnostic tool is an operating hazard, not a cosmetic bug.
     */
    it('adaptation selections never collide with live-value selections', () => {
        const adapt = new Set(MSS54_ADAPTATION_BLOCKS.map((b) => b.selection));
        const live = new Set(MSS54_LIVE_BLOCKS.map((b) => b.selection));
        expect([...adapt].filter((s) => live.has(s))).toEqual([]);
    });

    it('resolves the hex job suffixes to 6, 22 and 38 — not 6, 16 and 26', () => {
        expect(adaptationBlockBySelection(6)?.sgbdJob).toBe('STATUS_ADAPTIONSBLOCK_06');
        expect(adaptationBlockBySelection(22)?.sgbdJob).toBe('STATUS_ADAPTIONSBLOCK_16');
        expect(adaptationBlockBySelection(38)?.sgbdJob).toBe('STATUS_ADAPTIONSBLOCK_26');
        expect(adaptationBlockBySelection(16)).toBeUndefined();
        expect(adaptationBlockBySelection(26)).toBeUndefined();
    });

    it('keeps 0x83 out of the readable set and names it as unreadable instead', () => {
        expect(adaptationBlockBySelection(131)).toBeUndefined();
        const u = MSS54_ADAPTATION_UNREADABLE.find((b) => b.selection === 131);
        expect(u?.sgbdJob).toBe('STATUS_ADAPTIONSBLOCK_83');
        // Listable — it has names — but not readable, because no offsets exist.
        expect(u!.results.length).toBeGreaterThan(50);
        // And it must not be confused with the live block that IS 83.
        expect(MSS54_LIVE_BLOCKS.find((b) => b.selection === 83)?.name).toContain('EGAS');
    });
});

describe('the join to the SGBD', () => {
    it('carries authentic German names on the fields that joined', () => {
        const b6 = adaptationBlockBySelection(6)!;
        const lu1 = b6.fields.find((f) => f.symbol === 'lu_adapt[0]')!;
        expect(lu1.sgbdResult).toBe('STAT_LU_ADAPT1_WERT');
        expect(lu1.de).toMatch(/Segmentabweichung/);
    });

    it('flattens array and dotted symbols into the SGBD naming', () => {
        const b38 = adaptationBlockBySelection(38)!;
        const dotted = b38.fields.find((f) => f.symbol.includes('.'));
        // ff.ff_rdy -> STAT_FF_FF_RDY_WERT
        if (dotted?.sgbdResult) expect(dotted.sgbdResult).not.toContain('.');
    });

    it('joined most of the table', () => {
        const joined = MSS54_ADAPTATION_BLOCKS.flatMap((b) => b.fields).filter((f) => f.sgbdResult);
        expect(joined.length).toBeGreaterThanOrEqual(85);
    });
});

describe('divergences from the decompiled reference', () => {
    /**
     * The reference is a third-party decompilation, not scripture. Where it
     * disagrees with the SGBD the divergence is recorded rather than silently
     * copied or silently corrected.
     */
    it('records that the SGBD declares eight cylinders where the table has six', () => {
        const d = MSS54_ADAPTATION_DIVERGENCES.filter((x) => x.kind === 'sgbd-declares-more');
        expect(d.length).toBeGreaterThan(0);
        expect(d.some((x) => x.selection === 22)).toBe(true);
    });

    it('corrects lu_adapt[5], whose reference scale is 10^5 off its five siblings', () => {
        const d = MSS54_ADAPTATION_DIVERGENCES.find((x) => x.kind === 'scale-corrected');
        expect(d?.symbol).toBe('lu_adapt[5]');
        expect(d?.referenceScale).toBeCloseTo(2.384185791015625e-9, 15);

        const b6 = adaptationBlockBySelection(6)!;
        const scales = [0, 1, 2, 3, 4, 5].map(
            (i) => b6.fields.find((f) => f.symbol === `lu_adapt[${i}]`)!.scale,
        );
        // All six now share one scale. The SGBD calls all of them "in ppm".
        expect(new Set(scales).size).toBe(1);
    });
});

describe('decoding', () => {
    it('uses the field table, not the declared length, to size a payload', () => {
        const b6 = adaptationBlockBySelection(6)!;
        // Block 6 declares 83 but its own fields reach past it.
        expect(adaptationBlockMinLength(b6)).toBeGreaterThan(b6.expectedLength);
    });

    it('returns null for fields a short payload cannot hold, rather than a wrong number', () => {
        const b6 = adaptationBlockBySelection(6)!;
        const decoded = decodeAdaptationBlock(b6, new Uint8Array(4));
        expect(decoded[0].value).not.toBeNull();
        expect(decoded[decoded.length - 1].value).toBeNull();
    });

    it('decodes a full-length payload for every field', () => {
        const b6 = adaptationBlockBySelection(6)!;
        const decoded = decodeAdaptationBlock(b6, new Uint8Array(adaptationBlockMinLength(b6)));
        expect(decoded.every((d) => d.value !== null)).toBe(true);
        expect(decoded.length).toBe(b6.fields.length);
    });

    it('pins the field count so a regeneration that loses rows fails', () => {
        const total = MSS54_ADAPTATION_BLOCKS.reduce((n, b) => n + b.fields.length, 0);
        expect(total).toBe(MSS54_ADAPTATION_FIELD_COUNT);
        expect(total).toBe(102);
    });
});

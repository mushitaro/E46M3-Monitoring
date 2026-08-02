'use client';

/**
 * The per-gear measurements a complete gearbox adaptation records.
 *
 * `ADAPTIONSWERTE_LESEN(ADAPTION_LESEN=1)` returns 42 of these: three
 * measurements × seven gears × two passes.
 *
 *   SW_GANG<n>_ROH<p>          Schaltweg — how far the shift travel went
 *   WW_TOUCH_L_GANG<n>_ROH<p>  Waehlwinkelanschlag links  — the left gate stop
 *   WW_TOUCH_R_GANG<n>_ROH<p>  Waehlwinkelanschlag rechts — the right gate stop
 *
 * As 42 flat rows they are unreadable. As a gear × measurement grid they are
 * the record of the sweep the operator just watched — `Gang 1 ausmessen`
 * through `Gang R ausmessen`, one row each.
 *
 * ## None of them has a spec, and that must be said
 *
 * Not one of the 42 carries a `min`/`max`/`default` — I checked the shipped
 * file. `verdictFor` returns `'unknown'` for every one and the UI shows that.
 * They are a measured window, comparable against each other and against a
 * previous read, and nothing here may invent a pass/fail for them. The gate
 * positions in the same block (`WW_GASSE_1_2_WERT` and friends) DO have stated
 * defaults and go through the ordinary `SpecTable`.
 */

import type { CatalogResult } from './ecuCatalog';

/** `R` last, because that is the order the ECU measures them in. */
export const GEARS = ['1', '2', '3', '4', '5', '6', 'R'] as const;
export type Gear = (typeof GEARS)[number];

export const MEASURES = ['SW', 'WW_TOUCH_L', 'WW_TOUCH_R'] as const;
export type Measure = (typeof MEASURES)[number];

/** Two raw passes. The ECU measures each gear twice; the pair is the point. */
export const PASSES = ['1', '2'] as const;
export type Pass = (typeof PASSES)[number];

const CELL = /^(SW|WW_TOUCH_L|WW_TOUCH_R)_GANG([1-6]|R)_ROH([12])_WERT$/;
const GATE = /^(WW_GASSE_(?:1_2|3_4|5_6|R))_WERT$/;

/**
 * The gate (Gasse) each gear sits in.
 *
 * INPA reads the two as a pair. Its `beliebigen_gang_einlegen` screen prints
 * `SW_GANG1_ROH1_WERT` beside `WW_GASSE_1_2_WERT`, `SW_GANG2_ROH1_WERT` beside
 * the same `WW_GASSE_1_2_WERT`, and so on down to `SW_GANGR_ROH1_WERT` beside
 * `WW_GASSE_R_WERT`; its `getriebeschema` picture draws those four values as the
 * four columns of the H.
 *
 * Two gears share one gate, and that is the diagnostic point: when both gears of
 * a pair read off in the same direction, the gate is what moved, not the gears.
 * Nothing in the SGBD states this pairing — the result names merely rhyme — so it
 * is carried here with its source named.
 *
 * Source: `C:\EC-APPS\INPA\SGDAT\SMG2.IPO`, decompiled screens `getriebeschema`
 * and `beliebigen_gang_einlegen`.
 */
export const GATE_OF: Record<Gear, string> = {
    '1': 'WW_GASSE_1_2',
    '2': 'WW_GASSE_1_2',
    '3': 'WW_GASSE_3_4',
    '4': 'WW_GASSE_3_4',
    '5': 'WW_GASSE_5_6',
    '6': 'WW_GASSE_5_6',
    R: 'WW_GASSE_R',
};

/** The same four gates, short enough for a row's `code` slot. */
export const GATE_CODE: Record<Gear, string> = {
    '1': '1-2',
    '2': '1-2',
    '3': '3-4',
    '4': '3-4',
    '5': '5-6',
    '6': '5-6',
    R: 'R',
};

/**
 * Neutral is not a gear and sits in no gate; INPA reads `POS_SW_N_WERT` on its
 * own, above the gear list. It stays in the ordinary spec table.
 */
export const NEUTRAL_REF = 'POS_SW_N_WERT';

export interface GearWindows {
    /** `cells[gear][measure][pass]`. Absent where the SGBD declares no such result. */
    cell(gear: Gear, measure: Measure, pass: Pass): CatalogResult | undefined;
    /**
     * The gate value this gear is measured against, when the block declares it.
     *
     * Deliberately ALSO left in `rest`: the gate carries a factory default and a
     * range, so the spec table below owns the verdict. The gear row only says
     * which value to go and look at.
     */
    gate(gear: Gear): CatalogResult | undefined;
    matched: number;
    /** Everything that matched no cell. Carried, never dropped. */
    rest: CatalogResult[];
}

/**
 * Split a result set into the gear grid and everything else.
 *
 * `rest` exists so this can never be a filter that quietly loses rows: whatever
 * does not fit the grid comes back out and is rendered by the ordinary tables.
 */
export function gearWindows(results: readonly CatalogResult[]): GearWindows {
    const grid = new Map<string, CatalogResult>();
    const gates = new Map<string, CatalogResult>();
    const rest: CatalogResult[] = [];

    for (const r of results) {
        if (r.role !== 'value') {
            rest.push(r);
            continue;
        }
        const g = GATE.exec(r.name);
        if (g) {
            gates.set(g[1], r);
            rest.push(r); // the gate has a spec; the table below still owns it
            continue;
        }
        const m = CELL.exec(r.name);
        if (!m) {
            rest.push(r);
            continue;
        }
        grid.set(`${m[2]}:${m[1]}:${m[3]}`, r);
    }

    return {
        cell: (gear, measure, pass) => grid.get(`${gear}:${measure}:${pass}`),
        gate: (gear) => gates.get(GATE_OF[gear]),
        matched: grid.size,
        rest,
    };
}

/** Does this result set contain the gear grid at all? Only SMG II's gearbox block does. */
export function hasGearWindows(results: readonly CatalogResult[]): boolean {
    return results.some((r) => r.role === 'value' && CELL.test(r.name));
}

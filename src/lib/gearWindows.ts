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

export interface GearWindows {
    /** `cells[gear][measure][pass]`. Absent where the SGBD declares no such result. */
    cell(gear: Gear, measure: Measure, pass: Pass): CatalogResult | undefined;
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
    const rest: CatalogResult[] = [];

    for (const r of results) {
        const m = r.role === 'value' ? CELL.exec(r.name) : null;
        if (!m) {
            rest.push(r);
            continue;
        }
        grid.set(`${m[2]}:${m[1]}:${m[3]}`, r);
    }

    return {
        cell: (gear, measure, pass) => grid.get(`${gear}:${measure}:${pass}`),
        matched: grid.size,
        rest,
    };
}

/** Does this result set contain the gear grid at all? Only SMG II's gearbox block does. */
export function hasGearWindows(results: readonly CatalogResult[]): boolean {
    return results.some((r) => r.role === 'value' && CELL.test(r.name));
}

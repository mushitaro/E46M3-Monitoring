'use client';

/**
 * The DSC brake-hydraulic control surface.
 *
 * ## Per-wheel exists — as job identity, not as arguments
 *
 * `DRUCKABBAU_VL` and `DRUCKABBAU_VR` take no arguments at all; the corner is
 * the suffix on the name. So "release front-right" is a real button. Three
 * things about it are not tidy, and all three are stated rather than smoothed:
 *
 *   - **`DRUCKAUFBAU_VR` does not exist.** There is `_VL` and `_HA` and nothing
 *     for the front right. That is the ECU's gap; it travels as a site with
 *     `job: null` and an `absence` sentence, so the UI cannot render it wrong.
 *   - **The granularity is not uniform.** `DRUCKABBAU_HA` is an axle,
 *     `NA_ENTLUEFTUNG_LI` is a SIDE (front-left plus rear-left), and
 *     `DRUCKHALTEN` has no suffix at all while its bytecode touches only EVVL.
 *     Four of the twelve break any one-to-one mapping onto a wheel diagram.
 *   - **There is no stop.** See `stop` below.
 *
 * ## `drives` is a union over a static scrape
 *
 * It is every solenoid the job's extracted frames actuate AT SOME POINT — not
 * what it drives simultaneously, and not a sequence. `NA_ENTLUEFTUNG_LI`'s union
 * includes the right-hand outlet valves, which makes sense for a bleed routine
 * and which this app does not interpret. It is evidence, shown as evidence.
 */

export interface DscValve {
    name: string;
    byte: number;
    bit: string;
    /** VL / VR / HL / HR, or null for the pumps and special valves. */
    corner: string | null;
    kind: 'inlet' | 'outlet' | null;
}

export interface DscSite {
    site: string;
    ja: string;
    en: string;
    /** null when the SGBD has no job for this place. `absence` then says so. */
    job: string | null;
    absence?: { ja: string; en: string };
    drives?: string[];
}

export interface DscFamily {
    id: string;
    ja: string;
    en: string;
    sites: DscSite[];
}

export interface DscStop {
    id: string;
    /** `app-construct`: this is ours, not something the SGBD sanctions. */
    provenance: 'app-construct';
    job: string;
    telegram: string;
    /** The SGBD's own compound jobs whose bytecode ends with this frame. */
    terminates: string[];
    /** Other all-outputs-off candidates, and the bits that distinguish them. */
    runnersUp: Array<{ telegram: string; jobs: number; differsBy: string[]; unnamedBits: string[] }>;
    note: { ja: string; en: string };
}

export interface DscHydraulics {
    schema: 1;
    module: string;
    encoding: 'active-low';
    requestBits: string[];
    valves: DscValve[];
    families: DscFamily[];
    stop: DscStop;
}

const cache = new Map<string, DscHydraulics | null>();

/**
 * Returns null — not a throw — when the file is absent. Only DSC has one, and
 * the service pane asks for every module.
 */
export async function loadDscHydraulics(moduleId: string): Promise<DscHydraulics | null> {
    const hit = cache.get(moduleId);
    if (hit !== undefined) return hit;
    try {
        const res = await fetch(`./ecu-data/${moduleId}.hydraulics.json`, { cache: 'no-store' });
        const doc = res.ok ? ((await res.json()) as DscHydraulics) : null;
        cache.set(moduleId, doc);
        return doc;
    } catch {
        cache.set(moduleId, null);
        return null;
    }
}

/**
 * The bytes our constructed stop would send.
 *
 * Exported so a test can assert they are byte-identical to the frame the SGBD's
 * own compound jobs terminate with. If the construct and its evidence ever
 * drift apart, that test is what says so — the whole justification for offering
 * this control is that the ECU is already told this exact thing 22 times.
 */
export function dscStopFrame(h: DscHydraulics): number[] {
    return h.stop.telegram.split(' ').map((b) => parseInt(b, 16));
}

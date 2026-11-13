/**
 * Where the engine reads the private ECU data from — handed in by the app that uses it.
 *
 * The data (`<module>.jobs.json`, `<module>.telegrams.json`, `index.json`, `variants.json`) is
 * BMW-derived and not part of this repository (THIRD-PARTY-NOTICES.md §3; it lives in
 * E46M3-Monitoring-data). The engine never names a URL for it: every read goes through the one
 * loader here, by file name only.
 *
 * E46M3 /// MONITORING serves the files behind its owner gate at `./ecu-data/`, which is what the
 * default loader fetches — so the app does not have to configure anything, and behaves as it did
 * before the engine was a package. Another app (GREN BLUE SUITE) calls `configureEcuData` once,
 * before the first read, with a loader that reaches the data where it is allowed to
 * (docs/ENGINE.md §4).
 *
 * The loader answers like `fetch` does — `{ ok, status, json() }` — so a `Response` is one, and the
 * callers keep their own wording for a missing file (a catalogue that will not load throws with the
 * HTTP status; a missing telegram table or variant file degrades to "unknown", which fails closed).
 */

/** The part of a `Response` the engine reads. */
export interface EcuDataResponse {
    ok: boolean;
    status: number;
    json(): Promise<unknown>;
}

/** Reads one file of the ECU data, by its name (`mss54.jobs.json`, `index.json`, …). */
export type EcuDataLoader = (file: string) => Promise<EcuDataResponse>;

/** The page's own copy, behind the same origin's gate: E46M3 /// MONITORING. */
export const fetchEcuDataFromPage: EcuDataLoader = (file) => fetch(`./ecu-data/${file}`, { cache: 'no-store' });

let loader: EcuDataLoader = fetchEcuDataFromPage;

/**
 * Hand the engine the loader it reads the data with. Call it once, before anything is loaded: the
 * catalogue and the telegram tables are cached per page, so a loader changed afterwards serves only
 * the modules not read yet.
 */
export function configureEcuData(next: EcuDataLoader): void {
    loader = next;
}

/** One file of the ECU data, through the configured loader. */
export function readEcuData(file: string): Promise<EcuDataResponse> {
    return loader(file);
}

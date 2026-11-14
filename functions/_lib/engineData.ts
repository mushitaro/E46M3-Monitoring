/**
 * The module data (the ECU tables under /ecu-data/) from M's platform, held in this server's memory.
 *
 * Operator, 2026-11-14: m3's WORKS apps read their module data from the platform's engine door, the
 * same door GREN BLUE's server reads — m3 gets no special way in — and the data leaves the build and
 * this repository. The platform's rules for a Mainstay's server (tsunagi-m-platform
 * docs/runbook-s5.md §10, docs/design.md §10):
 *
 *   - The bundle is held ONLY in this isolate's memory, for the life of a data version. Nothing is
 *     written to D1, KV, the Cache API, a disk, the repository or the build. A new isolate fetches it
 *     again.
 *   - "Has it changed?" is asked at most once a minute, and only when `index.json` is asked for (the
 *     engine reads it first: once per car). 304 keeps what is held; 200 replaces it.
 *   - When the platform cannot be asked (network, 429, 503, a page that is not JSON), what is held
 *     keeps being served: the version may not have changed, it only could not be checked. With
 *     nothing held, the answer says why, and never "no".
 *   - The bundle is cut by length (`readEngineBundle`), never parsed as one JSON document.
 *
 * One rule differs from GREN BLUE's: this is a tool used in the car, where there is often no signal,
 * so the page may keep the files on the device behind the owner gate while the version is the same
 * (the service worker's `ecu-data-<version>` cache; operator, 2026-11-14). The answers are therefore
 * `private, no-cache` and carry the version, instead of `no-store`.
 *
 * Until the platform is configured for this deployment (M_ENGINE_DATA_URL and M_ENGINE_DATA_KEY
 * unset), `configured` is false and the route hands the request to the build's own copy, as before.
 */
import {
    ENGINE_DATA_BUNDLE,
    ENGINE_DATA_FILE,
    ENGINE_DATA_VERSION_HEADER,
    doorAuthorization,
    doorFailureOf,
    doorKeyUsable,
    readEngineBundle,
    type DoorFailure,
    type DoorKey,
    type EngineBundle,
} from './door';

export interface EngineDataEnv {
    /** The platform's data door, server to server: `https://tsunagi-m.pages.dev/engine/data`. */
    M_ENGINE_DATA_URL?: string;
    /** This Mainstay's slug on the platform. m3's WORKS apps are `m3`. */
    M_MAINSTAY?: string;
    /** The `engine-data` key (a secret, 43+ base64url characters). */
    M_ENGINE_DATA_KEY?: string;
    /** The key's id (`cred_…`), only while two keys of the purpose are alive. Not a secret. */
    M_ENGINE_DATA_KEY_ID?: string;
}

/** How long a held bundle counts as checked. */
export const CHECK_EVERY_MS = 60_000;

type Held = { bundle: EngineBundle; checkedAt: number };

export type EngineDataAnswer =
    | { kind: 'file'; bytes: Uint8Array; version: string }
    | { kind: 'not_found'; version: string | null }
    | { kind: 'failed'; failure: DoorFailure };

export interface EngineDataSource {
    /** Whether this deployment reads from the platform at all. */
    readonly configured: boolean;
    file(name: string, nowMs?: number): Promise<EngineDataAnswer>;
}

function keyOf(env: EngineDataEnv): DoorKey | null {
    const k = { mainstay: env.M_MAINSTAY ?? '', key: env.M_ENGINE_DATA_KEY ?? '', keyId: env.M_ENGINE_DATA_KEY_ID || null };
    return doorKeyUsable(k) ? k : null;
}

/** One holder per isolate; `fetcher` is injectable for tests. */
export function engineDataSource(env: EngineDataEnv, fetcher: typeof fetch = fetch): EngineDataSource {
    const base = (env.M_ENGINE_DATA_URL ?? '').replace(/\/+$/, '');
    const key = keyOf(env);
    const configured = Boolean(base && key);
    let held: Held | null = null;

    async function refresh(nowMs: number): Promise<DoorFailure | null> {
        if (!key) return { kind: 'unavailable' };
        const url = `${base}/${ENGINE_DATA_BUNDLE}`;
        let res: Response;
        try {
            res = await fetcher(url, {
                headers: {
                    authorization: await doorAuthorization(key, 'engine-data', 'GET', url, '', nowMs),
                    ...(held ? { 'if-none-match': `"${held.bundle.header.version}"` } : {}),
                },
            });
        } catch {
            return { kind: 'unavailable' };
        }
        if (res.status === 304 && held) {
            held.checkedAt = nowMs;
            return null;
        }
        if (res.status === 200) {
            const bundle = readEngineBundle(new Uint8Array(await res.arrayBuffer()));
            if (!bundle) return { kind: 'unavailable' };
            held = { bundle, checkedAt: nowMs }; // the old bundle goes with the reference
            return null;
        }
        return doorFailureOf(res.status, await res.text().catch(() => ''), nowMs);
    }

    return {
        configured,
        async file(name, nowMs = Date.now()) {
            if (!ENGINE_DATA_FILE.test(name)) return { kind: 'not_found', version: held?.bundle.header.version ?? null };
            const stale = !held || (name === 'index.json' && nowMs - held.checkedAt >= CHECK_EVERY_MS);
            if (stale) {
                const failure = await refresh(nowMs);
                if (failure && !held) return { kind: 'failed', failure };
                // A failure with a bundle held: keep serving it (it could not be checked, that is all).
            }
            const bundle = held!.bundle;
            const bytes = bundle.file(name);
            return bytes ? { kind: 'file', bytes, version: bundle.header.version } : { kind: 'not_found', version: bundle.header.version };
        },
    };
}

export { ENGINE_DATA_VERSION_HEADER };

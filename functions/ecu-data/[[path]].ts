/**
 * /ecu-data/<file> — the module data, behind the owner gate (functions/_middleware.ts runs first).
 *
 * Read from M's platform (functions/_lib/engineData.ts) once this deployment is configured for it;
 * until then the request goes on to the build's own copy, exactly as before (operator, 2026-11-14:
 * the data moves to the platform's engine door, and leaves the build when the door is live here).
 *
 * Answers: 200 with the file's own bytes, `x-m-dataset-version` and an ETag of the version; 304 when
 * the page already has that version; 404 for a name the data does not hold; 429 with `retry_after_s`
 * when the platform's day is spent; 503 when the platform cannot be asked and nothing is held.
 * Never cached by anything shared (`private`); the page keeps its copy only in the service worker's
 * per-version cache, behind the gate.
 */
import { ENGINE_DATA_VERSION_HEADER, engineDataSource, type EngineDataEnv, type EngineDataSource } from '../_lib/engineData';

interface Context {
    request: Request;
    env: EngineDataEnv;
    params: { path?: string | string[] };
    next(): Promise<Response>;
}

// One holder per isolate, and a new one if the settings it was made from change.
let source: EngineDataSource | null = null;
let madeFrom = '';

function sourceFor(env: EngineDataEnv): EngineDataSource {
    const sig = [env.M_ENGINE_DATA_URL, env.M_MAINSTAY, env.M_ENGINE_DATA_KEY_ID, env.M_ENGINE_DATA_KEY?.length].join('|');
    if (!source || sig !== madeFrom) {
        source = engineDataSource(env);
        madeFrom = sig;
    }
    return source;
}

const BASE_HEADERS = { 'cache-control': 'private, no-cache', 'x-robots-tag': 'noindex, nofollow', 'x-content-type-options': 'nosniff' };

const json = (status: number, body: unknown, extra: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers: { ...BASE_HEADERS, 'content-type': 'application/json', ...extra } });

export const onRequestGet = async (context: Context): Promise<Response> => {
    const data = sourceFor(context.env);
    if (!data.configured) return context.next();

    const parts = context.params.path;
    const name = Array.isArray(parts) ? parts.join('/') : (parts ?? '');
    const answer = await data.file(name);

    if (answer.kind === 'failed') {
        const f = answer.failure;
        if (f.kind === 'limited') return json(429, { error: 'temporarily_unavailable', retry_after_s: f.retryAfterS }, { 'retry-after': String(f.retryAfterS) });
        // auth / suspended / not_found from the door are this deployment's settings, not the owner's
        // doing: the page hears "could not read", and the server log says which.
        console.warn(`ecu-data: the platform's engine door answered ${f.kind}`);
        return json(503, { error: 'engine_data_unavailable' });
    }
    if (answer.kind === 'not_found') return json(404, { error: 'not_found' });

    const etag = `"${answer.version}"`;
    const headers = { ...BASE_HEADERS, 'content-type': 'application/json', etag, [ENGINE_DATA_VERSION_HEADER]: answer.version };
    if (context.request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers });
    // A view into the held bundle (nothing copied); the bundle came from an ArrayBuffer.
    return new Response(answer.bytes as Uint8Array<ArrayBuffer>, { status: 200, headers });
};

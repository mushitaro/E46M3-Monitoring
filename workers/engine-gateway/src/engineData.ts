import { json } from './json';
import { ENGINE_DATA_AUDIENCE, verifyEngineReportTicket, type EngineReportEnv } from './ticket';

/**
 * GET /engine-data/<file> — one file of the diagnostic engine's data, for a Mainstay's
 * server (operator, 2026-11-11: GREN BLUE SUITE uses this repository's engine, and only it).
 *
 * The data is BMW-derived and decompiled (THIRD-PARTY-NOTICES.md §3): it is served only inside a
 * closed delivery, and never leaves for another repository or build. A store's app reads it through
 * its own server, file by file, the way the engine's loader asks for it (packages/monitoring-engine
 * ecuData.ts `configureEcuData`): that server signs a ticket for exactly this file name with the
 * store's own key (workers/engine-gateway/src/ticket.ts, audience `engine-data`), and passes the
 * answer to its signed-in staff with no-store. Who of the store's staff may read is the store's
 * sign-in; which store may read is ENGINE_REPORT_MAINSTAYS and that store's key, here.
 *
 Served by the engine gateway (./index.ts), M's door for Mainstays, deployed apart from the WORKS
 * build: the data is the same files (public/ecu-data, copied into the gateway's output at deploy and
 * never committed), read through ASSETS only after the ticket holds — in advanced mode no request
 * reaches a static file except through this code.
 *
 * 200 the file, `Cache-Control: private, no-store`; 404 a name the engine does not read or no such
 * file; 401/503 from the ticket.
 */

interface Env extends EngineReportEnv {
    ASSETS?: { fetch(request: Request): Promise<Response> };
}
interface Ctx {
    request: Request;
    env: Env;
    params: { file?: string | string[] };
}

export const ENGINE_DATA_FILE = /^(?:[a-z0-9_]+\.(?:jobs|telegrams)\.json|index\.json|variants\.json|fault-layouts\.json)$/;

export const onRequestGet = async (ctx: Ctx): Promise<Response> => {
    const file = typeof ctx.params.file === 'string' ? ctx.params.file : '';
    if (!ENGINE_DATA_FILE.test(file)) return json({ error: 'not_found' }, 404);
    const auth = await verifyEngineReportTicket(ctx.env, ctx.request.headers.get('authorization'), file, Date.now() / 1000, ENGINE_DATA_AUDIENCE);
    if ('error' in auth) return json({ error: auth.error }, auth.status);
    if (!ctx.env.ASSETS) return json({ error: 'engine_data_unavailable' }, 503);

    const res = await ctx.env.ASSETS.fetch(new Request(new URL(`/ecu-data/${file}`, ctx.request.url)));
    if (!res.ok) return json({ error: 'not_found' }, 404);
    return new Response(res.body, {
        status: 200,
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store' },
    });
};

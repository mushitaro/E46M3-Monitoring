/**
 * tsunagi-engine-gateway — M's engine door for Mainstays (operator, 2026-11-12: the engine is M's, the
 * app is the Mainstay's; tsunagi-m-mainstay §3 接点: "the engine door is deployed apart from M's tools
 * (the WORKS apps), so a Mainstay's flow does not depend on MESH's app and its releases").
 *
 *   POST /engine-report         a Mainstay's diagnostic-engine error, for the desk   (./engineReport.ts)
 *   GET  /engine-data/<file>    one file of the engine's private data                 (./engineData.ts)
 *
 * Both answer a store's own one-time ticket alone (./ticket.ts), signed with that store's key and
 * checked against ENGINE_REPORT_MAINSTAYS. Nothing else is served: no owner cookie, no page, no
 * other path. It writes to the WORKS build's own D1 (the desk's records) and wakes the desk the way
 * the WORKS build does (functions/_lib/wake.ts) — the two share the database, never a deployment.
 *
 * A Pages project of its own (`tsunagi-engine-gateway` → tsunagi-engine-gateway.pages.dev) whose
 * only code is pages/_worker.js, like the desk: a Worker's own address is on the account's
 * workers.dev name, which is a person's. Deploy: `npm run gateway:deploy` (docs/ENGINE.md §7).
 */
import { onRequestGet as engineData } from './engineData';
import { onRequestPost as engineReport } from './engineReport';
import { json } from './json';
import type { EngineReportEnv } from './ticket';
import type { WakeEnv } from '../../../functions/_lib/wake';

export type GatewayEnv = EngineReportEnv & WakeEnv & { ASSETS?: { fetch(request: Request): Promise<Response> } };

const DATA = /^\/engine-data\/([^/]+)$/;

export async function handle(request: Request, env: GatewayEnv): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === '/engine-report') {
        if (request.method !== 'POST') return json({ error: 'method' }, 405);
        return engineReport({ request, env });
    }
    const m = DATA.exec(pathname);
    if (m) {
        if (request.method !== 'GET') return json({ error: 'method' }, 405);
        return engineData({ request, env, params: { file: decodeURIComponent(m[1]) } });
    }
    return json({ error: 'not_found' }, 404);
}

const gateway = {
    fetch(request: Request, env: GatewayEnv): Promise<Response> {
        return handle(request, env);
    },
};

export default gateway;

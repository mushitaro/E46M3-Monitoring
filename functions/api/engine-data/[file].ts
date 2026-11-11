import { serveEngineData, type EngineDataEnv } from '../../_lib/engineData';

/**
 * `GET /api/engine-data/<file>` — the engine's private data for another app's server, on an m3
 * token issued for this app with the `monitoring_engine` right. The middleware lets this one prefix
 * past the owner gate's cookie; everything it checks instead is in functions/_lib/engineData.ts.
 */
export const onRequest = (context: { request: Request; env: EngineDataEnv }): Promise<Response> => serveEngineData(context.request, context.env);

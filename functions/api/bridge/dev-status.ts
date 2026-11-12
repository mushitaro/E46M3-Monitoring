import { json } from '../../_owner-gate/owner';
import { devRecordOf, verifyDevTicket, type DevEnv } from '../../_lib/devTicket';
import { recordEntries } from '../../_lib/investigation';
import type { NotebookEntry } from '../../../src/lib/notebook/rules';

/**
 * GET /api/bridge/dev-status?limit=N — what went to the development desk from the relay, and what
 * the desk wrote back, newest first (TSUNAGI///Matrix `monitoring_dev_status`: 「さっきの頼みごと
 * どうなった？」). Same ticket as dev-request; the record is the owner's own and nobody else's.
 *
 * 200 `{ record, items: [{ entry, at, by: 'chat' | 'desk', kind, text, re? }] }`, at most `limit`
 * (1–30, 10 when left out). No record yet is `items: []`.
 */

interface Ctx {
    request: Request;
    env: DevEnv;
}

export interface DevItem {
    entry: string;
    at: string;
    by: 'chat' | 'desk';
    kind: string;
    text: string;
    re?: string;
}

/** The operator's requests, and the desk's readings, answers, findings and questions. */
export function devItems(entries: readonly NotebookEntry[]): DevItem[] {
    const out: DevItem[] = [];
    for (const e of entries) {
        const b = e.body;
        const mine = e.by === 'chat' && b.kind === 'ask' && b.to === 'desk';
        const desk = e.by === 'desk' && (b.kind === 'read' || b.kind === 'answer' || b.kind === 'ask' || b.kind === 'fact');
        if (!mine && !desk) continue;
        if (!('text' in b)) continue;
        const re = 're' in b && typeof b.re === 'string' ? b.re : undefined;
        out.push({ entry: e.id, at: new Date(e.at).toISOString(), by: e.by as 'chat' | 'desk', kind: b.kind, text: b.text, ...(re ? { re } : {}) });
    }
    return out.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}

export const onRequestGet = async (ctx: Ctx): Promise<Response> => {
    const auth = await verifyDevTicket(ctx.env, ctx.request.headers.get('authorization'));
    if ('error' in auth) return json({ error: auth.error }, auth.status);
    const raw = Number(new URL(ctx.request.url).searchParams.get('limit') ?? 10);
    const limit = Number.isFinite(raw) ? Math.min(30, Math.max(1, Math.round(raw))) : 10;
    const record = await devRecordOf(auth.owner);
    const entries = await recordEntries(ctx.env.RUNS_DB, auth.owner, record);
    return json({ record, items: devItems(entries).slice(0, limit) });
};

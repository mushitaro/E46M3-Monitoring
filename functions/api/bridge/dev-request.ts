import { json } from '../../_owner-gate/owner';
import { devRecordOf, verifyDevTicket, type DevEnv } from '../../_lib/devTicket';
import { insertEntries, recordEntries } from '../../_lib/investigation';
import { wakeDesk, type WakeEnv } from '../../_lib/wake';
import { addProblem, NOTEBOOK_LIMITS, type NotebookEntry } from '../../../src/lib/notebook/rules';
import { standingMandates } from '../../../src/lib/investigation/share';

/**
 * POST /api/bridge/dev-request — the operator's words for the development desk, from the relay
 * (TSUNAGI///Matrix `monitoring_dev_request`), when MONITORING WORKS is not open to carry them.
 *
 * Not behind the owner gate's cookie (functions/_middleware.ts lets /api/bridge/dev-* through): the
 * relay's own ticket says who is asking (functions/_lib/devTicket.ts), and only the accounts in
 * DEV_REQUEST_OWNERS are let in.
 *
 * Body `{ words, context? }`: the operator's words as said, and what the assistant adds (which
 * screen, what happened, when). They go into one CO-WORK record per owner — the same place the desk
 * already reads (workers/desk) — as an `ask` to the desk, written by `chat`. The desk reads a record
 * only while a mandate stands, so the first request (and the first after thirty days) also writes
 * one, by `owner`, in the request's own words, for no module (`none`): the desk may read and answer
 * this record, and no plan in it can read anything from the car. Then the desk is woken.
 *
 * 200 `{ record, entry, at, say }`; 400 `{ error: 'words' | 'context' | 'body' }`; 401/403/503 from
 * the ticket.
 */

type Env = DevEnv & WakeEnv;
interface Ctx {
    request: Request;
    env: Env;
    waitUntil?(p: Promise<unknown>): void;
}

const MAX = NOTEBOOK_LIMITS.text;
const SEP = '\n\n（補足）';
const CUT = '…（以下略）';

const newId = (prefix: string) => `${prefix}-${[...crypto.getRandomValues(new Uint8Array(9))].map((b) => b.toString(16).padStart(2, '0')).join('')}`;

/** The ask's text: the words whole, and as much of the assistant's context as fits after them. */
export function askText(words: string, context: string | null): string {
    if (!context) return words;
    const room = MAX - words.length - SEP.length;
    if (room <= CUT.length) return words;
    return words + SEP + (context.length <= room ? context : context.slice(0, room - CUT.length) + CUT);
}

export const onRequestPost = async (ctx: Ctx): Promise<Response> => {
    const auth = await verifyDevTicket(ctx.env, ctx.request.headers.get('authorization'));
    if ('error' in auth) return json({ error: auth.error }, auth.status);

    let body: { words?: unknown; context?: unknown };
    try {
        body = (await ctx.request.json()) as typeof body;
    } catch {
        return json({ error: 'body' }, 400);
    }
    const words = typeof body?.words === 'string' ? body.words.trim() : '';
    if (!words || words.length > MAX) return json({ error: 'words' }, 400);
    if (body.context !== undefined && (typeof body.context !== 'string' || body.context.length > MAX)) return json({ error: 'context' }, 400);
    const context = typeof body.context === 'string' && body.context.trim() ? body.context.trim() : null;

    const owner = auth.owner;
    const record = await devRecordOf(owner);
    const now = Date.now();
    const existing = await recordEntries(ctx.env.RUNS_DB, owner, record);

    const toWrite: NotebookEntry[] = [];
    if (standingMandates(existing, now).length === 0) {
        toWrite.push({
            id: newId('dev-mandate'),
            sessionId: record,
            at: now,
            by: 'owner',
            body: { kind: 'mandate', words, modules: ['none'], until: now + NOTEBOOK_LIMITS.mandateMs },
        });
    }
    const ask: NotebookEntry = { id: newId('dev-ask'), sessionId: record, at: now + 1, by: 'chat', body: { kind: 'ask', to: 'desk', text: askText(words, context) } };
    toWrite.push(ask);

    let sofar = existing;
    for (const e of toWrite) {
        const problem = addProblem(e, sofar);
        // The entries are this route's own; a refusal is a bug here, not the caller's.
        if (problem) return json({ error: 'refused', reason: problem }, 500);
        sofar = [...sofar, e];
    }
    const taken = await insertEntries(ctx.env.RUNS_DB, owner, toWrite, now);
    if (taken.length > 0) return json({ error: 'refused', reason: 'id_taken' }, 500);

    // Awaited, not left to waitUntil: what the operator is told depends on it. It never throws.
    const woke = await wakeDesk(ctx.env, owner, record, 'dev-request', now);
    const say =
        woke === 'fired'
            ? '開発に送りました。机をいま起こしたので、少しすると読みます。返事は同じところに付きます。'
            : '開発に送りました。次の自律ループの回で読みます。返事は同じところに付きます。';
    return json({ record, entry: ask.id, at: new Date(ask.at).toISOString(), say });
};

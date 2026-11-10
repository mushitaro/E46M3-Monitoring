import { json } from '../../_owner-gate/owner';
import { deliveryProblem, askTextOf, redactReport, type EngineReportDelivery } from '../../_lib/engineReport';
import { verifyEngineReportTicket, type EngineReportEnv } from '../../_lib/engineReportTicket';
import { insertEntries, recordEntries } from '../../_lib/investigation';
import { wakeDesk, type WakeEnv } from '../../_lib/wake';
import { addProblem, NOTEBOOK_LIMITS, type NotebookEntry } from '../../../src/lib/notebook/rules';
import { standingMandates } from '../../../src/lib/investigation/share';

/**
 * POST /api/bridge/engine-report — a Mainstay's diagnostic-engine error, for the desk
 * (operator, 2026-11-11: 「エンジンのエラーは Cloudflare 経由で運営者に届き、運営者の Claude Code の
 * 自律ループが受けて直す」).
 *
 * A store runs this repository's diagnostic engine in its own app — GREN BLUE SUITE is the first —
 * and its server sends what the engine could not handle: a telegram a module refused, an answer the
 * engine cannot read, a fault with no text, an exception. Redacted by the store, checked and redacted
 * again here (functions/_lib/engineReport.ts). Not behind the owner gate (functions/_middleware.ts
 * lets this one exact path through): a store's server has no owner cookie, so the store's own
 * one-time ticket says who is sending (functions/_lib/engineReportTicket.ts).
 *
 * Where it goes: one CO-WORK record per store, `eng-<SHA-256(store) first 16 hex>`, under the owner
 * `mainstay:<store>`. A new kind of error (a new fingerprint), or one still happening a week after the
 * desk was last asked, becomes an `ask` to the desk written by `chat`, with the store and the entrance
 * named; then the desk is woken. A repeat inside the week only updates the count. The desk reads a
 * record only while a mandate stands, so one is kept standing — by `owner`, in the operator's own
 * decision, for no module (`none`): the desk may read and answer this record, and no plan in it can
 * read anything from any car.
 *
 * 200 `{ received: true, record, asked: entry id | null, duplicate }`; 400 `{ error }` for a body
 * this side does not accept; 401/503 from the ticket.
 */

type Env = EngineReportEnv & WakeEnv;
interface Ctx {
    request: Request;
    env: Env;
}

/** The same error, still happening, is put to the desk again after this long. */
export const ASK_AGAIN_MS = 7 * 24 * 60 * 60 * 1000;
/** The largest body a store sends is far below this. */
const MAX_BODY = 16_000;

/** The operator's decision, as the standing mandate's words. */
export const MANDATE_WORDS = (mainstay: string, entrance: string) =>
    `診断エンジンのエラーは Cloudflare 経由で運営者に届き、運営者の Claude Code の自律ループが受けて直す（運営者、2026-11-11）。店: ${mainstay}・入口: ${entrance}。この記録は車から何も読まない。`;

export async function engineRecordOf(mainstay: string): Promise<string> {
    const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(mainstay)));
    return `eng-${[...h.slice(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

const newId = (prefix: string) => `${prefix}-${[...crypto.getRandomValues(new Uint8Array(9))].map((b) => b.toString(16).padStart(2, '0')).join('')}`;

interface Row {
    total: number;
    last_delivery: string;
    ask_entry: string | null;
    asked_at: number | null;
}

export const onRequestPost = async (ctx: Ctx): Promise<Response> => {
    const raw = await ctx.request.text();
    if (raw.length > MAX_BODY) return json({ error: 'body' }, 400);
    const auth = await verifyEngineReportTicket(ctx.env, ctx.request.headers.get('authorization'), raw);
    if ('error' in auth) return json({ error: auth.error }, auth.status);

    let body: unknown;
    try {
        body = JSON.parse(raw);
    } catch {
        return json({ error: 'body' }, 400);
    }
    const problem = deliveryProblem(body, auth.mainstay);
    if (problem) return json({ error: 'report', field: problem }, 400);
    const d = body as EngineReportDelivery;
    const report = redactReport(d.report);

    const db = ctx.env.RUNS_DB;
    const owner = `mainstay:${d.mainstay}`;
    const record = await engineRecordOf(d.mainstay);
    const now = Date.now();

    const prev = await db
        .prepare('SELECT total, last_delivery, ask_entry, asked_at FROM monitoring_engine_reports WHERE mainstay = ? AND fingerprint = ?')
        .bind(d.mainstay, d.fingerprint)
        .first<Row>();
    // The same delivery again (the store did not hear our answer): already counted.
    if (prev && prev.last_delivery === d.delivery) return json({ received: true, record, asked: null, duplicate: true });

    const askDue = !prev || prev.asked_at === null || now - prev.asked_at >= ASK_AGAIN_MS;
    let asked: string | null = null;
    if (askDue) {
        const existing = await recordEntries(db, owner, record);
        const toWrite: NotebookEntry[] = [];
        if (standingMandates(existing, now).length === 0) {
            toWrite.push({
                id: newId('eng-mandate'),
                sessionId: record,
                at: now,
                by: 'owner',
                body: { kind: 'mandate', words: MANDATE_WORDS(d.mainstay, d.entrance), modules: ['none'], until: now + NOTEBOOK_LIMITS.mandateMs },
            });
        }
        const ask: NotebookEntry = {
            id: newId('eng-ask'),
            sessionId: record,
            at: now + 1,
            by: 'chat',
            body: { kind: 'ask', to: 'desk', text: askTextOf(d, report, prev !== null, NOTEBOOK_LIMITS.text) },
        };
        toWrite.push(ask);
        let sofar = existing;
        for (const e of toWrite) {
            const refused = addProblem(e, sofar);
            // The entries are this route's own; a refusal is a bug here, not the store's.
            if (refused) return json({ error: 'refused', reason: refused }, 500);
            sofar = [...sofar, e];
        }
        const taken = await insertEntries(db, owner, toWrite, now);
        if (taken.length > 0) return json({ error: 'refused', reason: 'id_taken' }, 500);
        asked = ask.id;
    }

    await db
        .prepare(
            `INSERT INTO monitoring_engine_reports
               (mainstay, fingerprint, entrance, kind, report, total, first_seen, last_seen, last_delivery, received_at, record, ask_entry, asked_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
             ON CONFLICT(mainstay, fingerprint) DO UPDATE SET
               entrance = excluded.entrance, report = excluded.report, total = MAX(monitoring_engine_reports.total, excluded.total),
               last_seen = excluded.last_seen, last_delivery = excluded.last_delivery, received_at = excluded.received_at,
               ask_entry = COALESCE(excluded.ask_entry, monitoring_engine_reports.ask_entry),
               asked_at = COALESCE(excluded.asked_at, monitoring_engine_reports.asked_at)`,
        )
        .bind(d.mainstay, d.fingerprint, d.entrance, report.kind, JSON.stringify(report), d.total, d.firstSeen, d.lastSeen, d.delivery, now, record, asked, asked ? now : null)
        .run();

    // Awaited: the store's server is the caller, and nothing is waiting on it but its own retry.
    // wakeDesk never throws and keeps its own limits (ten minutes a record, twenty an hour).
    if (asked) await wakeDesk(ctx.env, owner, record, 'engine-report', now);
    return json({ received: true, record, asked, duplicate: false });
};

/**
 * POST /inbox/engine-report — a Mainstay's diagnostic-engine error, handed to this desk by M's
 * platform (operator, 2026-11-11: 「エンジンのエラーは Cloudflare 経由で運営者に届き、運営者の Claude Code の
 * 自律ループが受けて直す」; 2026-11-12: the engine door is M's platform, the desk stays with the engine).
 *
 * A store runs this repository's diagnostic engine in its own app — GREN BLUE SUITE is the first —
 * and its server sends what the engine could not handle (a telegram a module refused, an answer the
 * engine cannot read, a fault with no text, an exception) to the platform's engine door,
 * `POST /engine/report` on M's platform (tsunagi-m-platform services/engine). The door checks the
 * store's ticket and the shape, redacts, counts by fingerprint and keeps the report in its inbox;
 * then it hands it on to here, one request per report, with its own ticket (./platformTicket.ts).
 * If this desk is down the door keeps the report and tries again; nothing is lost here.
 *
 * This route replaces the receiving half of workers/engine-gateway (never deployed). What it does
 * with a report is what the gateway did, unchanged: it does not take the door's redaction on trust —
 * the shape is checked again field by field, and the desk's own redaction (the engine's redact.ts)
 * runs over it before anything is stored (./engineReport.ts).
 *
 * Where it goes: one CO-WORK record per store, `eng-<SHA-256(store) first 16 hex>`, under the owner
 * `mainstay:<store>`. A new kind of error (a new fingerprint), or one still happening a week after the
 * desk was last asked, becomes an `ask` to the desk written by `chat`, with the store and the entrance
 * named; then the desk is woken. A repeat inside the week only updates the count. The desk reads a
 * record only while a mandate stands, so one is kept standing — by `owner`, in the operator's own
 * decision, for no module (`none`): the desk may read and answer this record, and no plan in it can
 * read anything from any car.
 *
 * The store named in a delivery is believed because the platform's ticket holds: the door let that
 * store's own key vouch for it. An entrance (`suite`, `suite-demo`) is one of a store's own apps, and
 * counts for itself.
 *
 * 200 `{ received: true, record, asked: entry id | null, duplicate }`; 400 `{ error: 'report', field }`
 * for a body this side does not accept (the door then holds the report for the operator); 401/503
 * from the ticket.
 */
import { deliveryProblem, askTextOf, redactReport, type EngineReportDelivery } from './engineReport';
import { json } from './door';
import { verifyPlatformTicket, type PlatformTicketEnv } from './platformTicket';
import { insertEntries, recordEntries } from '../../../functions/_lib/investigation';
import { wakeDesk, type WakeEnv } from '../../../functions/_lib/wake';
import { addProblem, NOTEBOOK_LIMITS, type NotebookEntry } from '../../../src/lib/notebook/rules';
import { standingMandates } from '../../../src/lib/investigation/share';

export type InboxEnv = PlatformTicketEnv & WakeEnv;

export const INBOX_PATH = '/inbox/engine-report';
/** The same error, still happening, is put to the desk again after this long. */
export const ASK_AGAIN_MS = 7 * 24 * 60 * 60 * 1000;
/** The largest body the door sends is far below this (the platform contract's ENGINE_REPORT_MAX_BYTES). */
const MAX_BODY = 16_000;
const SLUG = /^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$/;

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
}

export async function engineReportInbox(request: Request, env: InboxEnv): Promise<Response> {
    const url = new URL(request.url);
    const raw = await request.text();
    if (raw.length > MAX_BODY) return json({ error: 'body' }, 400);
    const auth = await verifyPlatformTicket(env, request.headers.get('authorization'), { method: 'POST', pathAndQuery: url.pathname + url.search, body: raw });
    if (!auth.ok) return json({ error: auth.error }, auth.status);

    let body: unknown;
    try {
        body = JSON.parse(raw);
    } catch {
        return json({ error: 'body' }, 400);
    }
    const named = (body as { mainstay?: unknown } | null)?.mainstay;
    if (typeof named !== 'string' || !SLUG.test(named)) return json({ error: 'report', field: 'mainstay' }, 400);
    const problem = deliveryProblem(body, named);
    if (problem) return json({ error: 'report', field: problem }, 400);
    const d = body as EngineReportDelivery;
    const report = redactReport(d.report);

    const db = env.RUNS_DB;
    const owner = `mainstay:${d.mainstay}`;
    const record = await engineRecordOf(d.mainstay);
    const now = Date.now();

    const prev = await db
        .prepare('SELECT total, last_delivery FROM monitoring_engine_reports WHERE mainstay = ? AND entrance = ? AND fingerprint = ?')
        .bind(d.mainstay, d.entrance, d.fingerprint)
        .first<Row>();
    // The same delivery again (the door did not hear our answer): already counted.
    if (prev && prev.last_delivery === d.delivery) return json({ received: true, record, asked: null, duplicate: true });

    // One question per kind of error per store, whichever of its entrances it came from.
    const asked_ = await db
        .prepare('SELECT MAX(asked_at) AS at FROM monitoring_engine_reports WHERE mainstay = ? AND fingerprint = ?')
        .bind(d.mainstay, d.fingerprint)
        .first<{ at: number | null }>();
    const lastAsked = asked_?.at ?? null;
    const askDue = lastAsked === null || now - lastAsked >= ASK_AGAIN_MS;
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
            body: { kind: 'ask', to: 'desk', text: askTextOf(d, report, lastAsked !== null, NOTEBOOK_LIMITS.text) },
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
               (mainstay, entrance, fingerprint, kind, report, total, first_seen, last_seen, last_delivery, received_at, record, ask_entry, asked_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
             ON CONFLICT(mainstay, entrance, fingerprint) DO UPDATE SET
               report = excluded.report, total = MAX(monitoring_engine_reports.total, excluded.total),
               last_seen = excluded.last_seen, last_delivery = excluded.last_delivery, received_at = excluded.received_at,
               ask_entry = COALESCE(excluded.ask_entry, monitoring_engine_reports.ask_entry),
               asked_at = COALESCE(excluded.asked_at, monitoring_engine_reports.asked_at)`,
        )
        .bind(d.mainstay, d.entrance, d.fingerprint, report.kind, JSON.stringify(report), d.total, d.firstSeen, d.lastSeen, d.delivery, now, record, asked, asked ? now : null)
        .run();

    // Awaited: the platform's door is the caller, and nothing is waiting on it but its own retry.
    // wakeDesk never throws and keeps its own limits (ten minutes a record, twenty an hour).
    if (asked) await wakeDesk(env, owner, record, 'engine-report', now);
    return json({ received: true, record, asked, duplicate: false });
}

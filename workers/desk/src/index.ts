/**
 * monitoring-desk — the operator's development environment's one door into what owners handed over.
 *
 * The policy (m3 /privacy-policy#preview, 「調査の委任」) lets the operator's development environment
 * read an investigation an owner handed over — its CO-WORK record, its read records, the data PROBE
 * took — add plans and findings to it, and read nothing that was not handed over. This Worker is
 * that sentence as a program, bound to the same D1 as the WORKS build (tsunagi-m-preview-runs):
 *
 *   - **Who.** A bearer token, kept only as its SHA-256 in monitoring_desk_tokens, each with an
 *     expiry and a revocation date (scripts/desk-token.mjs). No token, no answer.
 *   - **What it reads.** A record only while a mandate in it stands now; of the owner's read records,
 *     only those inside the windows its mandates cover, for the modules they name
 *     (lib/investigation/share). Never the owner's id, never a session, never an error record.
 *   - **No VIN.** Every entry, read and run passes lib/investigation/redact on its way out.
 *   - **What it writes.** Entries as `desk`, on the server's clock, through the same rules as the
 *     tab (lib/notebook/rules) and the desk's own (`deskProblem`): plans inside the mandate,
 *     findings, questions. Never a mandate, a note, or a change to what is there — entries are only
 *     added. All of a call's entries or none.
 *   - **On record.** Every call answered leaves a row in monitoring_desk_audit, written before the
 *     answer goes.
 *
 * This file is MONITORING's own part — what a mandate covers, what is withheld, what may be written.
 * Who may call, the audit row and the answer's shape are door.ts, which every app's desk shares.
 *
 * Routes:
 *   GET  /investigations                        the records whose mandate stands
 *   GET  /investigations/:record                its entries, runs (listed) and read records
 *   GET  /investigations/:record/runs/:n        one run, with its samples and exchanges
 *   POST /investigations/:record/entries        `{ entries: [{ body }] }`, written as the desk
 */
import { insertEntries, recordEntries } from '../../../functions/_lib/investigation';
import { blobBytes, type D1Database } from '../../../functions/_lib/sync';
import { openAsks, type NotebookBody, type NotebookEntry } from '../../../src/lib/notebook/rules';
import { redactDeep, redactResponse, redactRun, redactText } from '../../../src/lib/investigation/redact';
import { delegatedWindows, deskProblem, standingMandates } from '../../../src/lib/investigation/share';
import { audit, gunzipJson, json, tokenOf, type DeskTables } from './door';

export { sha256Hex } from './door';

export interface Env {
    RUNS_DB: D1Database;
}

const MAX_WRITE = 20;
const MAX_READS = 2000;
const TABLES: DeskTables = { tokens: 'monitoring_desk_tokens', audit: 'monitoring_desk_audit' };

/**
 * The owner a record belongs to — the desk never says it, but every query needs it. A record id the
 * tab minted is a UUID; one found under two owners is not one investigation, and is not served.
 */
async function ownerOfRecord(db: D1Database, record: string): Promise<string | null> {
    const { results } = await db.prepare('SELECT DISTINCT owner FROM monitoring_notebook WHERE record = ? LIMIT 2').bind(record).all<{ owner: string }>();
    return results.length === 1 ? results[0].owner : null;
}

/** The record, if a mandate in it stands now; otherwise null, the same as a record that is not there. */
async function delegated(db: D1Database, record: string, now: number): Promise<{ owner: string; entries: NotebookEntry[] } | null> {
    const owner = await ownerOfRecord(db, record);
    if (!owner) return null;
    const entries = await recordEntries(db, owner, record);
    return standingMandates(entries, now).length > 0 ? { owner, entries } : null;
}

const RECORD = /^[A-Za-z0-9_-]{8,64}$/;

async function list(db: D1Database, now: number) {
    const { results } = await db
        .prepare("SELECT DISTINCT record FROM monitoring_notebook WHERE kind = 'mandate' AND at <= ? ORDER BY record")
        .bind(now)
        .all<{ record: string }>();
    const out = [];
    for (const { record } of results) {
        const d = await delegated(db, record, now);
        if (!d) continue;
        const runs = await db.prepare('SELECT COUNT(*) AS n FROM monitoring_runs WHERE owner = ? AND record = ?').bind(d.owner, record).first<{ n: number }>();
        out.push({
            record,
            mandates: standingMandates(d.entries, now).map((m) => ({ id: m.id, at: m.at, words: redactText(m.body.words), modules: m.body.modules, until: m.body.until })),
            entries: d.entries.length,
            lastAt: d.entries.at(-1)?.at ?? null,
            openAsks: openAsks(d.entries).length,
            runs: runs?.n ?? 0,
        });
    }
    return out;
}

async function investigation(db: D1Database, d: { owner: string; entries: NotebookEntry[] }, record: string, now: number) {
    const { results: runs } = await db
        .prepare('SELECT n, plan_v, started_at, ended_at, end_reason, sample_count, mock, app_build FROM monitoring_runs WHERE owner = ? AND record = ? ORDER BY n')
        .bind(d.owner, record)
        .all();
    const reads: Record<string, unknown>[] = [];
    let truncated = false;
    for (const w of delegatedWindows(d.entries, now)) {
        const { results } = await db
            .prepare(
                'SELECT at, module, job, request, response, outcome, reason, speed_kmh, motion, app_build FROM monitoring_reads WHERE owner = ? AND at >= ? AND at <= ? ORDER BY at LIMIT ?',
            )
            .bind(d.owner, w.from, w.to, MAX_READS + 1)
            .all<{ module: string; job: string; response: string | null; reason: string | null }>();
        for (const r of results) {
            if (w.modules.length > 0 && !w.modules.includes(r.module)) continue;
            if (reads.length >= MAX_READS) {
                truncated = true;
                break;
            }
            const red = redactResponse(r.job, r.response);
            reads.push({ ...r, response: red.response, reason: r.reason === null ? null : redactText(r.reason), ...(red.note ? { redacted: red.note } : {}) });
        }
    }
    return { record, entries: redactDeep(d.entries), runs, reads, readsTruncated: truncated };
}

async function oneRun(db: D1Database, owner: string, record: string, n: number) {
    const row = await db.prepare('SELECT run_gz FROM monitoring_runs WHERE owner = ? AND record = ? AND n = ? ORDER BY ended_at DESC LIMIT 1').bind(owner, record, n).first<{ run_gz: unknown }>();
    const bytes = row ? blobBytes(row.run_gz) : null;
    return bytes ? redactRun((await gunzipJson(bytes)) as { exchanges?: { what: string; response: string | null }[] }) : null;
}

async function write(db: D1Database, d: { owner: string; entries: NotebookEntry[] }, record: string, now: number, body: unknown) {
    const items = (body as { entries?: unknown })?.entries;
    if (!Array.isArray(items) || items.length === 0 || items.length > MAX_WRITE) return { status: 400, body: { error: `entries must be 1-${MAX_WRITE} items of { body }.` } };
    const accepted: NotebookEntry[] = [];
    for (const [i, item] of items.entries()) {
        const e: NotebookEntry = { id: `desk-${crypto.randomUUID()}`, sessionId: record, at: now + i, by: 'desk', body: (item as { body?: NotebookBody })?.body as NotebookBody };
        const problem = deskProblem(e, [...d.entries, ...accepted]);
        if (problem) return { status: 422, body: { error: 'refused', index: i, reason: problem, written: 0 } };
        accepted.push(e);
    }
    await insertEntries(db, d.owner, accepted, now);
    return { status: 200, body: { written: accepted.length, ids: accepted.map((e) => e.id) } };
}

/** The whole Worker, with its clock passed in so a test can hold it still. */
export async function handle(request: Request, env: Env, now = Date.now()): Promise<Response> {
    const db = env.RUNS_DB;
    const token = await tokenOf(request, db, TABLES, now);
    if (!token) return json({ error: 'unauthorized' }, 401);

    const parts = new URL(request.url).pathname.split('/').filter(Boolean);
    if (parts[0] !== 'investigations' || parts.length > 4) return json({ error: 'not_found' }, 404);

    if (parts.length === 1 && request.method === 'GET') {
        const out = await list(db, now);
        await audit(db, TABLES, now, token, 'list', null, { records: out.length });
        return json({ investigations: out });
    }

    const record = parts[1];
    if (!RECORD.test(record)) return json({ error: 'not_found' }, 404);
    const d = await delegated(db, record, now);
    if (!d) {
        await audit(db, TABLES, now, token, 'refused', record, { reason: 'not delegated now' });
        return json({ error: 'not_delegated', reason: 'No mandate of this record stands now; the desk reads only an investigation handed over.' }, 404);
    }

    if (parts.length === 2 && request.method === 'GET') {
        const out = await investigation(db, d, record, now);
        await audit(db, TABLES, now, token, 'read', record, { entries: out.entries.length, runs: out.runs.length, reads: out.reads.length });
        return json(out);
    }
    if (parts.length === 4 && parts[2] === 'runs' && request.method === 'GET') {
        const n = Number(parts[3]);
        if (!Number.isInteger(n) || n < 1) return json({ error: 'not_found' }, 404);
        const run = await oneRun(db, d.owner, record, n);
        await audit(db, TABLES, now, token, 'run', record, { n, found: run !== null });
        return run ? json(run) : json({ error: 'not_found' }, 404);
    }
    if (parts.length === 3 && parts[2] === 'entries' && request.method === 'POST') {
        let body: unknown;
        try {
            body = await request.json();
        } catch {
            return json({ error: 'Body is not JSON.' }, 400);
        }
        const r = await write(db, d, record, now, body);
        await audit(db, TABLES, now, token, r.status === 200 ? 'write' : 'write-refused', record, r.status === 200 ? { ids: (r.body as { ids: string[] }).ids } : r.body);
        return json(r.body, r.status);
    }
    return json({ error: 'not_found' }, 404);
}

const worker = {
    fetch: (request: Request, env: Env): Promise<Response> => handle(request, env),
};

export default worker;

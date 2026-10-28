/**
 * Waking the desk the moment an owner hands something over (operator, 2026-10-28: "頼んだら、すぐ
 * 直し始める"). The scheduled loop used to be the only way in, every three hours; now a delegated
 * investigation that asks something of the loop fires the loop's scheduled task at once, through
 * its API trigger (POST /v1/claude_code/routines/{id}/fire).
 *
 * What goes is the record id and why — nothing the owner said, nothing read from the car. The loop
 * reads the rest through the desk (workers/desk), the only door that knows what a mandate covers
 * and keeps the VIN out. E46M3-Monitoring is public; nothing here reaches it either.
 *
 * Off until both are set on the Pages project: LOOP_TRIGGER_ID (wrangler.jsonc vars) and
 * LOOP_FIRE_TOKEN (a Pages secret: the task's own API-trigger token, which can fire that one task
 * and read nothing). Never throws, and never holds up the request that stored the record: the
 * route hands the promise to waitUntil.
 */
import type { NotebookEntry } from '../../src/lib/notebook/rules';
import type { D1Database } from './sync';

export interface WakeEnv {
    RUNS_DB: D1Database;
    LOOP_TRIGGER_ID?: string;
    LOOP_FIRE_TOKEN?: string;
}

/** A record wakes the loop at most this often. */
export const WAKE_EVERY_MS = 10 * 60_000;
/** And the account at most this many times an hour (the task itself takes 30 API fires an hour). */
export const WAKES_PER_HOUR = 20;

const FIRE_URL = (id: string) => `https://api.anthropic.com/v1/claude_code/routines/${encodeURIComponent(id)}/fire`;

/**
 * Whether an entry asks something of the loop: a mandate given (an investigation handed over), a
 * question put to the desk, or the owner's answer to a question the desk or the assistant asked.
 * A note or a reading waits for the next turn the loop takes anyway.
 */
export function wakeWorthy(e: NotebookEntry, record: readonly NotebookEntry[]): boolean {
    const b = e.body;
    if (b.kind === 'mandate') return true;
    if (b.kind === 'ask') return b.to === 'desk';
    if (b.kind === 'answer') return record.some((x) => x.id === b.re && x.body.kind === 'ask' && x.by !== 'driver' && x.by !== 'owner');
    return false;
}

export type WakeResult = 'fired' | 'recent' | 'off' | 'failed';

/** Fire the loop for one record, unless it was fired for it lately or the hour's share is spent. */
export async function wakeDesk(env: WakeEnv, owner: string, record: string, reason: string, now = Date.now(), fetchImpl: typeof fetch = fetch): Promise<WakeResult> {
    if (!env.LOOP_TRIGGER_ID || !env.LOOP_FIRE_TOKEN) return 'off';
    try {
        const hour = await env.RUNS_DB.prepare('SELECT COUNT(*) AS n FROM monitoring_wake WHERE last_fired > ?').bind(now - 3_600_000).first<{ n: number }>();
        if ((hour?.n ?? 0) >= WAKES_PER_HOUR) return 'recent';
        const claim = await env.RUNS_DB.prepare(`
            INSERT INTO monitoring_wake (record, owner, last_fired, reason) VALUES (?,?,?,?)
            ON CONFLICT(record) DO UPDATE SET last_fired = excluded.last_fired, reason = excluded.reason
            WHERE monitoring_wake.owner = excluded.owner AND monitoring_wake.last_fired <= ?
        `).bind(record, owner, now, reason, now - WAKE_EVERY_MS).run();
        if (claim.meta.changes === 0) return 'recent';
        const r = await fetchImpl(FIRE_URL(env.LOOP_TRIGGER_ID), {
            method: 'POST',
            headers: {
                authorization: `Bearer ${env.LOOP_FIRE_TOKEN}`,
                'anthropic-version': '2023-06-01',
                'anthropic-beta': 'experimental-cc-routine-2026-04-01',
                'content-type': 'application/json',
            },
            body: JSON.stringify({ text: `MONITORING record ${record}: ${reason}` }),
        });
        return r.ok ? 'fired' : 'failed';
    } catch {
        return 'failed';
    }
}

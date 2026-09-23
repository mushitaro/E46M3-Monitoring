/**
 * Error records: sent by the app itself, the moment an operation fails.
 *
 * The opposite of a session in every respect that matters. A session goes up because the owner
 * pressed SYNC; a failure is worth most at the instant it happens, is small, and is exactly the
 * thing nobody saves — a read that failed produces no session worth keeping. So this is automatic,
 * best-effort and silent:
 *
 *   - it never throws into the caller, and it never awaits on the caller's path — the operation it
 *     describes has already failed, and a report about it must not become a second failure;
 *   - a record that cannot be sent (offline, the session expired, the server down) goes into a small
 *     outbox in IndexedDB and is sent after the next send that succeeds;
 *   - a failed CONNECT is recorded too, with no identity and no payload: the failures that never
 *     got as far as a response are the ones most worth reading, and returning early when there was
 *     no report is how those used to leave no trace at all.
 *
 * Each record carries the ECU, what was attempted, the error text and its classification, the
 * transport, the build id and the PRACTICE flag — a list mixing simulated failures with real ones
 * would be worse than no list.
 *
 * Preview only: `canSync()` is false in production and under `next dev`, and then this does
 * nothing at all — no request, no IndexedDB.
 */
import { api, gzipB64, outbox } from './owner-sync';
import { canSync } from './cloud';

const box = outbox('monitoring-outbox');

export interface FailureReport {
    ecu: string;
    job: string;
    error: string;
    errorKind: string | null;
    transport: string | null;
    mock: boolean;
    ident: { hex: string; length: number } | null;
    /** Comms-log lines up to and including the failure (lib/sync/session.ts `excerpt`). */
    excerpt: string[];
}

/** The build this record came from, as build-id.mjs stamped it. */
function appBuild(): string | null {
    return document.querySelector('meta[name="build-id"]')?.getAttribute('content') ?? null;
}

/**
 * Sent, or not worth sending again. A 400/409/413 will be refused the same way every time, so it
 * leaves the queue rather than blocking every record behind it; only "could not reach it" and
 * "not signed in" keep it waiting.
 */
async function send(body: unknown): Promise<boolean> {
    const r = await api('/api/diagnostics', { method: 'POST', body });
    if (r.ok) return true;
    return r.status === 400 || r.status === 409 || r.status === 413;
}

/** Fire and forget. Returns immediately; nothing it does can reach the caller. */
export function reportFailure(report: FailureReport): void {
    if (!canSync()) return;
    void (async () => {
        try {
            const body = {
                id: crypto.randomUUID(),
                createdAt: Date.now(),
                ecu: report.ecu,
                job: report.job,
                error: report.error,
                errorKind: report.errorKind,
                transport: report.transport,
                mock: report.mock,
                appBuild: appBuild(),
                payloadGz: await gzipB64(JSON.stringify({ ident: report.ident, excerpt: report.excerpt })),
            };
            if (await send(body)) await box.flush(send);
            else await box.add(body);
        } catch {
            // Nowhere to put it. The operation already failed; this must not add a second failure.
        }
    })();
}

/** Send whatever is waiting — after a SYNC went through, say. Never throws. */
export async function flushErrorRecords(): Promise<number> {
    if (!canSync()) return 0;
    return box.flush(send);
}

/** How many records are waiting on this device. */
export function waitingErrorRecords(): Promise<number> {
    if (!canSync()) return Promise.resolve(0);
    return box.count();
}

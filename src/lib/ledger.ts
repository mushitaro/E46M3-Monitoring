/**
 * The verified ledger, and the kill switch that revokes from it.
 *
 * Every number this app can display is currently a candidate: live-value
 * offsets and scaling come from a decompiled catalog, request telegrams from a
 * static scrape of SGBD bytecode. Neither has been confirmed against a car.
 *
 * The old PWA encoded that as `verified: false` hardcoded in a source file,
 * which meant the flag could only ever be flipped for ALL 131 jobs at once, by
 * editing code. That is the wrong shape twice over: verification is per-job and
 * it is EVIDENCE, so it belongs in data, next to the evidence.
 *
 * Nothing in this module gates a write today, because the app has no write
 * paths. It exists first so that the answer to "may this run on a car?" is
 * already a lookup by the time there is something to ask it about — retrofitting
 * a gate around code that already runs is how gates end up with holes.
 */

export type VerificationStatus =
    /** Never confirmed against a vehicle. The default, and where everything is now. */
    | 'candidate'
    /** Confirmed on a vehicle, with evidence recorded. */
    | 'verified'
    /** Tried on a vehicle and found wrong. Kept, so nobody re-derives it. */
    | 'refuted'
    /** Withdrawn centrally. Overrides `verified` — see the kill switch below. */
    | 'revoked';

export interface VerificationRecord {
    /** `${ecuId}:${jobOrChannel}` — the thing being vouched for. */
    id: string;
    status: VerificationStatus;
    /** ISO 8601. Absolute, never relative — a ledger outlives the session. */
    verifiedAt?: string;
    /** Which ECU it was proven against: ZB and software number. */
    ecuZb?: string;
    ecuSw?: string;
    /** The exact bytes sent, so a later change to the generator is detectable. */
    telegram?: string;
    /** What came back, verbatim. */
    observedResponse?: string;
    /** What the operator saw happen, in their words. Irreplaceable for actuators. */
    observedBehavior?: string;
    /** Why it was refuted or revoked. Required for those states. */
    reason?: string;
}

export interface Ledger {
    version: number;
    records: Record<string, VerificationRecord>;
}

export const EMPTY_LEDGER: Ledger = { version: 1, records: {} };

/**
 * A centrally-published list of ids that must not run, whatever the ledger says.
 *
 * This is the piece that has to exist BEFORE any automated fix pipeline does.
 * An auto-generated patch that gets a job definition wrong reaches every user on
 * the next deploy; without a revocation path the only remedy is another deploy,
 * and the window between them is spent on real cars. With one, a bad definition
 * is withdrawn in minutes.
 *
 * Deliberately additive-only in effect: a kill list can revoke, never grant.
 * A compromised or simply stale list can therefore make the app more cautious
 * and never less.
 */
export interface KillList {
    version: number;
    /** ids to refuse, with a reason the UI can show. */
    revoked: Array<{ id: string; reason: string }>;
}

export function applyKillList(ledger: Ledger, kill: KillList): Ledger {
    const records = { ...ledger.records };
    for (const { id, reason } of kill.revoked) {
        records[id] = { ...(records[id] ?? { id }), id, status: 'revoked', reason };
    }
    return { ...ledger, records };
}

/**
 * The one question the rest of the app asks.
 *
 * Default-deny: an id with no record is a candidate, and a candidate may not run
 * on a vehicle. PRACTICE is exempt because nothing it does reaches a car — that
 * is the entire point of having it.
 */
export function mayRunOnVehicle(ledger: Ledger, id: string): { allowed: boolean; reason: string } {
    const record = ledger.records[id];
    if (!record) {
        return { allowed: false, reason: 'not verified on a vehicle (no ledger entry)' };
    }
    switch (record.status) {
        case 'verified':
            return { allowed: true, reason: `verified ${record.verifiedAt ?? ''}`.trim() };
        case 'revoked':
            return { allowed: false, reason: record.reason ?? 'revoked centrally' };
        case 'refuted':
            return { allowed: false, reason: record.reason ?? 'found wrong on a vehicle' };
        default:
            return { allowed: false, reason: 'not verified on a vehicle' };
    }
}

/**
 * Fetches the kill list and merges it.
 *
 * Fails OPEN on the ledger and CLOSED on the operation: if the list cannot be
 * fetched, the local ledger stands unchanged — which, because everything
 * defaults to candidate, means the app stays cautious rather than becoming
 * permissive. A kill switch that granted permission when the network was down
 * would be worse than none.
 */
export async function fetchKillList(url: string, signal?: AbortSignal): Promise<KillList | null> {
    try {
        const res = await fetch(url, { cache: 'no-store', signal });
        if (!res.ok) return null;
        const body = (await res.json()) as KillList;
        if (typeof body?.version !== 'number' || !Array.isArray(body?.revoked)) return null;
        return body;
    } catch {
        return null;
    }
}

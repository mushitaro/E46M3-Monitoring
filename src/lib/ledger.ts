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
    /**
     * A READ that answered positively on this car while it was measured stationary. A fact, so
     * the app records it by itself (`recordParkedObservation`); it vouches for the bytes and the
     * answer, and for nothing about a moving car.
     */
    | 'observed-parked'
    /**
     * A read the OWNER cleared to be sent while the car moves (`grantMovingOk`). Never reached
     * automatically: whether a module minds being asked while it is working — DSC in a corner,
     * SMG II in a shift — is a judgement, and the person whose car it is makes it.
     */
    | 'moving-ok'
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
    /** Positive answers recorded with the car stationary, with these bytes. */
    observations?: number;
    /** ISO 8601, the latest of them. */
    lastObservedAt?: string;
    /** The module's IDENT answer at the time, hex — which unit answered. */
    ecuIdent?: string;
    /** Who cleared it for a moving car, and when (ISO 8601). */
    movingOkBy?: string;
    movingOkAt?: string;
}

export interface Ledger {
    version: number;
    records: Record<string, VerificationRecord>;
}

export const EMPTY_LEDGER: Ledger = { version: 1, records: {} };

/** How many stationary answers a read needs before it may be PROPOSED for a moving car. */
export const MOVING_OK_MIN_OBSERVATIONS = 3;

/**
 * Records that a read answered positively on a stationary car.
 *
 * Only ever adds evidence. A revoked or refuted record stays what it is — an observation does not
 * argue with a withdrawal — and a `moving-ok` or `verified` one keeps its standing and just gains
 * the date. If the bytes sent differ from the bytes recorded, the generator changed under the
 * record, and the count starts again from this answer: an observation is about bytes.
 */
export function recordParkedObservation(
    ledger: Ledger,
    id: string,
    seen: { telegram: string; response: string; at: string; ecuIdent?: string },
): Ledger {
    const prior = ledger.records[id];
    if (prior && (prior.status === 'revoked' || prior.status === 'refuted')) return ledger;
    const sameBytes = prior?.telegram === seen.telegram;
    const record: VerificationRecord =
        prior && (prior.status === 'moving-ok' || prior.status === 'verified') && sameBytes
            ? { ...prior, lastObservedAt: seen.at, observedResponse: seen.response }
            : {
                  ...(sameBytes ? prior : undefined),
                  id,
                  status: 'observed-parked',
                  telegram: seen.telegram,
                  observedResponse: seen.response,
                  observations: (sameBytes ? (prior?.observations ?? 0) : 0) + 1,
                  lastObservedAt: seen.at,
                  ecuIdent: seen.ecuIdent ?? prior?.ecuIdent,
              };
    return { ...ledger, records: { ...ledger.records, [id]: record } };
}

/**
 * The owner clears a read for a moving car.
 *
 * Refused — the ledger returned unchanged, with the reason — unless the read has answered on this
 * car while stationary at least `MOVING_OK_MIN_OBSERVATIONS` times with the bytes it would send.
 * The owner's word is the decision; the observations are what it is a decision about.
 */
export function grantMovingOk(
    ledger: Ledger,
    id: string,
    by: { who: string; at: string },
): { ledger: Ledger; refused: string | null } {
    const r = ledger.records[id];
    if (!r || r.status !== 'observed-parked') {
        return { ledger, refused: `${id} is ${r?.status ?? 'candidate'}; only a read observed on a stationary car can be cleared` };
    }
    if ((r.observations ?? 0) < MOVING_OK_MIN_OBSERVATIONS) {
        return { ledger, refused: `${id} has answered ${r.observations ?? 0} time(s) stationary; ${MOVING_OK_MIN_OBSERVATIONS} are needed` };
    }
    const record: VerificationRecord = { ...r, status: 'moving-ok', movingOkBy: by.who, movingOkAt: by.at };
    return { ledger: { ...ledger, records: { ...ledger.records, [id]: record } }, refused: null };
}

/** Whether a read may be sent while the car moves. Only an owner's grant says yes. */
export function mayReadWhileMoving(ledger: Ledger, id: string): boolean {
    return ledger.records[id]?.status === 'moving-ok';
}

/** A withdrawal or a refutation stands against a read as much as against anything else. */
export function withdrawn(ledger: Ledger, id: string): VerificationRecord | null {
    const r = ledger.records[id];
    return r && (r.status === 'revoked' || r.status === 'refuted') ? r : null;
}

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

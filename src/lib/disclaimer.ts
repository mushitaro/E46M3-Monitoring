/**
 * What the operator has agreed to, and when that agreement expires.
 *
 * The predecessor stored a boolean. A boolean is agreement to whatever the text
 * happened to say the day it was ticked, which means the one edit that matters —
 * a statement getting STRONGER because we learned something — is the edit nobody
 * is ever shown. So what is stored is the VERSION of the text that was
 * acknowledged, and raising it re-asks.
 *
 * That is also why this is a module rather than three lines in the component:
 * "has the text changed since they agreed" is a decision, and it is testable
 * here and untestable inside a `useEffect`.
 *
 * ## Why a modal rather than the footer that used to be there
 *
 * A standing 26px banner was removed at the owner's request, and the reason was
 * that it is the weakest of the app's three honesty mechanisms — the one a user
 * stops reading within a day. That argument is FOR this, not against it: the
 * per-row `VERIFIED` / `UNVERIFIED` pills, `mayRun`'s stated refusals and the
 * `Provenance` chips carry the standing claim, and what is left for a modal is
 * the one-time acknowledgement those cannot make.
 *
 * A failure to read or write storage is not a failure to disclaim: private mode
 * gets the dialog every session, which is the safe direction to err in.
 */

export const STORAGE_KEY = 'e46m3.disclaimer';

/**
 * Raise this ONLY when the text says something materially different — a new
 * risk, a changed refusal, a capability that did not exist before. A typo fix is
 * not a new statement, and re-asking for one teaches people to dismiss it.
 */
export const DISCLAIMER_VERSION = 1;

/** Has this reader agreed to the text as it stands now? */
export function isAcknowledged(stored: string | null, version = DISCLAIMER_VERSION): boolean {
    if (stored === null) return false;
    const n = Number(stored);
    // Not `>=` by accident: a stored version AHEAD of ours means the reader has
    // seen a later build. Re-asking there would be asking them to agree to
    // something weaker than what they already agreed to.
    return Number.isInteger(n) && n >= version;
}

/** Read the acknowledgement. Storage that refuses to answer has not agreed. */
export function readAck(): string | null {
    try {
        return localStorage.getItem(STORAGE_KEY);
    } catch {
        return null;
    }
}

function write(version: number): void {
    try {
        localStorage.setItem(STORAGE_KEY, String(version));
    } catch {
        // Private mode. The agreement stands for this session — it was given —
        // and the dialog returns next time, which is the direction to err in.
    }
}

/**
 * The acknowledgement as an external store, read with `useSyncExternalStore`.
 *
 * Not `useState` plus an effect that reads storage on mount. Two reasons, and
 * the second is the one that matters:
 *
 *   - this is a static export, so the prerendered HTML is identical for every
 *     reader; the server snapshot says "agreed" so the dialog is never in the
 *     first paint and never flashes at someone who agreed months ago. A modal
 *     that appears on every load is one people learn to dismiss unread, which is
 *     the failure the whole surface exists to avoid;
 *   - setState inside an effect is a cascading render, and React's own lint rule
 *     says so. Storage IS an external system. This is what the API is for, and
 *     it is the same shape `i18n` already uses for the language.
 */
const listeners = new Set<() => void>();
let cached: boolean | null = null;

function snapshot(): boolean {
    // Cached because `useSyncExternalStore` calls this on every render and
    // compares by identity — hitting localStorage each time would work and would
    // also be a synchronous disk read per render.
    if (cached === null) cached = isAcknowledged(readAck());
    return cached;
}

/** The prerender's answer: agreed, so the dialog is not in the static HTML. */
function serverSnapshot(): boolean {
    return true;
}

export const disclaimerStore = {
    subscribe(l: () => void): () => void {
        listeners.add(l);
        return () => listeners.delete(l);
    },
    snapshot,
    serverSnapshot,
    /** Record the agreement and tell everyone reading it. */
    agree(version = DISCLAIMER_VERSION): void {
        write(version);
        cached = true;
        listeners.forEach((l) => l());
    },
};

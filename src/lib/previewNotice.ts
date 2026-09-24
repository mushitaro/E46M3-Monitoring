/**
 * What the preview sends, acknowledged before it sends anything.
 *
 * The preview build sends what production never does — the sessions an owner SYNCs and the error
 * records it sends by itself (lib/sync/) — and what goes, and why, has to be in front of the owner
 * before the first of it leaves the device. That used to be m3's job: every owner-gated preview's
 * first visit passed through a page of m3's own, /preview-notice. The operator decided on
 * 2026-09-24 that the page was unnecessary and that the confirmation belongs in the app's own
 * first-run dialog, so the notice is now a section of `DisclaimerDialog` in the preview build, and
 * this module holds whether it has been acknowledged.
 *
 * ## Its own key, and not DISCLAIMER_VERSION + 1
 *
 * The disclaimer's version is a statement about the disclaimer's text, which production shows too:
 * raising it would ask every production reader to agree again to four unchanged points. The notice
 * is the preview's alone, so it has a key of its own, versioned in its name. A notice that says
 * something materially different — something new sent, a new purpose, a new place it is kept — is
 * `preview-notice:v2`, and every owner is asked again. A typo fix is not.
 *
 * ## Two readers, and the second is the one that makes it true
 *
 *   - the dialog (app/page.tsx), through `previewNoticeStore`: in the preview it is up whenever the
 *     key is missing, whatever the disclaimer's own flag says;
 *   - the sync code (lib/sync/cloud.ts `canSync`), through `previewNoticeAcknowledged()`, asked at
 *     the moment of every request. The dialog is what the owner sees; this is what makes "nothing
 *     is sent before it" a property of the code rather than of the layout.
 *
 * Storage that throws has not acknowledged: the dialog shows and nothing is sent. AGREE then holds
 * for as long as the page does — it was given — and the dialog is back on the next load, which is
 * the direction to err in.
 */
import { disclaimerStore } from './disclaimer';

export const PREVIEW_NOTICE_KEY = 'preview-notice:v1';

/** Given on this page. Storage that refused to keep it does not take it back. */
let acknowledgedHere = false;

/**
 * Has the owner acknowledged the notice as it stands? Read afresh on every call — this is what a
 * send asks, and an acknowledgement given in another tab is still an acknowledgement.
 */
export function previewNoticeAcknowledged(): boolean {
    if (acknowledgedHere) return true;
    try {
        return localStorage.getItem(PREVIEW_NOTICE_KEY) !== null;
    } catch {
        return false;
    }
}

/**
 * Whether the first-run dialog is up. Outside the preview it is the disclaimer's flag alone,
 * exactly as it was before there was a preview; in the preview a missing notice holds it up too,
 * even for a reader who agreed to the disclaimer long ago.
 */
export function firstRunDialogUp(s: { agreed: boolean; preview: boolean; noticeAcknowledged: boolean }): boolean {
    return !s.agreed || (s.preview && !s.noticeAcknowledged);
}

const listeners = new Set<() => void>();
let cached: boolean | null = null;

/**
 * The acknowledgement as an external store, for the dialog — the shape `disclaimerStore` has, for
 * the reasons `lib/disclaimer` gives. Cached, because `useSyncExternalStore` asks on every render.
 */
export const previewNoticeStore = {
    subscribe(l: () => void): () => void {
        listeners.add(l);
        return () => listeners.delete(l);
    },
    snapshot(): boolean {
        if (cached === null) cached = previewNoticeAcknowledged();
        return cached;
    },
    /** The prerender's answer, as the disclaimer's: no dialog in the static HTML. */
    serverSnapshot(): boolean {
        return true;
    },
    /** Record the acknowledgement and tell everyone reading it. */
    acknowledge(): void {
        acknowledgedHere = true;
        try {
            // The value is when; the key is what. Nothing reads the value back.
            localStorage.setItem(PREVIEW_NOTICE_KEY, new Date().toISOString());
        } catch {
            // Private mode: it holds for this page, and the dialog asks again next time.
        }
        cached = true;
        listeners.forEach((l) => l());
    },
};

/**
 * AGREE. Production records the disclaimer, as it always has, and never writes the notice's key;
 * the preview records both, because its dialog said both.
 */
export function agreeToFirstRun(preview: boolean): void {
    disclaimerStore.agree();
    if (preview) previewNoticeStore.acknowledge();
}

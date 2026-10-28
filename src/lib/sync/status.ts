/**
 * What SAVE and SYNC say, in one place — TUNER's `lib/session-sync/status.ts`, for this app's
 * sessions.
 *
 * There are two of each: in the SESSIONS view from 900px and in the menu sheet's SESSION band below
 * it. They are the same controls on two layouts, and a phone that says "Sync 2" beside a desk that
 * says "Synced" would make the owner distrust both. So the label, the sentence and whether it can be
 * pressed come from here, where they can have only one answer.
 *
 * The label is the state's own word, one or two of them: a cell in the sheet is 56px and a phone has
 * no hover, so the label is the only thing on it a finger can read (TUNER, 2026-08-24). The sentence
 * is `title`'s, for a mouse, and the line under SESSIONS says what the last press did.
 *
 * SYNC here saves first (`useSessions.sync`): what it would send is this connection's work, if it is
 * unsaved, and every saved session not yet sent. That is the count it carries.
 *
 * Pure and React-free, so the test can assert on it without mounting anything.
 */
import type { GateState } from './owner-sync';

export type SavePhase = 'nothing' | 'ready' | 'busy' | 'saved';

export type SyncPhase =
    /** The owner gate's session has ended. Nothing can land until the owner signs in again. */
    | 'signedOut'
    /** The gate could not say who is signed in — m3 did not answer it. Pressable: the press tries. */
    | 'unreachable'
    | 'offline'
    | 'busy'
    | 'ready'
    /** Everything worth sending is in the account, as it stands. */
    | 'clean';

export type StatusTone = 'ready' | 'busy' | 'done' | 'muted' | 'error';

export interface StatusLook {
    label: string;
    title: string;
    disabled: boolean;
    tone: StatusTone;
}

export interface StatusWords {
    save: string;
    save_nothing: string;
    save_busy: string;
    save_done: string;
    sync: string;
    sync_busy: string;
    sync_done: string;
    sync_offline: string;
    sync_signedOut: string;
    sync_unreachable: string;
    save_title: Record<SavePhase, string>;
    sync_title: Record<Exclude<SyncPhase, 'ready'>, string> & { ready: (n: number) => string };
}

export function savePhase(s: { busy: string | null; content: boolean; unsaved: boolean }): SavePhase {
    if (s.busy === 'save' || s.busy === 'sync') return 'busy';
    if (!s.content) return 'nothing';
    return s.unsaved ? 'ready' : 'saved';
}

/** What a SYNC press would send now: this connection, if unsaved, and the saved ones not yet sent. */
export function toSend(s: { content: boolean; unsaved: boolean; pending: number }): number {
    return s.pending + (s.content && s.unsaved ? 1 : 0);
}

/**
 * Nothing outstanding is `clean` whatever the route is doing: what has been sent is known on this
 * device (`needsSync`), so "Synced" is true with no signal too — and a red UNREACHABLE over a press
 * that would send nothing is an alarm about nothing. The route's state is said when there is
 * something for it to carry.
 */
export function syncPhase(s: {
    busy: string | null;
    online: boolean;
    gate: GateState | null;
    content: boolean;
    unsaved: boolean;
    pending: number;
}): SyncPhase {
    if (s.busy === 'sync') return 'busy';
    if (toSend(s) === 0) return 'clean';
    if (!s.online) return 'offline';
    if (s.gate === 'expired') return 'signedOut';
    if (s.gate === 'unknown') return 'unreachable';
    return 'ready';
}

export function describeSave(phase: SavePhase, w: StatusWords): StatusLook {
    switch (phase) {
        case 'nothing':
            return { label: w.save_nothing, title: w.save_title.nothing, disabled: true, tone: 'muted' };
        case 'busy':
            return { label: w.save_busy, title: w.save_title.busy, disabled: true, tone: 'busy' };
        case 'saved':
            return { label: w.save_done, title: w.save_title.saved, disabled: true, tone: 'done' };
        case 'ready':
            return { label: w.save, title: w.save_title.ready, disabled: false, tone: 'ready' };
    }
}

export function describeSync(phase: SyncPhase, n: number, w: StatusWords): StatusLook {
    switch (phase) {
        case 'signedOut':
            return { label: w.sync_signedOut, title: w.sync_title.signedOut, disabled: true, tone: 'muted' };
        case 'unreachable':
            return { label: w.sync_unreachable, title: w.sync_title.unreachable, disabled: false, tone: 'error' };
        case 'offline':
            return { label: w.sync_offline, title: w.sync_title.offline, disabled: true, tone: 'muted' };
        case 'busy':
            return { label: w.sync_busy, title: w.sync_title.busy, disabled: true, tone: 'busy' };
        case 'ready':
            return { label: `${w.sync} ${n}`, title: w.sync_title.ready(n), disabled: false, tone: 'ready' };
        case 'clean':
            return { label: w.sync_done, title: w.sync_title.clean, disabled: true, tone: 'muted' };
    }
}

/**
 * The colour each tone wears, the same in both places (TUNER's): SAVE pressable in the caution
 * violet, because it is the step that keeps the run; SYNC pressable in blue; SAVED in the OK step,
 * because it is an outcome and must not read as the grey of "nothing here"; busy breathes.
 */
const SETTLED = {
    busy: 'text-slate-500 animate-pulse cursor-wait',
    done: 'text-emerald-400/80 cursor-default',
    muted: 'text-slate-600 cursor-default',
    error: 'text-red-400 hover:text-red-300',
} as const;

export const SAVE_TONE: Record<StatusTone, string> = { ready: 'text-amber-400 hover:text-amber-300', ...SETTLED };
export const SYNC_TONE: Record<StatusTone, string> = { ready: 'text-blue-400 hover:text-blue-300', ...SETTLED };

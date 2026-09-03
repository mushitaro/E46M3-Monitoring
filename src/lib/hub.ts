/**
 * What the hub is, right now — as a function of the state, and nothing else.
 *
 * The hub is the app's one primary control: whatever the single right next step
 * is, it is there. Which means the decision "what should it be" is the most
 * load-bearing derivation in the UI, and it was living inline in a 1,800-line
 * page component where nothing could test it.
 *
 * Three tiers, in this order:
 *
 *   1. The link. Not connected / connecting / busy answer for everyone, because
 *      no view has anything to offer while the link is not there.
 *   2. The view. Whatever tab is up supplies its own verb.
 *   3. Nothing. CONNECTED, disabled — a statement, not an action.
 *
 * The predecessor cached tier 2 in a `lastViewHubConfig` so that a BUSY hub
 * could keep the view's label ("READING", "STOP") instead of showing a generic
 * spinner. **That cache is not ported.** In React the view's own state has
 * already flipped by the time we render — the read is in flight, so the view
 * derives READING on its own — and re-deriving gives the same answer without a
 * second copy of it that can go stale. A derivation that survives being
 * re-derived is stronger than one that has to be remembered.
 *
 * Pure, so `vitest` can check it under `environment: 'node'` with no DOM: the
 * caller passes the strings and the click handlers in.
 */
import type { LucideIcon } from 'lucide-react';
import type { HubConfig, NoticeTone } from '@/components/Hub';
import type { LinkState } from '@/hooks/useDs2Link';

export type { HubConfig };

/** The words the tiers this module owns need. The caller holds the language. */
export interface HubStrings {
    hub_connect: string;
    hub_connecting: string;
    hub_busy: string;
    hub_connected: string;
    mode_practice: string;
}

/** The glyphs, injected rather than imported, so a node test needs no icons. */
export interface HubIcons {
    plug: LucideIcon;
    loader: LucideIcon;
    idle: LucideIcon;
}

export interface HubState {
    linkState: LinkState;
    /** PRACTICE is checked: CONNECT opens the simulated link, and says so. */
    practiceArmed: boolean;
    /** What the view would offer if the link let it. `null` = nothing to offer. */
    fromView: HubConfig | null;
    connect: (mode: 'practice' | 'vehicle') => void;
    t: HubStrings;
    icons: HubIcons;
}

export function hubConfigFor(s: HubState): HubConfig {
    // --- tier 1: the link -----------------------------------------------------
    if (s.linkState === 'disconnected') {
        return {
            label: s.t.hub_connect,
            Icon: s.icons.plug,
            // One verb, one button. The checkbox beside it decides which link
            // this opens; forking it into two controls would ask the operator to
            // choose before there is anything to choose between.
            tone: s.practiceArmed ? 'ready' : 'idle',
            onClick: () => s.connect(s.practiceArmed ? 'practice' : 'vehicle'),
            notice: s.practiceArmed ? s.t.mode_practice : undefined,
        };
    }

    // The loader glyph, not the state's own. `animate-spin` rotates whatever it
    // is handed, and a plug or a bolt spun end over end reads as a corrupted
    // icon rather than as progress — at the two moments the operator most needs
    // to believe the tool is alive.
    if (s.linkState === 'connecting') {
        return {
            label: s.t.hub_connecting,
            Icon: s.icons.loader,
            tone: 'connecting',
            disabled: true,
            spin: true,
        };
    }

    // Busy keeps the view's own words when it has them — READING, STOP — because
    // "what is it doing" is answered better by the verb in flight than by BUSY.
    // Re-derived, not remembered: see the note at the top.
    if (s.linkState === 'busy') {
        return s.fromView
            ? { ...s.fromView, disabled: true, tone: 'busy', onClick: undefined }
            : {
                  label: s.t.hub_busy,
                  Icon: s.icons.loader,
                  tone: 'busy',
                  disabled: true,
                  spin: true,
              };
    }

    // --- tier 2: the view -----------------------------------------------------
    if (s.fromView) return s.fromView;

    // --- tier 3: nothing to do ------------------------------------------------
    return { label: s.t.hub_connected, Icon: s.icons.idle, tone: 'idle', disabled: true };
}

/**
 * The reserved notice line, in precedence order.
 *
 * The line has a fixed height and is always present, so this only decides what
 * it says — never whether it exists. A link error outranks everything because it
 * is the reason nothing else will work; the view's own notice is last because it
 * is the only one that is merely informative.
 */
export function hubNoticeFor(input: {
    linkError?: string;
    catalogError?: string;
    busyLabel?: string;
    viewNotice?: string;
}): { text?: string; tone: NoticeTone } {
    if (input.linkError) return { text: input.linkError, tone: 'error' };
    if (input.catalogError) return { text: input.catalogError, tone: 'warn' };
    if (input.busyLabel) return { text: input.busyLabel, tone: 'info' };
    return { text: input.viewNotice, tone: 'info' };
}

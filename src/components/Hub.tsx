'use client';

import type { LucideIcon } from 'lucide-react';
import { useBusyLock } from '@/hooks/useBusyLock';
import { HUB_LABEL, TextButton } from './ui';

/**
 * The hub — a state-machine action ring.
 *
 * One large control whose icon, label and handler are DERIVED from the live
 * state on every render, so the UI cannot disagree with reality. This is the
 * app's single primary action: whatever the one right next step is, it is here.
 *
 * The old app had this and I dropped it in the rebuild, which left the primary
 * actions as anonymous buttons scattered through panels. That is not a styling
 * difference — it is the interaction model, and losing it is why the app read
 * as a different product.
 *
 * Contract for a view that supplies one:
 *
 *   getHubConfig(state) -> {
 *     label,           short verb, in the active language
 *     Icon,            a lucide icon
 *     onClick,
 *     tone,            drives the glow ring, NOT decoration
 *     disabled?,
 *     notice?          text for the reserved line above; layout never jumps
 *   }
 *
 * Views with many independently-runnable rows (the job tables) deliberately
 * supply none: routing dozens of named jobs through one button would be an
 * extra click and a re-derived label. They fall back to the connection action.
 */

export type HubTone = 'idle' | 'connecting' | 'busy' | 'ready' | 'armed' | 'armed-danger' | 'done' | 'fail';

export interface HubConfig {
    label: string;
    Icon: LucideIcon;
    onClick?: () => void;
    tone: HubTone;
    disabled?: boolean;
    notice?: string;
    spin?: boolean;
}

/** The ring echoes the status layer, which lives inside the tricolor. */
const RING: Record<HubTone, string> = {
    idle: 'border-slate-800',
    connecting: 'border-amber-500/50 animate-pulse',
    busy: 'border-amber-500/50 animate-pulse',
    ready: 'border-blue-500/30',
    // Pulses. `armed` is the LIVE recording state, and without motion it
    // differed from a ready-to-record ring by 10% of a border alpha — from arm's
    // length under a car those are the same ring. The breathing is the one cue
    // readable from across a garage.
    armed: 'border-amber-500/50 animate-pulse',
    // The only place red appears as a steady state: a control that is armed to
    // do something irreversible.
    'armed-danger': 'border-red-500/60',
    done: 'border-emerald-500/40',
    fail: 'border-red-500/50',
};

/**
 * The face colour.
 *
 * `idle` is BLUE, not slate. It is the tone of the landing state — CONNECT —
 * which is an enabled, pressable action, and painting it slate-500 made the
 * app's single primary control look disabled on the first screen every user
 * sees, identical to the genuinely-disabled fallback. Disabled-ness is keyed off
 * the `disabled` flag below, never off a tone name.
 */
const FACE: Record<HubTone, string> = {
    idle: 'text-blue-500 hover:text-blue-400',
    connecting: 'text-amber-400',
    busy: 'text-amber-400',
    ready: 'text-blue-500 hover:text-blue-400',
    armed: 'text-amber-400',
    'armed-danger': 'text-red-400',
    done: 'text-emerald-400',
    fail: 'text-red-400',
};

/**
 * 72px, not 80.
 *
 * `layout-and-structure.md` writes the hub down as `w-20 h-20` and this used to
 * follow it literally — but the reference tool does NOT render 80. Its cluster
 * sits in a box whose height its own wings set (3 rows of 28 + 2 gaps of 18 =
 * 120), and its fit-scale then divides `clientHeight - 12` by that: 108/120 =
 * 0.9, permanently. Measured at 1280x720, 1280x800, 1280x1400 and 1920x1080 —
 * 0.9 every time. So the instrument everyone has actually looked at has a 72px
 * ring with an 18px glyph, and this app was the odd one out at 80/20.
 *
 * Declared rather than reproduced with a transform. `scale-90` would paint 72
 * while still occupying an 80px box, which would silently put 8px back into the
 * gaps below — and those gaps are measured against the same reference.
 */
const HUB_SIZE = 'size-[72px]';
const HUB_ICON = 'size-[18px]';

export function Hub({ config }: { config: HubConfig }) {
    const { label, Icon, onClick, tone, disabled, spin } = config;
    return (
        <div className="relative">
            <div className={`absolute -inset-1 rounded-full border ${RING[tone]}`} aria-hidden="true" />
            <button
                type="button"
                onClick={disabled ? undefined : onClick}
                disabled={disabled}
                className={`relative flex ${HUB_SIZE} flex-col items-center justify-center gap-1 rounded-full border border-slate-700 bg-slate-900 shadow-2xl ring-1 ring-slate-800 transition-colors hover:bg-slate-800 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-slate-900 ${
                    disabled ? 'text-slate-500' : FACE[tone]
                }`}
            >
                <Icon className={`${HUB_ICON} stroke-[1.5] ${spin ? 'animate-spin' : ''}`} />
                <span className={HUB_LABEL}>{label}</span>
            </button>
        </div>
    );
}

/**
 * The hub cluster: a symmetric 3-column grid, not a flex row, so the ring stays
 * dead centre however wide the wing labels get.
 */
export function HubCluster({
    left,
    right,
    children,
}: {
    left?: React.ReactNode;
    right?: React.ReactNode;
    children: React.ReactNode;
}) {
    return (
        <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center">
            <div className="flex flex-col items-end gap-[18px] justify-self-end">{left}</div>
            <div className="justify-self-center">{children}</div>
            <div className="flex flex-col items-start gap-[18px] justify-self-start">{right}</div>
        </div>
    );
}

/**
 * The reserved notice line.
 *
 * Fixed height whether or not there is anything in it. Transient text appearing
 * and disappearing inside a reserved slot is the difference between a dashboard
 * that reads as an instrument and one that twitches every time a status
 * changes — which, on a tool that drives a car, reads as untrustworthy.
 */
export type NoticeTone = 'info' | 'warn' | 'error';

const NOTICE: Record<NoticeTone, string> = {
    info: 'text-slate-500',
    warn: 'text-amber-400',
    error: 'text-red-400',
};

export function HubNotice({ text, tone = 'info' }: { text?: string; tone?: NoticeTone }) {
    return (
        // Fixed height AND constant margins. The height reserves the slot; the
        // margins put it where the reference tool puts it.
        //
        // Measured side by side at 1280x800, from the top of the panel:
        //
        //             reference          here (before)
        //   status    548 → 580          570 → 602
        //   notice    584 → 598  (+4)    602 → 616  (+0)   flush under the row
        //   hub ring  614        (+16)   628        (+12)
        //
        // So: `mt-1 mb-4`. It belongs to the status row it comments on — a 4px
        // hairline gap — and then stands clear of the ring, which extends 4px
        // past the button on every side.
        //
        // LEFT, not centred. This slot carries link errors, catalogue errors and
        // the hub's own cost line; centring each one moved the text sideways
        // every time the message changed, which is the reflow the reserved slot
        // exists to prevent, just on the other axis. The reference left-aligns
        // it for the same reason.
        //
        // 11px, up from 10px, and the tracking dropped. The reference found the
        // same thing: at micro-label size a line reporting real numbers was
        // unreadable at arm's length and got reported as "nothing appeared".
        // Still sans, not the reference's mono — its notices are DS2 errors and
        // baud rates, machine text; these are Japanese sentences, and mono
        // renders CJK through a fallback anyway.
        //
        // overflow-hidden + truncate + a pinned leading are not optional here.
        // Reserving 14px does nothing if the content can be 330px of tracked
        // uppercase in a 250px panel: it wrapped to three lines and painted
        // straight over the MODULE row above and the ring below. The panel never
        // reflowed — the text simply collided with the controls.
        <div className="mb-4 mt-1 flex h-[14px] items-center overflow-hidden px-2">
            <p className={`truncate text-[11px] leading-[14px] ${NOTICE[tone]}`} title={text ?? ''}>
                {text ?? ''}
            </p>
        </div>
    );
}

/**
 * Reserved sub-action row. Same rule: it keeps its slot when empty.
 *
 * A ROW, and deliberately no `flex-wrap`. Wrapping is what puts the content over
 * the reserved height — a second line costs ~15px more than the 36px left after
 * padding — and the overflow then scrolls the whole control panel, moving the
 * hub. `gap-x-6` because these are naked tracked-uppercase labels with no box to
 * separate them; at gap-2 two of them read as one string.
 */
export function SubActions({ children }: { children?: React.ReactNode }) {
    return <div className="flex h-[46px] flex-none items-center justify-center gap-x-4">{children}</div>;
}

/**
 * A button in the sub-action row.
 *
 * The ONLY way to put a control there, and it reads the busy lock itself. The
 * predecessor enforced "sub-actions are dead while busy" with a sweep over the
 * rendered row (`querySelectorAll("button, select, input")` → `disabled = true`),
 * which finds whatever happens to be there when it runs and nothing else.
 *
 * Making it a component turns the rule into a mechanism: a sub-action that stays
 * live during a write is not something you can write by forgetting a prop, only
 * by writing a different component — which is a visible act.
 *
 * `stopButton` is the one exception, and it is spelled out rather than left to a
 * caller's judgement. An armed actuator's STOP must stay pressable while a write
 * is in flight, because the output is physically on. Nothing else may pass it.
 */
export function SubActionButton({
    stopButton = false,
    disabled,
    title,
    ...rest
}: Omit<React.ComponentProps<typeof TextButton>, 'disabled'> & {
    stopButton?: boolean;
    disabled?: boolean;
    title?: string;
}) {
    const { busy, label } = useBusyLock();
    const lockedOut = busy && !stopButton;
    return (
        <TextButton
            {...rest}
            disabled={lockedOut || disabled}
            // Say WHY it is dead. `title` is a hover, so this is the mouse's
            // half; the notice line above the hub carries the same label for
            // everyone else — see the note in useBusyLock.
            title={lockedOut && label ? label : title}
        />
    );
}

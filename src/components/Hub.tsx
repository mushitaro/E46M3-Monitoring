'use client';

import type { LucideIcon } from 'lucide-react';

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
    armed: 'border-amber-500/60',
    // The only place red appears as a steady state: a control that is armed to
    // do something irreversible.
    'armed-danger': 'border-red-500/60',
    done: 'border-emerald-500/40',
    fail: 'border-red-500/50',
};

const FACE: Record<HubTone, string> = {
    idle: 'text-slate-500',
    connecting: 'text-amber-400',
    busy: 'text-amber-400',
    ready: 'text-blue-500 hover:text-blue-400',
    armed: 'text-amber-400',
    'armed-danger': 'text-red-400',
    done: 'text-emerald-400',
    fail: 'text-red-400',
};

export function Hub({ config }: { config: HubConfig }) {
    const { label, Icon, onClick, tone, disabled, spin } = config;
    return (
        <div className="relative">
            <div className={`absolute -inset-1 rounded-full border ${RING[tone]}`} aria-hidden="true" />
            <button
                type="button"
                onClick={disabled ? undefined : onClick}
                disabled={disabled}
                className={`relative flex size-20 flex-col items-center justify-center gap-1 rounded-full border border-slate-700 bg-slate-900 shadow-2xl ring-1 ring-slate-800 transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-slate-900 ${FACE[tone]}`}
            >
                <Icon className={`size-5 stroke-[1.5] ${spin ? 'animate-spin' : ''}`} />
                <span className="text-[8px] font-bold uppercase tracking-widest">{label}</span>
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
export function HubNotice({ text }: { text?: string }) {
    return (
        // Fixed height AND a constant margin. The height reserves the slot; the
        // margin is what stops the text from sitting flush against the hub's
        // ring, which extends 4px past the button on every side.
        <div className="mb-3 flex h-[14px] items-center justify-center text-[10px] uppercase tracking-widest text-slate-500">
            {text ?? ''}
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
    return <div className="flex h-[46px] items-center justify-center gap-x-6">{children}</div>;
}

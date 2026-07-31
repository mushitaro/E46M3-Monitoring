'use client';

import type { LucideIcon } from 'lucide-react';

/**
 * The primitives that carry the ///M border rule.
 *
 * ## The rule
 *
 * A border is a RULE BETWEEN REGIONS, never an OUTLINE AROUND A THING.
 *
 * Allowed, and nothing else:
 *   - one-sided hairlines that separate — `border-b` under a bar, `border-r`
 *     between the two columns, `divide-y` between list rows
 *   - exactly one outline per FLOATING surface (modal, popover), because it is
 *     detached from the page and needs an edge
 *   - the tab underline (`border-b-2`), which is a position indicator
 *   - the hub ring, which is a state indicator
 *   - a dashed drop zone, because a drop target genuinely is an area
 *
 * Everything else — panels, list rows, inputs, pills, buttons — is separated by
 * SURFACE (`bg-slate-800`, `bg-<role>/15`) or by SPACE. The reference app has
 * not a single outlined button anywhere, and it reads as an instrument for
 * exactly that reason: outlines stack, and three levels of them turn a dense
 * data view into a stack of cards.
 *
 * These components exist so the rule lives in one file instead of in the
 * discipline of whoever writes the next call site. Reach for them first.
 */

type Tone = 'neutral' | 'primary' | 'danger' | 'destructive' | 'caution' | 'secondary' | 'ok';

const TEXT: Record<Tone, string> = {
    neutral: 'text-slate-500 hover:text-slate-300',
    primary: 'text-blue-400 hover:text-blue-300',
    // Muted until you reach for it. For incidental destructive controls
    // (disconnect, discard) that sit among ordinary ones.
    danger: 'text-slate-500 hover:text-red-400',
    // Steady red. Only for the confirm inside a gate, where being destructive is
    // the entire point of the control and hiding it would be dishonest.
    destructive: 'text-red-400 hover:text-red-300',
    caution: 'text-slate-500 hover:text-amber-400',
    secondary: 'text-indigo-400 hover:text-indigo-300',
    ok: 'text-emerald-400 hover:text-emerald-300',
};

/**
 * The default button: text, uppercase, tracked, semantic-coloured, no box.
 *
 * Destructive ones sit muted and only turn red on hover — danger should not
 * shout until you reach for it.
 */
export function TextButton({
    children,
    onClick,
    tone = 'neutral',
    Icon,
    disabled,
    title,
    className = '',
    ...rest
}: {
    children: React.ReactNode;
    onClick?: () => void;
    tone?: Tone;
    Icon?: LucideIcon;
    disabled?: boolean;
    title?: string;
    className?: string;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onClick' | 'title' | 'className'>) {
    return (
        <button
            type="button"
            onClick={disabled ? undefined : onClick}
            disabled={disabled}
            title={title}
            className={`inline-flex items-center gap-1.5 whitespace-nowrap text-[10px] font-bold uppercase tracking-widest transition-colors disabled:cursor-not-allowed disabled:text-slate-700 disabled:hover:text-slate-700 ${TEXT[tone]} ${className}`}
            {...rest}
        >
            {Icon && <Icon className="size-3 shrink-0" />}
            {children}
        </button>
    );
}

const FILL: Record<Tone, string> = {
    neutral: 'bg-slate-800 text-slate-400',
    primary: 'bg-blue-500/15 text-blue-400',
    danger: 'bg-red-500/15 text-red-400',
    destructive: 'bg-red-500/15 text-red-400',
    caution: 'bg-amber-500/15 text-amber-400',
    secondary: 'bg-indigo-500/15 text-indigo-400',
    ok: 'bg-emerald-500/15 text-emerald-400',
};

/** A tag. Tint fill, never an outline — outlined pills are what turn a row of
 *  metadata into a row of tiny boxes. */
export function Pill({ children, tone = 'neutral', title }: { children: React.ReactNode; tone?: Tone; title?: string }) {
    return (
        <span
            title={title}
            className={`inline-block shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest ${FILL[tone]}`}
        >
            {children}
        </span>
    );
}

/** A filter chip: same tint language as Pill, but pressable. */
export function Chip({
    children,
    active,
    onClick,
}: {
    children: React.ReactNode;
    active: boolean;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-pressed={active}
            className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest transition-colors ${
                active ? 'bg-blue-500/15 text-blue-400' : 'text-slate-500 hover:bg-slate-800 hover:text-slate-300'
            }`}
        >
            {children}
        </button>
    );
}

/** Raised surface, focus ring instead of a border colour change — a border that
 *  only appears on focus is a 1px layout shift on every click. */
export function SearchInput({
    value,
    onChange,
    placeholder,
    className = '',
}: {
    value: string;
    onChange: (v: string) => void;
    placeholder: string;
    className?: string;
}) {
    return (
        <input
            type="search"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            className={`rounded bg-slate-800 px-2 py-1 font-mono text-xs text-slate-200 outline-none placeholder:text-slate-600 focus:ring-1 focus:ring-blue-500/60 ${className}`}
        />
    );
}

/** The micro-label above a block. Sits on its own line; no rule under it — the
 *  size and colour step is already the separation. */
export function MicroLabel({ children }: { children: React.ReactNode }) {
    return <div className="text-[9px] font-bold uppercase tracking-widest text-slate-600">{children}</div>;
}

/** A recessed block for machine output (raw idents, planned telegrams). Surface,
 *  not outline. */
export function Well({ children, className = '' }: { children: React.ReactNode; className?: string }) {
    return <div className={`rounded bg-slate-800/40 p-2 ${className}`}>{children}</div>;
}

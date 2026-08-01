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

/**
 * ## The type ramp, and why there are only two steps
 *
 * Micro-labels shipped at 8, 9, 10 and 11px, bold and not, in slate-400/500/600,
 * as `div`, `span`, `summary` and `p`. Four sizes cannot encode three levels of
 * importance; they encode "four people wrote this". So:
 *
 *   LABEL — 10px, bold, uppercase, tracked. Chrome: headings, buttons, pills,
 *           tabs, facet chips. Everything that names a thing.
 *   DATA  — 11px / 12px, mono where it came from a machine. The thing itself.
 *
 * There is no third size. If something needs to recede, it changes COLOUR
 * (slate-500 → slate-600), because a size step and a colour step doing the same
 * job is how you get eight of them.
 */
export const LABEL = 'text-[10px] font-bold uppercase tracking-widest';

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
    // Primary by default: a text button is a CONTROL and has to look pressable
    // at rest. At the previous slate-500 default, EXPORT CSV — the only thing
    // you can do with a finished run — was the exact colour of the inactive tab
    // labels beside it and read as a status word. `neutral` stays available for
    // genuinely secondary actions like CANCEL.
    tone = 'primary',
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
            className={`inline-flex items-center gap-1.5 whitespace-nowrap ${LABEL} transition-colors disabled:cursor-not-allowed disabled:text-slate-600 disabled:hover:text-slate-600 ${TEXT[tone]} ${className}`}
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
            className={`inline-block shrink-0 rounded px-1.5 py-0.5 ${LABEL} ${FILL[tone]}`}
        >
            {children}
        </span>
    );
}

/**
 * A filter chip: same tint language as Pill, but pressable.
 *
 * `count` is not decoration. With 323 jobs behind a default filter, the number
 * beside a facet is the only thing that tells a reader there is more here than
 * they are being shown — and it counts the WHOLE catalogue, not the filtered
 * view, or hidden things would be hidden twice.
 */
export function Chip({
    children,
    active,
    count,
    onClick,
    title,
}: {
    children: React.ReactNode;
    active: boolean;
    count?: number;
    onClick: () => void;
    title?: string;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-pressed={active}
            title={title}
            className={`shrink-0 rounded px-2 py-0.5 ${LABEL} transition-colors ${
                active ? 'bg-blue-500/15 text-blue-400' : 'text-slate-500 hover:bg-slate-800 hover:text-slate-300'
            }`}
        >
            {children}
            {count !== undefined && (
                <span className={`ml-1.5 font-mono tabular-nums ${active ? 'text-blue-400/60' : 'text-slate-600'}`}>
                    {count}
                </span>
            )}
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
export function MicroLabel({ children, className = '' }: { children: React.ReactNode; className?: string }) {
    return <div className={`${LABEL} text-slate-500 ${className}`}>{children}</div>;
}

/** A recessed block for machine output (raw idents, planned telegrams). Surface,
 *  not outline. */
export function Well({ children, className = '' }: { children: React.ReactNode; className?: string }) {
    return <div className={`rounded bg-slate-800/40 p-2 ${className}`}>{children}</div>;
}

/**
 * A titled block, with its count and its own actions.
 *
 * There were eight hand-built versions of this shape across two files, spaced
 * mb-3 / mb-4 / mb-6 / mt-6+pt-4 and titled four different ways. The spacing
 * belongs to the CONTAINER — a `flex flex-col gap-6` column — so this component
 * deliberately carries no outer margin: a block that spaces itself cannot be
 * rearranged without re-tuning every neighbour.
 */
export function Section({
    title,
    count,
    actions,
    note,
    children,
}: {
    title: React.ReactNode;
    count?: number;
    actions?: React.ReactNode;
    /** One line under the title, for a caveat about the whole block. */
    note?: React.ReactNode;
    children: React.ReactNode;
}) {
    return (
        <section>
            <div className="flex min-h-[20px] items-baseline justify-between gap-3">
                <MicroLabel>{title}</MicroLabel>
                <div className="flex shrink-0 items-baseline gap-3">
                    {actions}
                    {count !== undefined && (
                        <span className="font-mono text-[11px] tabular-nums text-slate-600">{count}</span>
                    )}
                </div>
            </div>
            {note && <p className="mt-1 max-w-[70ch] text-[11px] leading-relaxed text-slate-500">{note}</p>}
            <div className="mt-1.5">{children}</div>
        </section>
    );
}

/**
 * A pane: a column of Sections, one gap.
 *
 * Every left-hand pane is this. The gap lives HERE and not on the Sections, so
 * blocks can be reordered without re-tuning their neighbours — which is how the
 * app ended up with mb-3, mb-4, mb-6 and mt-6+pt-4 all meaning "next block".
 */
export function Pane({ children }: { children: React.ReactNode }) {
    return <div className="flex flex-col gap-6">{children}</div>;
}

/**
 * A named row of filter chips.
 *
 * The name is not decoration: an unlabelled row of toggles is a mystery, and
 * there are three axes in the jobs pane whose chips would otherwise run together
 * into one undifferentiated wall.
 */
export function FacetRow({ label: heading, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className={`w-[4.5rem] shrink-0 ${LABEL} text-slate-600`}>{heading}</span>
            {children}
        </div>
    );
}

/**
 * The controls above a list: a capped search field, the facet rows, the
 * shown/total counter, and the line that says what is hidden.
 *
 * One component because a list with a search and a list without one were drifting
 * into two different layouts — and the datalog pane, which has 213 rows, had no
 * search at all while the jobs pane next to it did.
 */
export function ListControls({
    query,
    onQuery,
    placeholder,
    shown,
    total,
    hiddenNote,
    children,
}: {
    query: string;
    onQuery: (v: string) => void;
    placeholder: string;
    shown: number;
    total: number;
    /** Stated, never implied. A filtered list that does not say so is how rows go missing. */
    hiddenNote?: string;
    /** Facet rows. */
    children?: React.ReactNode;
}) {
    return (
        <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                {/* Capped, not stretched. Given a 900px column, flex-1 made the
                    field the single largest object on screen — a grey slab that
                    says nothing — while the filters it belongs with were pushed
                    half a metre from the text they filter. */}
                <SearchInput value={query} onChange={onQuery} placeholder={placeholder} className="w-full max-w-[340px]" />
                <span className="ml-auto shrink-0 font-mono text-[11px] tabular-nums text-slate-600">
                    {shown} / {total}
                </span>
            </div>
            {children}
            {hiddenNote && <p className="text-[11px] text-slate-500">{hiddenNote}</p>}
        </div>
    );
}

/**
 * The one list. Rows are separated by a hairline and by hover, never by a box
 * each — at 77 rows an outline per row plus its pills stacks four frames deep and
 * the eye stops resolving the only thing that matters, which row is under the
 * pointer.
 */
export function DataList({ children, className = '' }: { children: React.ReactNode; className?: string }) {
    return (
        <ul className={`divide-y divide-slate-800/50 border-t border-slate-800/50 ${className}`}>{children}</ul>
    );
}

/**
 * The one row: one dimension, one hover, one selection expression.
 *
 * `onSelect` optional on purpose — a non-selectable row is a `li`, not a button
 * with a dead click. The job list, the procedure list, the channel picker and the
 * datalog value table were four different row shapes doing this, and only one of
 * them showed selection at all.
 */
export function DataRow({
    selected = false,
    onSelect,
    leading,
    title,
    subtitle,
    trailing,
    detail,
}: {
    selected?: boolean;
    onSelect?: () => void;
    /** Pill or checkbox. Baseline-aligned with the title. */
    leading?: React.ReactNode;
    title: React.ReactNode;
    /** The elastic middle. Truncates; everything else is shrink-0. */
    subtitle?: React.ReactNode;
    trailing?: React.ReactNode;
    /** Extra lines under the row. Indented to the title, not to the pill. */
    detail?: React.ReactNode;
}) {
    const body = (
        <>
            <div className="flex items-baseline gap-x-3">
                {leading}
                <span className={`shrink-0 font-mono text-xs ${selected ? 'text-blue-300' : 'text-slate-200'}`}>
                    {title}
                </span>
                {subtitle !== undefined && (
                    <span className="min-w-0 flex-1 truncate text-xs text-slate-400">{subtitle}</span>
                )}
                {subtitle === undefined && <span className="min-w-0 flex-1" />}
                {trailing}
            </div>
            {detail && <div className="mt-1 space-y-1">{detail}</div>}
        </>
    );

    if (!onSelect) return <li className="px-2 py-2">{body}</li>;
    return (
        <li>
            <button
                type="button"
                onClick={onSelect}
                aria-pressed={selected}
                className={`w-full px-2 py-2 text-left transition-colors ${
                    selected ? 'bg-blue-500/10' : 'hover:bg-slate-800/40'
                }`}
            >
                {body}
            </button>
        </li>
    );
}

/**
 * A label and its value — the ///M readout atom.
 *
 * `JobPlan::Stat`, `page::MixCell` and `page::Readout` were three copies of this
 * with three different label sizes and two different stack directions.
 */
export function Field({
    label,
    value,
    unit,
    tone = 'text-slate-200',
    stacked = false,
    labelKind = 'chrome',
    title,
}: {
    label: React.ReactNode;
    value: React.ReactNode;
    unit?: string;
    /** A text colour class. Semantic only — a verdict, never decoration. */
    tone?: string;
    /** Stacked for a grid of readouts; inline for a run of metadata. */
    stacked?: boolean;
    /**
     * `chrome` is a name WE chose and gets the uppercase label treatment.
     * `data` is a name the ECU supplied — a freeze-frame field, a result — and
     * must not be uppercased: the system's own rule is sans for chrome, and a
     * machine-supplied string is not chrome. Uppercasing it also turns an
     * untranslated German fallback into shouting, which is how
     * `Versorgungsspannung HR` appeared as VERSORGUNGSSPANNUNG HR.
     */
    labelKind?: 'chrome' | 'data';
    title?: string;
}) {
    const labelCls = labelKind === 'chrome' ? `${LABEL} text-slate-600` : 'text-[11px] text-slate-500';
    if (stacked) {
        return (
            <div className="flex flex-col leading-none" title={title}>
                <span className={labelCls}>{label}</span>
                <span className={`mt-1.5 font-mono text-[11px] font-bold tabular-nums ${tone}`}>
                    {value}
                    {unit && <span className="ml-1 font-normal text-slate-500">{unit}</span>}
                </span>
            </div>
        );
    }
    return (
        <span className="flex items-baseline gap-1.5" title={title}>
            <span className={labelCls}>{label}</span>
            <span className={`font-mono text-xs tabular-nums ${tone}`}>
                {value}
                {unit && <span className="ml-1 text-slate-500">{unit}</span>}
            </span>
        </span>
    );
}

/**
 * Where a statement came from, said in the statement's own margin.
 *
 * Rendered as quiet text rather than a pill: on a panel where most lines carry
 * one, a tint per line is a wall of colour. It is the ones that say `name-heuristic`
 * that need to be findable, and they are findable because everything else says
 * something better.
 */
export function Provenance({ children, title }: { children: React.ReactNode; title?: string }) {
    return (
        <span title={title} className={`shrink-0 ${LABEL} text-slate-600`}>
            {children}
        </span>
    );
}

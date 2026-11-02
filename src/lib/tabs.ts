/**
 * The tabs, as a set the compiler can count.
 *
 * The shell overlays one pane per tab and one visualization per tab, and the
 * failure mode of a hand-written list is a tab whose pane is simply missing —
 * which renders as an empty column, not as an error. So the order is derived
 * from an exhaustive record: adding a member to `Tab` without adding it here is
 * a compile error, and the shell's pane and viz maps are `Record<Tab, …>` for
 * the same reason.
 *
 * The array order is the order they appear in the bar, so this is also where
 * that decision is made rather than in JSX. Whether a tab appears AT ALL in a
 * given build is not decided here — that is `lib/features.ts`, and the bar
 * filters this order through it.
 */
export type Tab = 'diagnosis' | 'datalog' | 'adaptation' | 'service' | 'actuator' | 'memory';

export const TAB_ORDER = Object.keys({
    diagnosis: true,
    datalog: true,
    adaptation: true,
    service: true,
    actuator: true,
    // Last (operator, 2026-11-02): MANUAL is tried first and kept afterwards, so what it keeps
    // comes at the end of the row. It is the records the other five produced and the door to SYNC.
    // PROBE, which is started on purpose, will open on a STARTUP of its own instead.
    memory: true,
} satisfies Record<Tab, true>) as readonly Tab[];

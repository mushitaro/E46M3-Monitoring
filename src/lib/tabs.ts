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
export type Tab = 'startup' | 'diagnosis' | 'datalog' | 'adaptation' | 'service' | 'actuator';

export const TAB_ORDER = Object.keys({
    // First, as TUNER's: the records the other five produced, and the door to SYNC (operator,
    // 2026-11-02). Not the tab the app opens on — MANUAL starts with nothing to set up.
    startup: true,
    diagnosis: true,
    datalog: true,
    adaptation: true,
    service: true,
    actuator: true,
} satisfies Record<Tab, true>) as readonly Tab[];

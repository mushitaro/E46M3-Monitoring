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
export type Tab = 'diagnosis' | 'datalog' | 'adaptation' | 'service' | 'actuator' | 'memory' | 'startup' | 'probe';

export const TAB_ORDER = Object.keys({
    diagnosis: true,
    datalog: true,
    adaptation: true,
    service: true,
    actuator: true,
    // Last (operator, 2026-11-02): MANUAL is tried first and kept afterwards, so what it keeps
    // comes at the end of the row. It is the records the other five produced and the door to SYNC.
    // PROBE, which is started on purpose, opens on a STARTUP of its own instead.
    memory: true,
    // PROBE's two (operator, 2026-11-02): STARTUP, where a PROBE session is started (NEW SESSION)
    // and carried on (NEXT), and PROBE, the board the assistant places parts on.
    startup: true,
    probe: true,
} satisfies Record<Tab, true>) as readonly Tab[];

/**
 * The two modes and the tabs each shows (operator, 2026-11-02). The MODE corner, bottom-left of
 * HUB, switches between them at any time; the bar shows only the mode's tabs.
 *
 *   - `manual` — the owner chooses what to read and does it, as with any tool. What is done is
 *                recorded as it happens and kept afterwards on MEMORY (lib/journal).
 *   - `probe`  — the assistant's. A session is started on purpose (STARTUP), its form decided,
 *                data taken, and carried on to the next session (NEXT). The PROBE tab is a board
 *                the assistant places parts on, and the owner opens, closes and reorders.
 *
 * Exhaustive, like TAB_ORDER: a tab without a mode is a compile error, not a tab no bar shows.
 */
export type Mode = 'manual' | 'probe';

export const TAB_MODE = {
    diagnosis: 'manual',
    datalog: 'manual',
    adaptation: 'manual',
    service: 'manual',
    actuator: 'manual',
    memory: 'manual',
    startup: 'probe',
    probe: 'probe',
} as const satisfies Record<Tab, Mode>;

/** The tab a mode opens on when it is switched to. */
export const MODE_HOME: Record<Mode, Tab> = { manual: 'diagnosis', probe: 'startup' };

/**
 * The MONITORING WORKS tools the tab names in its hello, and what each may do.
 *
 * One list, so the guide (public/guide/*.md) cannot name a tool that does not exist — guide.test.ts
 * checks every `monitoring_*` it mentions against this — and so the relay's split between reading
 * and acting is declared here rather than inferred (matrix-tsunagi 0.11.0 marks `read` tools
 * readOnlyHint).
 *
 * `read`: answers from what the tab already holds. `control`: changes the tab's own state, its
 * record or its screen. Neither sends anything to the car by itself; a read the tab is asked to
 * take again (`monitoring_faults` refresh, a plan's steps) goes through runGate like any other.
 * `monitoring_guide` is answered by the relay and reserved there.
 */
export const MONITORING_TOOLS = {
    monitoring_status: 'read',
    monitoring_faults: 'read',
    monitoring_catalog: 'read',
    monitoring_cowork: 'read',
    monitoring_moment: 'read',
    monitoring_run_overview: 'read',
    monitoring_ledger: 'read',
    monitoring_sessions: 'read',
    monitoring_investigate: 'control',
    monitoring_plan: 'control',
    monitoring_finding: 'control',
    monitoring_note: 'control',
    monitoring_mark: 'control',
    monitoring_display: 'control',
    monitoring_stage: 'control',
    monitoring_start_log: 'control',
    monitoring_stop_log: 'control',
    monitoring_save: 'control',
    monitoring_sync_upload: 'control',
} as const satisfies Record<string, 'read' | 'control'>;

export type MonitoringToolName = keyof typeof MONITORING_TOOLS;

/** Answered by the relay from the guide the tab declared; never by the tab. */
export const GUIDE_TOOL = 'monitoring_guide';

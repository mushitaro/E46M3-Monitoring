import { decisionFor, mayRunProcedure, type CatalogJob, type Ledger, type Motion, type RunBlockKey } from '@tsunagi/monitoring-engine';
import type { Smg2Workflows } from '@/lib/smg2Workflows';

/**
 * monitoring_catalog's answer for the jobs that do not run as a bare job: which tool runs them.
 *
 * On the car (2026-11-19) the catalogue said `mayRunNow: false, "takes values"` for SMG II's
 * STEUERN_STELLGLIED, TESTPRG_STARTEN and ADAPTIONSWERTE_LOESCHEN and nothing more, and listed no
 * procedure, so the assistant concluded that nothing of SMG II's could be run parked. Each of them
 * has its own door; the catalogue now names it.
 */

/** The job that starts one of SMG II's test programs: monitoring_procedure's, never monitoring_actuate's. */
export const isProcedureStart = (moduleId: string, jobId: string): boolean => moduleId === 'smg2' && jobId === 'TESTPRG_STARTEN';

/** How a job that takes values is run, as a sentence for the assistant; null for a job that takes none. */
export function runWith(moduleId: string, job: Pick<CatalogJob, 'id' | 'args'>): string | null {
    if (isProcedureStart(moduleId, job.id))
        return 'monitoring_procedure, with a program number from procedures in this answer: the procedure stops the test program first and last, and its dialog runs it.';
    if (job.args.length > 0)
        return `monitoring_actuate: call it without values to get the sets of ${job.args.map((a) => a.name).join(', ')} that may run, read back the one meant, and pass it as values.`;
    return null;
}

export interface ProcedureRow {
    /** The program number monitoring_procedure takes. */
    procedure: string;
    name: string;
    nameJa: string;
    /** What the procedure asks of the engine. */
    engine: string;
    /** True when it takes a choice (the gear to engage). */
    takesGear: boolean;
    longest: string | null;
    risk: string;
    preconditions: string[];
    /** Whether the owner's table opens it to the assistant; otherwise it is the screen's. */
    assistantMayStart: boolean;
    /** The gate's answer now (practised first, parked); the dialog measures again before it sends. */
    mayStartNow: boolean;
    reason: RunBlockKey | null;
}

/** SMG II's procedures, matched against the query's words like the jobs are. Empty for any other module. */
export function procedureRows(
    moduleId: string,
    workflows: Smg2Workflows | null,
    startJob: Pick<CatalogJob, 'id' | 'class'> | undefined,
    group: string | undefined,
    ledger: Ledger,
    motion: Motion,
    words: readonly string[],
): ProcedureRow[] {
    if (moduleId !== 'smg2' || !workflows || !startJob) return [];
    return workflows.procedures
        .filter((p) => {
            if (words.length === 0) return true;
            const hay = `${p.id} ${p.name.ja} ${p.name.en} ${p.desc.ja} ${p.desc.en} testprg procedure 手順`.toLowerCase();
            return words.some((w) => hay.includes(w));
        })
        .map((p) => {
            const v = mayRunProcedure(moduleId, startJob, p.id, ledger, motion);
            return {
                procedure: p.id,
                name: p.name.en,
                nameJa: p.name.ja,
                engine: p.engine,
                takesGear: p.auswahl,
                longest: p.durMax || null,
                risk: p.risk,
                preconditions: p.prereq.map((x) => x.en),
                assistantMayStart: decisionFor(moduleId, startJob, group, [p.id]).who === 'ai',
                mayStartNow: v.allowed,
                reason: v.allowed ? null : v.reason,
            };
        });
}

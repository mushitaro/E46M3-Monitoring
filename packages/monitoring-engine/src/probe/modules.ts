/**
 * What the executor needs to know about each module a plan names: what its own SGBD lets the app
 * send it (lib/moduleProtocol), its catalogue jobs with their best telegrams, and the SGBD code that
 * reads its answers where that ships (lib/sgbd/results).
 *
 * Loaded once, before the run, for the plan's modules and the DME (whose block 19 every cycle
 * reads). A module missing from the index stays out of the map, and the executor refuses its steps
 * as `unknown module` rather than guessing an address.
 */
import { jobIndex, loadEcuCatalog, type EcuIndex } from '../ecuCatalog.ts';
import { moduleProtocol } from '../moduleProtocol.ts';
import { loadSgbdResults } from '../sgbd/results.ts';
import { bestTelegram, loadTelegrams } from '../telegrams.ts';
import type { ProbeModule } from './executor.ts';
import { modulesOf, type ProbeStep } from './plan.ts';
import { scanTargets, type ScanTarget } from './scan.ts';

export async function loadProbeModules(steps: readonly ProbeStep[], index: EcuIndex): Promise<Map<string, ProbeModule>> {
    const ids = [...new Set(['mss54', ...modulesOf(steps)])];
    const out = new Map<string, ProbeModule>();
    await Promise.all(
        ids.map(async (id) => {
            const entry = index.modules.find((m) => m.id === id);
            if (!entry) return;
            const [table, profile, results] = await Promise.all([loadTelegrams(id), loadEcuCatalog(id).catch(() => null), loadSgbdResults(id)]);
            const jobs = profile ? jobIndex(profile) : new Map();
            out.set(id, {
                protocol: moduleProtocol(id, entry.address, table),
                job: (jobId) => {
                    const job = jobs.get(jobId);
                    return job ? { job, telegram: bestTelegram(table, jobId) } : null;
                },
                results,
            });
        }),
    );
    return out;
}

/**
 * Every module in the index with what its own SGBD lets the app send it, grouped by address for
 * an all-module scan (lib/probe/scan). A module whose telegram table does not load is still listed:
 * with no frame, its address says it was not asked rather than disappearing from the answer.
 */
export async function loadScanTargets(index: EcuIndex): Promise<ScanTarget[]> {
    const protocols = await Promise.all(index.modules.map(async (m) => moduleProtocol(m.id, m.address, await loadTelegrams(m.id))));
    return scanTargets(protocols);
}

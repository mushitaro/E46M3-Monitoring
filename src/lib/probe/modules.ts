/**
 * What the executor needs to know about each module a plan names: what its own SGBD lets the app
 * send it (lib/moduleProtocol) and its catalogue jobs with their best telegrams.
 *
 * Loaded once, before the run, for the plan's modules and the DME (whose block 19 every cycle
 * reads). A module missing from the index stays out of the map, and the executor refuses its steps
 * as `unknown module` rather than guessing an address.
 */
import { jobIndex, loadEcuCatalog, type EcuIndex } from '../ecuCatalog';
import { moduleProtocol } from '../moduleProtocol';
import { bestTelegram, loadTelegrams } from '../telegrams';
import type { ProbeModule } from './executor';
import { modulesOf, type ProbeStep } from './plan';

export async function loadProbeModules(steps: readonly ProbeStep[], index: EcuIndex): Promise<Map<string, ProbeModule>> {
    const ids = [...new Set(['mss54', ...modulesOf(steps)])];
    const out = new Map<string, ProbeModule>();
    await Promise.all(
        ids.map(async (id) => {
            const entry = index.modules.find((m) => m.id === id);
            if (!entry) return;
            const [table, profile] = await Promise.all([loadTelegrams(id), loadEcuCatalog(id).catch(() => null)]);
            const jobs = profile ? jobIndex(profile) : new Map();
            out.set(id, {
                protocol: moduleProtocol(id, entry.address, table),
                job: (jobId) => {
                    const job = jobs.get(jobId);
                    return job ? { job, telegram: bestTelegram(table, jobId) } : null;
                },
            });
        }),
    );
    return out;
}

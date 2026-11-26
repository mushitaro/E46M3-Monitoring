import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
    EMPTY_LEDGER,
    LinkSession,
    NON_M3_IDENTS,
    agreedCasesFrom,
    bestTelegram,
    configureEcuData,
    fetchEcuDataFromPage,
    kombiIdentData,
    mayActuate,
    moduleProtocol,
    practiceCar,
    resetPracticeCar,
    setPracticeAnswers,
    telegramOfAgreed,
    withAgreedFrames,
    type CatalogJob,
    type EcuDataLoader,
    type EcuIndex,
    type EcuProfile,
    type JobFramesOracle,
    type PracticeFleet,
    type SgbdResultsTable,
    type TelegramTable,
} from '@tsunagi/monitoring-engine';
import { choicesOf } from './agreedChoices';
import { startActuation } from './actuation';
import { STOP_JOB, planProcedure } from './procedureRun';
import type { Smg2Workflows } from './smg2Workflows';
import type { ArmedJob as ArmEntry } from './arming';
import { runCoverage } from './runCoverage';

/**
 * The build practises every item (owner, 2026-11-26: 「全部進める」 — docs/NO-STOP.md §4 D1).
 *
 * The owner's rule of 2026-11-15 is that nothing drives the car before the app's own send path has run
 * it in PRACTICE: the gate's verdict, its permit, the link's battery-and-engine preflight, the frames the
 * job's own code builds (one or several), and its stop. That used to be asked of each device, item by
 * item, which stopped the assistant on every item nobody had pressed in PRACTICE on that navigation unit.
 * Here the build does it instead, for every item the owner's table runs, the M3's and the other E46s',
 * through a LinkSession on the practice car — the same path the screen and the assistant take — and a
 * build where any of them does not run is not delivered (CI, then the demo test, before every deploy).
 */
const DATA = path.resolve(import.meta.dirname, '..', '..', 'public', 'ecu-data');
const HAVE = existsSync(path.join(DATA, 'job-frames.oracle.json'));
const read = <T,>(f: string) => JSON.parse(readFileSync(path.join(DATA, f), 'utf-8')) as T;
const opt = <T,>(f: string): T | null => (existsSync(path.join(DATA, f)) ? read<T>(f) : null);

const fromDisk: EcuDataLoader = async (file) => {
    const p = path.join(DATA, file);
    return existsSync(p) ? { ok: true, status: 200, json: async () => JSON.parse(readFileSync(p, 'utf-8')) } : { ok: false, status: 404, json: async () => null };
};

describe.skipIf(!HAVE)('the build practises every item the owner’s table runs', () => {
    beforeAll(() => configureEcuData(fromDisk));
    afterAll(() => {
        configureEcuData(fetchEcuDataFromPage);
        resetPracticeCar();
    });

    it('through the link session on the practice car: permit, preflight, every frame, and the stop', { timeout: 600_000 }, async () => {
        const index = read<EcuIndex>('index.json');
        const ids = index.modules.map((m) => m.id);
        const oracle = read<JobFramesOracle>('job-frames.oracle.json');
        const profiles = new Map(ids.map((id) => [id, read<EcuProfile>(`${id}.jobs.json`)]));
        const telegrams = new Map(ids.flatMap((id) => { const t = opt<TelegramTable>(`${id}.telegrams.json`); return t ? [[id, t] as const] : []; }));
        const results = new Map(ids.map((id) => [id, opt<SgbdResultsTable>(`${id}.results.json`)]));
        const items = runCoverage({ index, profiles, telegrams, results, oracle }).filter((i) => i.status === 'runs');
        const { practiceFleet } = read<{ practiceFleet: PracticeFleet }>('variants.json');
        setPracticeAnswers(oracle);

        const failed: string[] = [];
        let practised = 0;
        const byModule = Map.groupBy(items, (i) => i.module);
        for (const [moduleId, its] of byModule) {
            const m = index.modules.find((x) => x.id === moduleId)!;
            resetPracticeCar();
            setPracticeAnswers(oracle);
            // The early E46 M3's cluster is KOMBI46 (D_0080: diagnosis index 48–53); the practice car is a late one.
            if (moduleId === 'kombi46') practiceCar.idents = { ...practiceCar.idents, 0x80: { data: kombiIdentData(0x50) } };
            if (m.fit === 'nonm3') {
                const model = Object.values(practiceFleet.models).find((row) => row.module === moduleId);
                practiceCar.idents = model && m.address === 0x12 ? { ...NON_M3_IDENTS, 0x12: model.ident } : { ...NON_M3_IDENTS };
            }
            const table = withAgreedFrames(telegrams.get(moduleId)!, oracle, results.get(moduleId) ?? null);
            const s = new LinkSession({ target: moduleProtocol(moduleId, m.address, table), onPracticed: () => practised++ });
            await s.connect('practice');
            const jobs = profiles.get(moduleId)!.jobs as CatalogJob[];
            for (const item of its) {
                const job = jobs.find((j) => j.id === item.job)!;
                const choices = job.args.length ? choicesOf(job, jobs, (id) => agreedCasesFrom(oracle, results.get(moduleId) ?? null, moduleId, m.address, id)) : [];
                const choice = choices[0];
                const tel = choice ? telegramOfAgreed(choice.start) : bestTelegram(table, job.id);
                const v = mayActuate(job, tel, EMPTY_LEDGER, { moduleId, mode: 'practice', motion: 'parked', group: m.group, ...(choice ? { args: choice.start.args, agreed: choice.start } : {}) });
                if (!v.allowed) {
                    failed.push(`${moduleId}.${job.id}: the practice gate refused (${v.reason})`);
                    continue;
                }
                practiceCar.engineRunning = v.actuation?.engine !== 'off';
                const before = practised;
                let armed: ArmEntry | null = null;
                const started = await startActuation({
                    job,
                    moduleId,
                    verdict: v,
                    phase: item.stopFrames ? 'start' : 'pulse',
                    args: choice?.start.args,
                    stop: choice?.stop,
                    telegrams: table,
                    now: Date.now(),
                    send: (name, hex, requires, permit) => s.runRead(name, hex, requires, permit),
                    arm: (e) => (armed = e),
                });
                if (!started.sent) {
                    failed.push(`${moduleId}.${job.id}: not sent (${s.lastError() ?? 'no answer'})`);
                    continue;
                }
                if (practised === before) failed.push(`${moduleId}.${job.id}: sent, but not recorded as practised (${s.lastError()} | ${JSON.stringify(s.getSnapshot().lastRun ?? null)})`);
                const a = armed as ArmEntry | null;
                if (item.stopFrames && a) {
                    const stopped = await s.runRead(a.stopJobId, a.stopHex, 'none', a.stopPermit);
                    if (!stopped) failed.push(`${moduleId}.${job.id}: its stop ${a.stopJobId} was not sent (${s.lastError() ?? 'no answer'})`);
                }
            }
            await s.disconnect();
            s.dispose();
        }
        // SMG II's fourteen procedures, as the screen's procedure dialog runs them (hooks/useProcedureRun):
        // the test program stopped first, started with its measured permit, asked again, stopped last.
        const workflows = read<Smg2Workflows>('smg2-workflows.json');
        const smg2 = index.modules.find((x) => x.id === 'smg2')!;
        const smgJobs = new Map((profiles.get('smg2')!.jobs as CatalogJob[]).map((j) => [j.id, j]));
        const smgTable = telegrams.get('smg2')!;
        resetPracticeCar();
        setPracticeAnswers(oracle);
        const ps = new LinkSession({ target: moduleProtocol('smg2', smg2.address, smgTable) });
        await ps.connect('practice');
        for (const procedure of workflows.procedures) {
            const r = planProcedure({ procedure, jobs: smgJobs, telegrams: smgTable, mode: 'practice', ...(procedure.auswahl ? { selection: 0 } : {}) });
            if (!r.ok) {
                failed.push(`smg2 procedure ${procedure.id}: not planned (${r.reason})`);
                continue;
            }
            practiceCar.engineRunning = procedure.engine !== 'off';
            const { plan } = r;
            const steps: [string, string, 'none' | 'parked', (typeof plan.permits)[keyof typeof plan.permits]][] = [
                [STOP_JOB, plan.stopHex, 'none', plan.permits.stop],
                [plan.startJobId, plan.startHex, 'parked', plan.permits.start],
                [plan.startJobId, plan.startHex, 'parked', plan.permits.follow],
                [STOP_JOB, plan.stopHex, 'none', plan.permits.stop],
            ];
            for (const [name, hex, requires, permit] of steps) {
                if (!(await ps.runRead(name, hex, requires, permit))) {
                    failed.push(`smg2 procedure ${procedure.id}: ${name} (${permit.kind}) not sent (${ps.lastError() ?? 'no answer'})`);
                    break;
                }
            }
        }
        await ps.disconnect();
        ps.dispose();
        expect(workflows.procedures.length).toBe(14);

        expect(items.length).toBeGreaterThan(700);
        expect(failed.slice(0, 40)).toEqual([]);
        expect(practised).toBeGreaterThanOrEqual(items.length);
    });
});

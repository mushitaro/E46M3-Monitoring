import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { agreedCasesFrom, decisionFor, type CatalogJob, type EcuIndex, type EcuProfile, type JobFramesOracle, type SgbdResultsTable, type TelegramTable } from '@tsunagi/monitoring-engine';
import { assistantPick, choicesOf } from './agreedChoices';
import { runCoverage } from './runCoverage';

/**
 * Every item the owner's table runs, by every way it can be asked (docs/VIRTUAL-CAR-TESTS.md, E):
 * the screen offers its sets, and the assistant gets them — once (pulse) or on (start), without values
 * and with the first set — and a job that stays on until its stop always gets its stop. On the car
 * (2026-11-19) the assistant's pulse found none of SMG II's actuator sets; this holds the whole table.
 */
const DATA = path.resolve(import.meta.dirname, '..', '..', 'public', 'ecu-data');
const HAVE = existsSync(path.join(DATA, 'job-frames.oracle.json'));
const read = <T,>(f: string) => JSON.parse(readFileSync(path.join(DATA, f), 'utf-8')) as T;

describe.skipIf(!HAVE)('every runnable item, every way it is asked', () => {
    it('is offered on the screen and started by the assistant, pulse or start, with its stop', { timeout: 120_000 }, () => {
        const index = read<EcuIndex>('index.json');
        const ids = index.modules.map((m) => m.id);
        const opt = <T,>(f: string): T | null => (existsSync(path.join(DATA, f)) ? read<T>(f) : null);
        const oracle = read<JobFramesOracle>('job-frames.oracle.json');
        const profiles = new Map(ids.map((id) => [id, read<EcuProfile>(`${id}.jobs.json`)]));
        const results = new Map(ids.map((id) => [id, opt<SgbdResultsTable>(`${id}.results.json`)]));
        const items = runCoverage({
            index,
            profiles,
            telegrams: new Map(ids.flatMap((id) => { const t = opt<TelegramTable>(`${id}.telegrams.json`); return t ? [[id, t] as const] : []; })),
            results,
            oracle,
        }).filter((i) => i.status === 'runs');
        const wrong: string[] = [];
        for (const item of items) {
            const m = index.modules.find((x) => x.id === item.module)!;
            const jobs = profiles.get(m.id)!.jobs as CatalogJob[];
            const job = jobs.find((j) => j.id === item.job)!;
            const choices = choicesOf(job, jobs, (id) => agreedCasesFrom(oracle, results.get(m.id) ?? null, m.id, m.address, id));
            if (job.args.length > 0 && !choices.length) {
                wrong.push(`${m.id}.${job.id}: the screen offers no set`);
                continue;
            }
            if (item.who !== 'ai') continue;
            const open = (args: readonly string[]) => decisionFor(m.id, job, m.group, args).who === 'ai';
            for (const phase of ['pulse', 'start'] as const) {
                const ask = assistantPick(job, choices, phase, undefined, open);
                if (job.args.length === 0) {
                    if (!ask.ok) wrong.push(`${m.id}.${job.id} ${phase}: ${ask.reason}`);
                    continue;
                }
                if (ask.ok || !ask.sets?.length) {
                    // The owner's table may keep every set for the screen; that is a reason, not a gap.
                    if (!ask.ok && /person on the screen/.test(ask.reason)) continue;
                    wrong.push(`${m.id}.${job.id} ${phase} without values: ${ask.ok ? 'started without a set' : ask.reason}`);
                    continue;
                }
                const go = assistantPick(job, choices, phase, ask.sets[0], open);
                if (!go.ok) wrong.push(`${m.id}.${job.id} ${phase} with ${ask.sets[0].join(';')}: ${go.reason}`);
                else if (item.stopFrames && !go.choice?.stop && job.args.length > 0 && go.runPhase === 'start' && go.choice?.stop === undefined && choices.some((c) => c.stop)) wrong.push(`${m.id}.${job.id} ${phase}: no stop`);
            }
        }
        expect(wrong.slice(0, 30)).toEqual([]);
        expect(items.length).toBeGreaterThan(700);
    });
});

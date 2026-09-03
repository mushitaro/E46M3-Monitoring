import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { EcuIndex, EcuProfile } from './ecuCatalog';
import { isOn, surfaceOf } from './jobSurface';
import { EMPTY_LEDGER } from './ledger';
import { mayRun } from './runGate';
import { bestTelegram, type TelegramTable } from './telegrams';

const DATA = path.resolve(import.meta.dirname, '..', '..', 'public', 'ecu-data');
const read = <T,>(f: string) => JSON.parse(readFileSync(path.join(DATA, f), 'utf-8')) as T;
const index = read<EcuIndex>('index.json');
const modules = index.modules.map((m) => ({
    id: m.id,
    profile: read<EcuProfile>(`${m.id}.jobs.json`),
    telegrams: read<TelegramTable>(`${m.id}.telegrams.json`),
}));

describe('every job belongs to exactly one tab', () => {
    it('lands on one surface, across all 51 modules', () => {
        // The property that makes this a partition rather than two filters that
        // happen to agree. Two surfaces run a job through DIFFERENT gates —
        // SERVICE via mayRun, ACTUATOR via mayActuate, which is wider in
        // PRACTICE — so a job reachable from both is two answers to "may this be
        // sent", with nothing telling the operator which one they got.
        let counted = 0;
        for (const { id, profile } of modules) {
            for (const job of profile.jobs) {
                const on = [isOn('actuator')(job), isOn('service')(job)].filter(Boolean).length;
                expect(on, `${id}.${job.id} is on ${on} surfaces`).toBe(1);
                counted++;
            }
        }
        expect(counted).toBe(1524);
    });

    it('puts the actuators on ACTUATOR and nothing else there', () => {
        for (const { profile } of modules) {
            for (const job of profile.jobs) {
                expect(surfaceOf(job)).toBe(job.class === 'test' ? 'actuator' : 'service');
            }
        }
    });

    it('gives both surfaces something to show', () => {
        // A partition that is empty on one side is a deletion wearing a rule.
        const counts = { actuator: 0, service: 0 };
        for (const { profile } of modules) for (const j of profile.jobs) counts[surfaceOf(j)]++;
        expect(counts.actuator).toBeGreaterThan(0);
        expect(counts.service).toBeGreaterThan(0);
    });
});

describe('SERVICE carries the whole of what a real car will accept', () => {
    it('holds every job mayRun permits on a vehicle — 96 of them, all reads', () => {
        // This is why SERVICE is not deleted. DIAGNOSIS, ADAPTATION and DATALOG
        // send frames built from the protocol, not catalogue jobs; the hub's
        // SERVICE branch is the only path that sends one. If these ever moved to
        // the actuator side, the app would have no surface for the only thing it
        // can do to a car.
        const runnable: string[] = [];
        for (const { id, profile, telegrams } of modules) {
            for (const job of profile.jobs) {
                if (mayRun(job, bestTelegram(telegrams, job.id), EMPTY_LEDGER, { moduleId: id }).allowed) {
                    runnable.push(`${id}.${job.id}`);
                    expect(surfaceOf(job), `${id}.${job.id}`).toBe('service');
                    expect(job.class).toBe('read');
                }
            }
        }
        // 86 until the telegram extractor stopped filtering frames through a
        // command whitelist written for MSS54. The ten that arrived are reads
        // on control bytes `READ_ONLY_CONTROLS` already named — 0x14 and 0x0d —
        // whose frames had simply never been recovered.
        expect(runnable.length).toBe(96);
    });
});

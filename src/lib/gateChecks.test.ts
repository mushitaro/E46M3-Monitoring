import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { EcuIndex, EcuProfile } from './ecuCatalog';
import { execStyleOf } from './execStyle';
import { allChecked, requiredChecks } from './gateChecks';
import { operationFor } from './jobOps';

const DATA = path.resolve(import.meta.dirname, '..', '..', 'public', 'ecu-data');
const read = <T,>(f: string) => JSON.parse(readFileSync(path.join(DATA, f), 'utf-8')) as T;
const index = read<EcuIndex>('index.json');
const profiles = index.modules.map((m) => [m.id, read<EcuProfile>(`${m.id}.jobs.json`)] as const);
const mss54 = read<EcuProfile>('mss54.jobs.json');
const job = (id: string) => mss54.jobs.find((j) => j.id === id)!;

describe('the boxes a job requires', () => {
    it('is one per precondition, in the job’s own order', () => {
        const j = job('IO_STATUS_VORGEBEN');
        expect(j.preconditions).toEqual(['voltage_ok', 'stationary']);
        expect(requiredChecks(j, operationFor(j))).toEqual([
            'pre:voltage_ok',
            'pre:stationary',
            'ack:irreversible', // irr_pin
        ]);
    });

    it('asks separately about irreversibility and about there being no release', () => {
        // Two different claims. One is about the state afterwards, the other is
        // about whether the app can even try to undo it, and a job can be both —
        // DSC_SIM_* is. A single combined "I understand" would be one click
        // standing in for two facts.
        const dsc = read<EcuProfile>('dsc_e46.jobs.json');
        const sim = dsc.jobs.find((j) => j.id.startsWith('DSC_SIM_'))!;
        const keys = requiredChecks(sim, operationFor(sim));
        expect(keys).toContain('ack:irreversible');
        expect(keys).toContain('ack:unreleasable');
    });

    it('asks for nothing when the SGBD stated nothing and nothing is lost', () => {
        const plain = mss54.jobs.find(
            (j) =>
                j.preconditions.length === 0 &&
                !operationFor(j).irreversible &&
                execStyleOf(operationFor(j)) !== 'pulse-unreleasable',
        )!;
        expect(requiredChecks(plain, operationFor(plain))).toEqual([]);
    });
});

describe('RUN is locked until every box is ticked', () => {
    it('stays locked while one is clear, and unlocks on the last one', () => {
        const j = job('IO_STATUS_VORGEBEN');
        const keys = requiredChecks(j, operationFor(j));
        expect(keys.length).toBe(3);

        const ticked = new Set<string>();
        for (const k of keys) {
            expect(allChecked(keys, ticked)).toBe(false);
            ticked.add(k);
        }
        expect(allChecked(keys, ticked)).toBe(true);
    });

    it('is unlocked immediately when a job requires nothing', () => {
        expect(allChecked([], new Set())).toBe(true);
    });

    it('ignores ticks for boxes the job does not have', () => {
        // A stale tick from a previously-opened job must not unlock this one.
        const keys = requiredChecks(job('IO_STATUS_VORGEBEN'), operationFor(job('IO_STATUS_VORGEBEN')));
        expect(allChecked(keys, new Set(['pre:engine_off', 'ack:unreleasable']))).toBe(false);
    });
});

describe('across everything that ships', () => {
    it('demands an acknowledgement from every irreversible job in all 51 modules', () => {
        const missing: string[] = [];
        for (const [id, p] of profiles) {
            for (const j of p.jobs) {
                const op = operationFor(j);
                if (op.irreversible && !requiredChecks(j, op).includes('ack:irreversible')) {
                    missing.push(`${id}.${j.id}`);
                }
            }
        }
        expect(missing).toEqual([]);
    });

    it('demands one from every job with no release, too', () => {
        const missing: string[] = [];
        let seen = 0;
        for (const [id, p] of profiles) {
            for (const j of p.jobs) {
                const op = operationFor(j);
                if (execStyleOf(op) !== 'pulse-unreleasable') continue;
                seen++;
                if (!requiredChecks(j, op).includes('ack:unreleasable')) missing.push(`${id}.${j.id}`);
            }
        }
        expect(missing).toEqual([]);
        // A rule applied to nothing is not applied.
        expect(seen).toBeGreaterThan(0);
    });
});

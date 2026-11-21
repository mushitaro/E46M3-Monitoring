import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { EcuIndex, EcuProfile } from '@tsunagi/monitoring-engine';
import { execStyleOf } from './execStyle';
import { MEASURE_SHOWN_MS, allChecked, holdsRun, isMeasuredPrereq, lastMeasured, measuredAtSend, procedureMeasured, requiredChecks } from './gateChecks';
import { operationFor } from '@tsunagi/monitoring-engine';

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

describe('what the app measures is not a box (operator, 2026-11-21)', () => {
    const run = { requires: 'parked' as const, actuation: { nature: 'actuate', who: 'screen', engine: 'off' as const, timeoutS: 10, stopJob: null } } as never;
    const runNoEngine = { requires: 'parked' as const, actuation: { nature: 'actuate', who: 'screen', engine: null, timeoutS: 10, stopJob: null } } as never;

    it('a job that drives something: the speed, the battery and the engine its SGBD asks for are measured at the wire', () => {
        expect(measuredAtSend('stationary', run)).toBe(true);
        expect(measuredAtSend('voltage_ok', run)).toBe(true);
        expect(measuredAtSend('engine_off', run)).toBe(true);
        // The engine is measured only as the terms (the job's own preconditions) ask.
        expect(measuredAtSend('engine_off', runNoEngine)).toBe(false);
        expect(measuredAtSend('engine_running', run)).toBe(false);
        // What the link does not measure stays the person's.
        expect(measuredAtSend('ignition_on', run)).toBe(false);
    });

    it('a read: only a parked read’s speed is measured; the battery is not', () => {
        expect(measuredAtSend('stationary', { requires: 'parked' })).toBe(true);
        expect(measuredAtSend('stationary', { requires: 'none' })).toBe(false);
        expect(measuredAtSend('voltage_ok', { requires: 'parked' })).toBe(false);
    });

    it('drops the measured boxes and keeps the acknowledgements', () => {
        const j = job('IO_STATUS_VORGEBEN');
        expect(requiredChecks(j, operationFor(j), run)).toEqual(['ack:irreversible']);
        // Without the verdict (or for a read), the boxes are as before.
        expect(requiredChecks(j, operationFor(j), { requires: 'parked' })).toEqual(['pre:voltage_ok', 'ack:irreversible']);
    });

    it('so RUN needs no tick on a job whose every precondition is measured and nothing is lost', () => {
        const j = mss54.jobs.find((x) => x.preconditions.length > 0 && !operationFor(x).irreversible && execStyleOf(operationFor(x)) !== 'pulse-unreleasable')!;
        expect(j.preconditions.every((p) => ['voltage_ok', 'stationary', 'engine_off'].includes(p))).toBe(true);
        const keys = requiredChecks(j, operationFor(j), run);
        expect(keys).toEqual([]);
        expect(allChecked(keys, new Set())).toBe(true);
    });

    it('every precondition any shipped job lists is one the link measures for a job that drives', () => {
        const seen = new Set<string>();
        for (const [, p] of profiles) for (const j of p.jobs) for (const pre of j.preconditions) seen.add(pre);
        const unmeasured = [...seen].filter((pre) => !measuredAtSend(pre, run));
        expect(unmeasured).toEqual([]);
    });
});

describe('the last measurement beside a measured precondition', () => {
    const at = 1_800_000_000_000;
    const state = { speedKmh: 0, speedCanKmh: 0, rpm: 0, voltageV: 12.6, at, engineAt: at };

    it('says the value and whether the press would pass it', () => {
        expect(lastMeasured('voltage_ok', state, at + 1000)).toEqual({ kind: 'ok', value: 12.6, current: true });
        expect(lastMeasured('stationary', state, at + 1000)).toEqual({ kind: 'ok', value: 0, current: true });
        expect(lastMeasured('engine_off', state, at + 1000)).toEqual({ kind: 'ok', value: 0, current: true });
        expect(lastMeasured('engine_running', state, at + 1000)).toEqual({ kind: 'bad', value: 0, current: true });
    });

    it('fails what the link would refuse: under 12 V, moving, the engine not as asked', () => {
        expect(lastMeasured('voltage_ok', { ...state, voltageV: 11.9 }, at)).toEqual({ kind: 'bad', value: 11.9, current: true });
        expect(lastMeasured('stationary', { ...state, speedKmh: 30, speedCanKmh: 30 }, at)).toEqual({ kind: 'bad', value: 30, current: true });
        expect(lastMeasured('engine_off', { ...state, rpm: 850 }, at)).toEqual({ kind: 'bad', value: 850, current: true });
    });

    it('holds RUN only while the failing reading is current; an older one is shown and the press decides', () => {
        const low = { ...state, voltageV: 11.9 };
        expect(holdsRun(lastMeasured('voltage_ok', low, at + 4000))).toBe(true);
        const older = lastMeasured('voltage_ok', low, at + 30_000);
        expect(older).toEqual({ kind: 'bad', value: 11.9, current: false });
        expect(holdsRun(older)).toBe(false);
        expect(holdsRun(lastMeasured('voltage_ok', state, at))).toBe(false);
        expect(holdsRun({ kind: 'unmeasured' })).toBe(false);
    });

    it('is unmeasured past a minute, or with no reading at all', () => {
        expect(lastMeasured('voltage_ok', state, at + MEASURE_SHOWN_MS + 1)).toEqual({ kind: 'unmeasured' });
        expect(lastMeasured('stationary', state, at + MEASURE_SHOWN_MS + 1)).toEqual({ kind: 'unmeasured' });
        expect(lastMeasured('voltage_ok', null, at)).toEqual({ kind: 'unmeasured' });
        expect(lastMeasured('voltage_ok', { ...state, voltageV: null }, at)).toEqual({ kind: 'unmeasured' });
    });

    it('takes the battery’s age from its own reading, not from a newer speed reading', () => {
        // A voltage carried over from a recording two minutes ago is not "the last minute's".
        const carried = { ...state, at: at + 120_000, engineAt: at };
        expect(lastMeasured('stationary', carried, at + 121_000).kind).toBe('ok');
        expect(lastMeasured('voltage_ok', carried, at + 121_000)).toEqual({ kind: 'unmeasured' });
        expect(lastMeasured('voltage_ok', { ...state, engineAt: undefined }, at)).toEqual({ kind: 'unmeasured' });
    });
});

describe('an SMG II procedure', () => {
    const workflows = read<{ procedures: { id: string; engine: string; prereq: { ja: string; en: string }[] }[] }>('smg2-workflows.json');

    it('measures the speed, the battery and the engine state it names', () => {
        expect(procedureMeasured('off')).toEqual(['voltage_ok', 'stationary', 'engine_off']);
        expect(procedureMeasured('run')).toEqual(['voltage_ok', 'stationary', 'engine_running']);
        expect(procedureMeasured('')).toEqual(['voltage_ok', 'stationary']);
    });

    it('loses exactly one box, the battery’s, in every procedure; the sentences that mix in what is not measured stay', () => {
        expect(workflows.procedures.length).toBeGreaterThan(0);
        for (const p of workflows.procedures) {
            const measured = p.prereq.filter(isMeasuredPrereq);
            expect(measured.map((x) => x.ja), p.id).toEqual(['バッテリ電圧が十分（充電器推奨）']);
            expect(p.prereq.filter((x) => !isMeasuredPrereq(x)).every((x) => /ニュートラル|油温|平坦/.test(x.ja)), p.id).toBe(true);
        }
    });
});

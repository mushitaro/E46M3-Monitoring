import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildArgs, jobCallLine, missingArgs, planLines, visibleArgs } from './actuatorArgs';
import type { EcuIndex, EcuProfile } from './ecuCatalog';
import { execStyleOf } from './execStyle';
import { hasStopControl, operationFor } from './jobOps';

const DATA = path.resolve(import.meta.dirname, '..', '..', 'public', 'ecu-data');
const read = <T,>(f: string) => JSON.parse(readFileSync(path.join(DATA, f), 'utf-8')) as T;
const index = read<EcuIndex>('index.json');
const profiles = index.modules.map((m) => [m.id, read<EcuProfile>(`${m.id}.jobs.json`)] as const);
const mss54 = read<EcuProfile>('mss54.jobs.json');
const job = (id: string) => mss54.jobs.find((j) => j.id === id)!;

const LABELS = { start: 'START', stop: 'STOP' };

describe('the style comes from the operation, not from a name', () => {
    it('holds what the app must stop, and what a companion job stops', () => {
        expect(execStyleOf({ termination: 'app-stop' })).toBe('hold');
        expect(execStyleOf({ termination: 'companion-job' })).toBe('hold');
    });

    it('marks a latching job unreleasable rather than giving it a dead STOP', () => {
        expect(execStyleOf({ termination: 'none' })).toBe('pulse-unreleasable');
    });

    it('agrees with hasStopControl on every job in all 51 modules', () => {
        // Two functions reading one field is one drift away from a UI that shows
        // a STOP button for a style that says there is nothing to stop.
        const disagree: string[] = [];
        for (const [id, p] of profiles) {
            for (const j of p.jobs) {
                const op = operationFor(j);
                if (hasStopControl(op) !== (execStyleOf(op) === 'hold')) disagree.push(`${id}.${j.id}`);
            }
        }
        expect(disagree).toEqual([]);
    });

    it('finds all three styles in the shipped data', () => {
        // A classifier that only ever returns one answer proves nothing.
        const seen = new Set<string>();
        for (const [, p] of profiles) for (const j of p.jobs) seen.add(execStyleOf(operationFor(j)));
        expect([...seen].sort()).toEqual(['hold', 'pulse', 'pulse-unreleasable']);
    });
});

describe('the form hides what the buttons already decide', () => {
    it('hides SCHALTEN, because START and STOP both impose it', () => {
        const j = job('STEUERN_DMTL_HEIZUNG');
        const op = operationFor(j);
        expect(j.args.map((a) => a.name)).toContain('SCHALTEN');
        expect(visibleArgs(j, op).map((a) => a.name)).not.toContain('SCHALTEN');
    });

    it('keeps the duty cycle, because only the STOP value is fixed', () => {
        // IO_STATUS_VORGEBEN: the operator picks what to drive the pin at; only
        // the release is the SGBD's own "00 Stellglied nicht angesteuert".
        const j = job('IO_STATUS_VORGEBEN');
        const names = visibleArgs(j, operationFor(j)).map((a) => a.name);
        expect(names).toEqual(['PIN_NUMMER', 'TASTVERHAELTNIS', 'PERIODENDAUER']);
    });

    it('hides nothing when an operation imposes nothing', () => {
        const j = job('IO_STATUS_LESEN');
        expect(visibleArgs(j, operationFor(j))).toEqual(j.args);
    });
});

describe('what actually goes out', () => {
    it('sends ein to start and aus to stop, from the data', () => {
        const j = job('STEUERN_DMTL_HEIZUNG');
        const op = operationFor(j);
        expect(buildArgs(j, op, {}, 'start')).toEqual({ SCHALTEN: 'ein' });
        expect(buildArgs(j, op, {}, 'stop')).toEqual({ SCHALTEN: 'aus' });
    });

    it('overrides only the duty cycle on stop, and keeps the operator’s period', () => {
        const j = job('IO_STATUS_VORGEBEN');
        const op = operationFor(j);
        const typed = { PIN_NUMMER: '12', TASTVERHAELTNIS: '80', PERIODENDAUER: '20' };
        expect(buildArgs(j, op, typed, 'start')).toEqual(typed);
        expect(buildArgs(j, op, typed, 'stop')).toEqual({
            PIN_NUMMER: '12',
            TASTVERHAELTNIS: '0',
            PERIODENDAUER: '20',
        });
    });

    it('keeps the job’s declared argument order, which the wire depends on', () => {
        const j = job('IO_STATUS_VORGEBEN');
        const built = buildArgs(j, operationFor(j), { PERIODENDAUER: '1', PIN_NUMMER: '2' }, 'pulse');
        expect(Object.keys(built)).toEqual(j.args.map((a) => a.name));
    });

    it('fills an untouched argument with an empty string, not undefined', () => {
        const j = job('IO_STATUS_VORGEBEN');
        expect(buildArgs(j, operationFor(j), {}, 'pulse')).toEqual({
            PIN_NUMMER: '',
            TASTVERHAELTNIS: '',
            PERIODENDAUER: '',
        });
    });
});

describe('the plan the operator agrees to', () => {
    it('is one line for a pulse', () => {
        const j = mss54.jobs.find((x) => x.class === 'test' && x.args.length === 0)!;
        expect(planLines(j, operationFor(j), {}, 'pulse', LABELS)).toEqual([j.id]);
    });

    it('discloses BOTH halves of a hold, including the press people forget', () => {
        const j = job('STEUERN_DMTL_HEIZUNG');
        expect(planLines(j, operationFor(j), {}, 'start', LABELS)).toEqual([
            'START: STEUERN_DMTL_HEIZUNG(SCHALTEN=ein)',
            'STOP: STEUERN_DMTL_HEIZUNG(SCHALTEN=aus)',
        ]);
    });

    it('shows the same call the run would make — one function, two readers', () => {
        const j = job('IO_STATUS_VORGEBEN');
        const op = operationFor(j);
        const v = { PIN_NUMMER: '7', TASTVERHAELTNIS: '40', PERIODENDAUER: '10' };
        const [startLine] = planLines(j, op, v, 'start', LABELS);
        expect(startLine).toBe(`START: ${jobCallLine(j.id, buildArgs(j, op, v, 'start'))}`);
    });

    it('drops the parentheses when there is nothing to pass', () => {
        expect(jobCallLine('FS_LESEN', {})).toBe('FS_LESEN');
    });
});

describe('what is still missing', () => {
    it('names the empty ones, and ignores whitespace', () => {
        const j = job('IO_STATUS_VORGEBEN');
        const op = operationFor(j);
        expect(missingArgs(j, op, {})).toEqual(['PIN_NUMMER', 'TASTVERHAELTNIS', 'PERIODENDAUER']);
        expect(missingArgs(j, op, { PIN_NUMMER: ' ', TASTVERHAELTNIS: '1', PERIODENDAUER: '2' })).toEqual([
            'PIN_NUMMER',
        ]);
    });

    it('never asks for an argument the buttons impose', () => {
        const j = job('STEUERN_DMTL_HEIZUNG');
        expect(missingArgs(j, operationFor(j), {})).toEqual([]);
    });
});

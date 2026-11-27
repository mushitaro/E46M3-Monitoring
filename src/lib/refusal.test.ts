import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { STOP_REASONS } from '@tsunagi/monitoring-engine';
import { refusal } from './refusal';

/**
 * T8 (docs/ASSISTANT-LAYERS.md 5.5): every "not started" the facade answers is one shape — the
 * sentence, the stop of the closed list (or `route` / `state`), and the next step — so the assistant
 * can tell a rule from another tool from a busy tab, and never says "can't" to the last two.
 */
describe('refusal', () => {
    it('gives a stop its own next step, and keeps the sentence the tools have always answered', () => {
        const r = refusal('S1', 'The car is moving.');
        expect(r).toEqual({ started: false, reason: 'The car is moving.', stop: 'S1', next: STOP_REASONS.S1.nextEn });
        expect(refusal('route', 'Use monitoring_procedure.', 'monitoring_procedure with its number.').next).toBe('monitoring_procedure with its number.');
    });

    it('is the only way the facade says "not started"', () => {
        const src = readFileSync(path.resolve(import.meta.dirname, '..', 'hooks', 'useMonitoringFacade.ts'), 'utf-8');
        expect(src.match(/started:\s*false/g) ?? []).toEqual([]);
    });
});

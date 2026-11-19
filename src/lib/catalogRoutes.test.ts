import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { EMPTY_LEDGER, recordPracticeRun, type CatalogJob } from '@tsunagi/monitoring-engine';
import type { Smg2Workflows } from '@/lib/smg2Workflows';
import { isProcedureStart, procedureRows, runWith } from './catalogRoutes';

/**
 * Car, 2026-11-19: monitoring_catalog answered `mayRunNow: false, "takes values"` for SMG II's
 * STEUERN_STELLGLIED, TESTPRG_STARTEN and ADAPTIONSWERTE_LOESCHEN and listed no procedure, though
 * monitoring_procedure's description sends the assistant to the catalogue for the program number.
 */
const file = (name: string) => JSON.parse(fs.readFileSync(`public/ecu-data/${name}`, 'utf8'));
const present = fs.existsSync('public/ecu-data/smg2.jobs.json');

describe.skipIf(!present)('monitoring_catalog: the door of a job that takes values', () => {
    const jobs = present ? (file('smg2.jobs.json').jobs as CatalogJob[]) : [];
    const workflows = present ? (file('smg2-workflows.json') as Smg2Workflows) : null;
    const job = (id: string) => jobs.find((j) => j.id === id)!;

    it('names the tool: the test program is a procedure, the others take a set of values', () => {
        expect(isProcedureStart('smg2', 'TESTPRG_STARTEN')).toBe(true);
        expect(runWith('smg2', job('TESTPRG_STARTEN'))).toMatch(/^monitoring_procedure/);
        expect(runWith('smg2', job('STEUERN_STELLGLIED'))).toMatch(/^monitoring_actuate: call it without values/);
        expect(runWith('smg2', job('ADAPTIONSWERTE_LOESCHEN'))).toMatch(/^monitoring_actuate/);
        expect(runWith('smg2', job('TESTPRG_STOP'))).toBeNull();
    });

    it('lists SMG II’s fourteen procedures by the number monitoring_procedure takes', () => {
        const rows = procedureRows('smg2', workflows, job('TESTPRG_STARTEN'), undefined, EMPTY_LEDGER, 'parked', []);
        expect(rows.map((r) => r.procedure)).toEqual(workflows!.procedures.map((p) => p.id));
        expect(rows).toHaveLength(14);
        const bleed = rows.find((r) => r.procedure === '0x01')!;
        expect(bleed).toMatchObject({ engine: 'off', takesGear: false, assistantMayStart: true });
        expect(bleed.preconditions.length).toBeGreaterThan(0);
        expect(rows.find((r) => r.procedure === '0x0A')!.takesGear).toBe(true);
        // Nothing practised on an empty ledger: the gate's own reason, not a bare no.
        expect(bleed).toMatchObject({ mayStartNow: false, reason: 'run_block_practiceFirst' });
    });

    it('a practised procedure may start parked, and not while the car moves; practising one opens no other', () => {
        const ledger = recordPracticeRun(EMPTY_LEDGER, 'smg2:TESTPRG_STARTEN(0x01)', '2026-11-19T00:00:00.000Z');
        const parked = procedureRows('smg2', workflows, job('TESTPRG_STARTEN'), undefined, ledger, 'parked', []);
        expect(parked.find((r) => r.procedure === '0x01')).toMatchObject({ mayStartNow: true, reason: null });
        expect(parked.find((r) => r.procedure === '0x02')).toMatchObject({ mayStartNow: false });
        const moving = procedureRows('smg2', workflows, job('TESTPRG_STARTEN'), undefined, ledger, 'moving', []);
        expect(moving.find((r) => r.procedure === '0x01')).toMatchObject({ mayStartNow: false, reason: 'run_block_moving' });
    });

    it('matches the query’s words, and is empty for another module', () => {
        const rows = procedureRows('smg2', workflows, job('TESTPRG_STARTEN'), undefined, EMPTY_LEDGER, 'parked', ['bleeding']);
        expect(rows.map((r) => r.procedure)).toEqual(['0x01', '0x05']);
        expect(procedureRows('mss54', workflows, job('TESTPRG_STARTEN'), undefined, EMPTY_LEDGER, 'parked', [])).toEqual([]);
    });
});

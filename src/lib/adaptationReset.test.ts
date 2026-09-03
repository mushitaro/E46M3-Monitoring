import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ADAPTATION_ERASE_ID, ADAPTATION_RESET_JOBS, resetJobsFor } from './adaptationReset';

/**
 * The table in `adaptationReset.ts` is hand-written. This re-derives it from the
 * shipped catalogue so it cannot quietly fall behind.
 *
 * The bug this exists for was real and one commit old: the ADAPTATION pane was
 * built with MSS54's two job ids used for every module, so on SMG II it printed
 * "this module's SGBD has no adaptation-erase job" while the SGBD sat there with
 * ADAPTIONSWERTE_LOESCHEN in it. Nothing would have caught that — the pane was
 * consistent with itself, and only the car would have disagreed.
 */

const DATA = path.resolve(import.meta.dirname, '..', '..', 'public', 'ecu-data');
const MODULES = ['mss54', 'smg2', 'dsc_e46'] as const;

function jobIds(module: string): string[] {
    const raw = readFileSync(path.join(DATA, `${module}.jobs.json`), 'utf-8');
    return (JSON.parse(raw) as { jobs: Array<{ id: string }> }).jobs.map((j) => j.id);
}

describe('the adaptation-erase table matches the catalogue', () => {
    it.each(MODULES)('%s lists exactly the erase jobs the SGBD has', (module) => {
        const found = jobIds(module).filter((id) => ADAPTATION_ERASE_ID.test(id));
        expect([...found].sort()).toEqual([...ADAPTATION_RESET_JOBS[module]].sort());
    });

    it('SMG II is in it — the case the first version got wrong', () => {
        expect(ADAPTATION_RESET_JOBS.smg2).toContain('ADAPTIONSWERTE_LOESCHEN');
    });

    it.each(MODULES)('%s every listed job exists in the catalogue', (module) => {
        const ids = new Set(jobIds(module));
        for (const id of ADAPTATION_RESET_JOBS[module]) expect(ids.has(id)).toBe(true);
    });

    it('every listed job is a write, never a read', () => {
        // If one of these were ever classified `read`, `mayRun` would let it
        // through to the wire. The gate is what stops the app erasing a car's
        // learned values; this asserts the gate is being asked the right question.
        for (const mod of MODULES) {
            const raw = readFileSync(path.join(DATA, `${mod}.jobs.json`), 'utf-8');
            const jobs = (JSON.parse(raw) as { jobs: Array<{ id: string; class: string }> }).jobs;
            for (const id of ADAPTATION_RESET_JOBS[mod]) {
                expect(jobs.find((j) => j.id === id)?.class).not.toBe('read');
            }
        }
    });

    it('fault-memory erasure is NOT in here', () => {
        // FS_LOESCHEN clears fault memory. It has its own confirmed path and its
        // own dialog; pulling it in here would offer it twice, in a section whose
        // copy talks about relearning idle and fuel trim.
        expect(ADAPTATION_ERASE_ID.test('FS_LOESCHEN')).toBe(false);
        expect(ADAPTATION_ERASE_ID.test('FS_SELEKTIV_LOESCHEN')).toBe(false);
    });
});

describe('an unlisted module is unknown, not empty', () => {
    it('distinguishes "checked, none" from "never looked"', () => {
        expect(resetJobsFor('dsc_e46')).toEqual({ known: true, ids: [] });
        expect(resetJobsFor('ews3')).toEqual({ known: false, ids: [] });
    });
});

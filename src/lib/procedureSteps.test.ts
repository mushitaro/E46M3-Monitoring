import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { stepsFromActivity, stepsFromSequence, stepsFromJobFamily } from './procedureSteps';
import { humanName } from '@/components/ui';
import { readResultsFor, type Smg2Workflows } from './smg2Workflows';
import { GEARS, MEASURES, PASSES, gearWindows } from './gearWindows';
import { jobIndex, resultsFor, type EcuProfile } from './ecuCatalog';

/**
 * These run against the real `smg2-workflows.json`, not fixtures. A fixture and
 * the code that reads it come out of the same head and can agree perfectly while
 * the shipped data says something else — which is exactly what happened when 192
 * jobs went missing.
 */
const W: Smg2Workflows = JSON.parse(
    readFileSync(
        path.resolve(import.meta.dirname, '..', '..', 'public', 'ecu-data', 'smg2-workflows.json'),
        'utf-8',
    ),
);

const proc = (id: string) => {
    const p = W.procedures.find((x) => x.id === id);
    if (!p) throw new Error(`no procedure ${id}`);
    return p;
};

describe('activity order is the ECU’s, not the sort function’s', () => {
    // THE test. `activity[]` is in EXECUTION order, which is not numeric order:
    // a complete gearbox adaptation runs 0x00, 0x01, 0x28, 0x29, 0x2A, 0x02,
    // 0x03, 0x04... Sorting it would produce a plausible and wrong sequence, and
    // it would look fine. This is the cheapest possible defence against someone
    // later "fixing" the non-monotonic order.
    it('keeps 0x07 in the order the SGBD lists it', () => {
        const plan = stepsFromActivity(proc('0x07'), 'ja');
        expect(plan.steps.slice(0, 6).map((s) => s.token)).toEqual([
            '0x00',
            '0x01',
            '0x28',
            '0x29',
            '0x2A',
            '0x02',
        ]);
        expect(plan.order).toBe('ecu-defined');
    });

    // The per-gear sweep is the thing the operator actually wants to see, and it
    // is 0x04..0x0A in sequence — not something we assembled.
    it('carries the per-gear sweep, gears 1-6 then reverse', () => {
        const plan = stepsFromActivity(proc('0x07'), 'ja');
        const gears = plan.steps.filter((s) => /Gang [1-6R] ausmessen/.test(s.de ?? ''));
        expect(gears.map((s) => s.token)).toEqual(['0x04', '0x05', '0x06', '0x07', '0x08', '0x09', '0x0A']);
    });

    // `Testprogramm noch nicht gestartet` and `Unbekannter Infotext` are states,
    // not steps, so they get no ordinal — but they are NOT dropped, because a
    // reported 0x00 or 0xFF still needs a row to land on.
    it('numbers the steps and not the sentinels, without dropping either', () => {
        const plan = stepsFromActivity(proc('0x07'), 'ja');
        expect(plan.steps).toHaveLength(proc('0x07').activity.length);
        expect(plan.steps[0].ordinal).toBe(0); // noch nicht gestartet
        expect(plan.steps.at(-1)!.ordinal).toBe(0); // Unbekannter Infotext
        expect(plan.steps[1].ordinal).toBe(1);
        const numbered = plan.steps.filter((s) => s.ordinal > 0).map((s) => s.ordinal);
        expect(numbered).toEqual([...numbered].sort((a, b) => a - b));
    });

    // 0x00 is NOT reliably a sentinel: in 0x01/0x03/0x04 it reads
    // `Testprogramm Initialisierung`, which is genuinely the first thing done.
    it('treats 0x00 as a real step where the German says it is one', () => {
        const plan = stepsFromActivity(proc('0x04'), 'ja');
        expect(plan.steps[0].de).toMatch(/Initialisierung/);
        expect(plan.steps[0].ordinal).toBe(1);
    });
});

describe('live progress', () => {
    it('is absent by default, and every step reads as pending', () => {
        const plan = stepsFromActivity(proc('0x05'), 'ja');
        expect(plan.steps.every((s) => s.state === 'pending')).toBe(true);
    });

    it('splits the list into passed / running / pending at the reported code', () => {
        const plan = stepsFromActivity(proc('0x07'), 'ja', { activityCode: '0x04' });
        const at = plan.steps.findIndex((s) => s.token === '0x04');
        expect(at).toBeGreaterThan(0);
        expect(plan.steps.slice(0, at).every((s) => s.state === 'passed')).toBe(true);
        expect(plan.steps[at].state).toBe('running');
        expect(plan.steps.slice(at + 1).every((s) => s.state === 'pending')).toBe(true);
    });

    // `passed`, never `done`: the ECU reports only the code it is on, and the
    // vocabulary is not guaranteed to be traversed linearly.
    it('never claims an earlier step is done', () => {
        const plan = stepsFromActivity(proc('0x07'), 'ja', { activityCode: '0x08' });
        expect(plan.steps.some((s) => s.state === 'done')).toBe(false);
    });

    it('marks the current step failed when the ECU says it did not end properly', () => {
        const plan = stepsFromActivity(proc('0x07'), 'ja', {
            activityCode: '0x04',
            testStatus: '0x03',
            faultCode: '0x31',
        });
        const at = plan.steps.find((s) => s.token === '0x04')!;
        expect(at.state).toBe('failed');
        expect(at.outcome?.tone).toBe('fail');
        // 0x31 is `Die minimale Fenstergroesse des 1.Ganges wurde unterschritten`.
        expect(at.outcome?.de).toMatch(/Fenstergroesse/);
    });

    // A code outside the vocabulary is the one event most worth seeing: the ECU
    // doing something we cannot name. It gets a row saying so.
    it('reports an unknown code rather than dropping it', () => {
        const plan = stepsFromActivity(proc('0x07'), 'ja', { activityCode: '0xAB' });
        const unknown = plan.steps.filter((s) => s.state === 'unknown');
        expect(unknown).toHaveLength(1);
        expect(unknown[0].token).toBe('0xAB');
    });
});

describe('sequences', () => {
    // The user's own example. This is the list that used to render as
    // `0x01 → 0x05 → 0x04 → 0x03 → 0x02 → 0x07 → 0x08` hex chips.
    it('resolves full_service to seven named procedures in order', () => {
        const seq = W.sequences.find((s) => s.id === 'full_service')!;
        const plan = stepsFromSequence(seq, W.procedures, 'ja');
        expect(plan.steps.map((s) => s.token)).toEqual([
            '0x01',
            '0x05',
            '0x04',
            '0x03',
            '0x02',
            '0x07',
            '0x08',
        ]);
        expect(plan.steps.map((s) => s.ordinal)).toEqual([1, 2, 3, 4, 5, 6, 7]);
        expect(plan.steps[0].name).toContain('クラッチ');
        expect(plan.steps[1].name).toContain('エア抜き');
        // Every step has a real name — none falls back to its hex id.
        expect(plan.steps.every((s) => s.name !== s.token)).toBe(true);
    });

    // The order is ours, not the SGBD's, and the data says so in its own words.
    it('carries the "we made this order up" note verbatim', () => {
        const seq = W.sequences.find((s) => s.id === 'full_service')!;
        const plan = stepsFromSequence(seq, W.procedures, 'ja');
        expect(plan.order).toBe('app-recommended');
        expect(plan.note).toBe(seq.note.ja);
    });
});

describe('job families are sets, not sequences', () => {
    // Numbering DRUCKABBAU_VL "1" would fabricate an order the SGBD does not
    // have. Making that a field is what lets one component render all three
    // shapes honestly.
    it('suppresses ordinals and carries absence as data', () => {
        const plan = stepsFromJobFamily('druckaufbau', [
            { site: 'VL', name: humanName('前左を加圧'), job: 'DRUCKAUFBAU_VL' },
            { site: 'VR', name: humanName('前右を加圧'), job: null, absence: humanName('SGBD に存在しない') },
            { site: 'HA', name: humanName('後軸を加圧'), job: 'DRUCKAUFBAU_HA' },
        ]);
        expect(plan.order).toBe('unordered-set');
        expect(plan.steps.every((s) => s.ordinal === 0)).toBe(true);
        expect(plan.steps[1].absence).toBeTruthy();
        expect(plan.steps[1].ref.kind).toBe('job');
    });
});

describe('recorded values', () => {
    // The one line of glue that did not exist: `readResults: "gearbox"` is a bare
    // string, and nothing mapped it to ADAPTIONSWERTE_LESEN(ADAPTION_LESEN=1).
    // The panel printed the literal word `gearbox` into a readout.
    it('maps every readResults name to a job and an argument value', () => {
        for (const p of W.procedures) {
            const ref = readResultsFor(p);
            if (!p.readResults) {
                expect(ref).toBeNull();
                // ...and says why, in its own words, because the reasons differ.
                expect(p.readResultsNote?.ja).toBeTruthy();
                continue;
            }
            expect(ref).not.toBeNull();
            expect(ref!.job).toBe('ADAPTIONSWERTE_LESEN');
            expect(['0', '1']).toContain(ref!.value);
            expect(ref!.provenance).toBe('inferred');
        }
    });

    it('splits the gearbox block into exactly the 42-cell grid, losing nothing', () => {
        const smg2 = JSON.parse(
            readFileSync(
                path.resolve(import.meta.dirname, '..', '..', 'public', 'ecu-data', 'smg2.jobs.json'),
                'utf-8',
            ),
        ) as EcuProfile;
        const job = jobIndex(smg2).get('ADAPTIONSWERTE_LESEN')!;
        const rows = resultsFor(job, { ADAPTION_LESEN: '1' });
        const grid = gearWindows(rows);

        expect(grid.matched).toBe(42); // 3 measures x 7 gears x 2 passes
        expect(grid.matched + grid.rest.length).toBe(rows.length); // nothing dropped
        for (const g of GEARS) {
            for (const m of MEASURES) {
                for (const p of PASSES) expect(grid.cell(g, m, p)).toBeDefined();
            }
        }
        // Nothing gear-shaped escaped into `rest`.
        expect(grid.rest.filter((r) => /_GANG[1-6R]_ROH[12]_WERT$/.test(r.name))).toHaveLength(0);
    });

    // Not one of the 42 carries a spec. Rendering a verdict for them would be
    // inventing one, so the UI states the absence instead.
    it('confirms the per-gear windows publish no limits at all', () => {
        const smg2 = JSON.parse(
            readFileSync(
                path.resolve(import.meta.dirname, '..', '..', 'public', 'ecu-data', 'smg2.jobs.json'),
                'utf-8',
            ),
        ) as EcuProfile;
        const job = jobIndex(smg2).get('ADAPTIONSWERTE_LESEN')!;
        const grid = gearWindows(resultsFor(job, { ADAPTION_LESEN: '1' }));
        for (const g of GEARS) {
            for (const m of MEASURES) {
                for (const p of PASSES) expect(grid.cell(g, m, p)!.spec).toBeUndefined();
            }
        }
        // ...while the gate positions in the same block DO, and go through SpecTable.
        expect(grid.rest.some((r) => r.name.startsWith('WW_GASSE_') && r.spec)).toBe(true);
    });
});

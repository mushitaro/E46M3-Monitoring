import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { dscStopFrame, type DscHydraulics } from './dscHydraulics';

const H: DscHydraulics = JSON.parse(
    readFileSync(
        path.resolve(import.meta.dirname, '..', '..', 'public', 'ecu-data', 'dsc_e46.hydraulics.json'),
        'utf-8',
    ),
);
const TELEGRAMS: { jobs: Record<string, Array<{ hex: string; cmd: number }>> } = JSON.parse(
    readFileSync(
        path.resolve(import.meta.dirname, '..', '..', 'public', 'ecu-data', 'dsc_e46.telegrams.json'),
        'utf-8',
    ),
);

describe('the constructed stop', () => {
    // The whole justification for offering a STOP the SGBD does not sanction is
    // that the ECU is already told this exact thing by its own compound jobs. If
    // the construct and its evidence ever drift apart, this is what says so.
    it('is byte-identical to the frame the SGBD’s own jobs terminate with', () => {
        const frame = dscStopFrame(H);
        const terminators = Object.entries(TELEGRAMS.jobs)
            .filter(([, ts]) => ts.some((t) => t.hex === H.stop.telegram))
            .map(([job]) => job);

        expect(H.stop.provenance).toBe('app-construct');
        expect(terminators.sort()).toEqual([...H.stop.terminates].sort());
        expect(terminators.length).toBe(22);
        expect(frame).toEqual([0x56, 0x0a, 0x0c, 0xff, 0xf3, 0xff, 0xff, 0x00, 0xff, 0xa3]);
    });

    // Active-LOW: a 0 bit is actuated. So the stop must leave every named output
    // bit SET. `B_ASC`/`B_MSR` are request flags, not outputs, and are excluded.
    it('actuates no named output at all', () => {
        const [, , , b0, b1, b2] = dscStopFrame(H);
        const bytes = [b0, b1, b2];
        const actuated = H.valves.filter((v) => !(bytes[v.byte] & parseInt(v.bit, 16))).map((v) => v.name);
        expect(actuated.sort()).toEqual([...H.requestBits].sort());
    });

    // The runner-up differs only in a bit the STEUERN table does not name. That
    // is carried rather than dropped: we picked by observation, not by knowing.
    it('records the candidate it did not pick, and why it could not decide', () => {
        expect(H.stop.runnersUp).toHaveLength(1);
        expect(H.stop.runnersUp[0].unnamedBits).toEqual(['byte 1 bit 0x02']);
        expect(H.stop.runnersUp[0].jobs).toBeLessThan(H.stop.terminates.length);
    });
});

describe('per-wheel families', () => {
    // The gap is the ECU's. It travels as a row with a reason, so the UI cannot
    // silently render a shorter list.
    it('states that DRUCKAUFBAU_VR does not exist', () => {
        const fam = H.families.find((f) => f.id === 'druckaufbau')!;
        const vr = fam.sites.find((s) => s.site === 'VR')!;
        expect(vr.job).toBeNull();
        expect(vr.absence?.ja).toContain('存在しません');
        // ...and the siblings that DO exist are still offered.
        expect(fam.sites.filter((s) => s.job).map((s) => s.job)).toEqual([
            'DRUCKAUFBAU_VL',
            'DRUCKAUFBAU_HA',
        ]);
    });

    // The corner really is encoded in the bytecode: VL and VR differ by exactly
    // the outlet valve of that corner. This is what fixes the active-low reading.
    it('distinguishes front-left from front-right by their own outlet valve', () => {
        const fam = H.families.find((f) => f.id === 'druckabbau')!;
        const vl = new Set(fam.sites.find((s) => s.site === 'VL')!.drives);
        const vr = new Set(fam.sites.find((s) => s.site === 'VR')!.drives);
        expect(vl.has('AVVL')).toBe(true);
        expect(vl.has('AVVR')).toBe(false);
        expect(vr.has('AVVR')).toBe(true);
        expect(vr.has('AVVL')).toBe(false);
    });

    // Why a wheel diagram would lie: three of these are not corners at all.
    it('carries granularities a car glyph could not represent', () => {
        const li = H.families.find((f) => f.id === 'na_entlueftung')!.sites.find((s) => s.site === 'LI')!;
        expect(li.drives).toEqual(expect.arrayContaining(['EVVL', 'EVHL'])); // a SIDE, two corners
        const ha = H.families.find((f) => f.id === 'druckabbau')!.sites.find((s) => s.site === 'HA')!;
        expect(ha.drives).toEqual(expect.arrayContaining(['EVHL'])); // an AXLE, addressed by HL bits only
        const hold = H.families.find((f) => f.id === 'druckhalten')!.sites[0];
        expect(hold.job).toBe('DRUCKHALTEN'); // no corner in the name at all
        expect(hold.drives).toContain('EVVL');
    });

    it('names only jobs the SGBD actually has', () => {
        const known = new Set(Object.keys(TELEGRAMS.jobs));
        for (const f of H.families) {
            for (const s of f.sites) if (s.job) expect(known.has(s.job)).toBe(true);
        }
    });
});

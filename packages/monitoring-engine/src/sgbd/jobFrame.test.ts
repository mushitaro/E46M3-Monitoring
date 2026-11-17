import { describe, expect, it } from 'vitest';
import { HAVE_SHIPPED_DATA, readShipped } from '../testing/shipped.ts';
import { jobFrameFrom } from './jobFrame.ts';
import type { SgbdResultsTable } from './results.ts';

describe.skipIf(!HAVE_SHIPPED_DATA)('a job’s frame for the values chosen, built by its own code', () => {
    const smg2 = () => readShipped<SgbdResultsTable>('smg2.results.json');

    it('SMG II resets the learned values it names', () => {
        const r = jobFrameFrom(smg2(), 0x32, 'ADAPTIONSWERTE_LOESCHEN', ['0']);
        expect(r).toMatchObject({ ok: true, hex: '32 05 43 00 74' });
    });

    // The screen offers STEUERN_STELLGLIED's actuators from the catalog. Each must build the frame
    // EdiabasLib built for the same values (job-frames.oracle.json): the job looks its STELLGLIEDER
    // table up by name, and a PIN (0x0A) makes it refuse, so an offered PIN would be a choice that
    // sends nothing.
    it('SMG II drives each actuator the screen offers with the frame EdiabasLib builds', () => {
        type Oracle = { jobs: Record<string, { cases: { args: string[]; sends: string[] }[] }> };
        type Jobs = { jobs: { id: string; args: { name: string; options?: { value: string }[] }[] }[] };
        const oracle = readShipped<Oracle>('job-frames.oracle.json').jobs['smg2:STEUERN_STELLGLIED'].cases;
        const job = readShipped<Jobs>('smg2.jobs.json').jobs.find((j) => j.id === 'STEUERN_STELLGLIED')!;
        const offered = job.args[0].options!.map((o) => o.value);
        expect(offered).toContain('HYDROPUMPE');
        for (const name of offered) {
            const args = [name, 'POSITIONSVORGABE', '0'];
            const want = oracle.find((c) => c.args.join(';') === args.join(';'));
            expect(want?.sends, name).toHaveLength(1);
            expect(jobFrameFrom(smg2(), 0x32, 'STEUERN_STELLGLIED', args), name).toMatchObject({ ok: true, hex: want!.sends[0] });
        }
        // Every value EdiabasLib was run with: the same frame where it sent one (the mode and the third
        // value are bytes of their own), and none where it sent none (a PIN in place of the name).
        for (const c of oracle) {
            const r = jobFrameFrom(smg2(), 0x32, 'STEUERN_STELLGLIED', c.args);
            if (c.sends.length) expect(r, c.args.join(';')).toMatchObject({ ok: true, hex: c.sends[0] });
            else expect(r.ok, c.args.join(';')).toBe(false);
        }
    });

    it('says why when the code is not carried, or the job would send elsewhere', () => {
        expect(jobFrameFrom(smg2(), 0x32, 'NO_SUCH_JOB', [])).toMatchObject({ ok: false });
        expect(jobFrameFrom(smg2(), 0x12, 'ADAPTIONSWERTE_LOESCHEN', ['0'])).toMatchObject({ ok: false });
    });
});

describe('the instructions the jobs that take values use', () => {
    // parn (0x80): how many arguments; strlen (0x90): a text's length. Hand-assembled, EdiabasLib's numbering.
    it('counts the arguments and measures a text', async () => {
        const { runSgbdJob } = await import('./vm.ts');
        // parn B0 ; pars S0,#1 ; strlen B1,S0 ; ergb "N",B0 ; ergb "L",B1 ; eoj
        const code = Uint8Array.from([
            0x80, 0x10, 0x00, // parn B0
            0x58, 0x15, 0x1c, 0x01, // pars S0, #1
            0x90, 0x11, 0x01, 0x1c, // strlen B1, S0
            0x34, 0x81, 0x02, 0x00, 0x4e, 0x00, 0x00, // ergb "N", B0
            0x34, 0x81, 0x02, 0x00, 0x4c, 0x00, 0x01, // ergb "L", B1
            0x1d, 0x00, // eoj
        ]);
        const r = runSgbdJob({ code, base: 0 }, { args: ['HYDROPUMPE', 'AKTIV', '0'] });
        expect(r.stopped).toBeNull();
        expect(r.results.map((x) => [x.name, x.value.value])).toEqual([
            ['N', 3],
            ['L', 10],
        ]);
    });
});

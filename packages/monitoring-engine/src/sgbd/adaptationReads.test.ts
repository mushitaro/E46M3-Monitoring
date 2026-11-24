import { describe, expect, it } from 'vitest';
import { HAVE_SHIPPED_DATA, readShipped } from '../testing/shipped.ts';
import { ADAPTATION_READ, adaptationReadJobs } from './adaptationReads.ts';
import { jobFrameFrom } from './jobFrame.ts';
import { answerFrame, decodeRead, type SgbdResultsTable } from './results.ts';

/**
 * The non-M3 E46's DMEs read their learned values with their own SGBD code (GREN BLUE SUITE's test plan
 * §7.2). What is held here: the data carries every such job, the job's own code builds the frame it
 * sends with nothing handed in, and the same code reads an answer to that frame to its end — so a
 * value comes back from the job, not from a layout written here.
 */

const DMES = ['ms420ds0', 'ms430ds0', 'bms43ds0', 'bms46ds0', 'bms46ds1'] as const;
/**
 * Reads that do not yet come back whole from one answer, and why: the VANOS flank adaptation and three
 * of MS43's throttle adaptations read past the end of a string that holds bytes after their first
 * value; MS42's crank-wheel adaptation sends the IDENT first and its read second. Kept apart so that a
 * fix shows up here, not as a quiet pass.
 */
const STOPS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
    ms420ds0: { STATUS_VANOS_NW_FLANKENADAPTION: 'read past the end of a string', STATUS_GEBERRAD_ADAPTION: 'a second send' },
    ms430ds0: {
        STATUS_VANOS_NW_FLANKENADAPTION: 'read past the end of a string',
        STATUS_DK_ADAP_UMA_MECH: 'read past the end of a string',
        STATUS_DK_ADAP_UMA_EL: 'read past the end of a string',
        STATUS_DK_ADAP_LIH: 'read past the end of a string',
    },
};
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join(' ');

describe('the rule', () => {
    it('takes the adaptations and the lambda trims, and nothing that clears or drives', () => {
        for (const j of ['STATUS_LL_ADAPTION', 'STATUS_ADAP_AKTIV', 'STATUS_DK_ADAP_BEDARF', 'STATUS_MUL', 'STATUS_ADD_2', 'STATUS_LAMBDA_MUL_1', 'STATUS_KR_ADAP']) expect(ADAPTATION_READ.test(j)).toBe(true);
        for (const j of ['ADAPT_LOESCHEN', 'ADAPT_LAMBDA_LOESCHEN', 'STATUS_GESCHWINDIGKEIT', 'STATUS_MULTIPLIKATIV', 'STEUERN_LL_STELLER', 'STATUS_LAMBDA_INTEGRATOR']) expect(ADAPTATION_READ.test(j)).toBe(false);
    });
});

describe.skipIf(!HAVE_SHIPPED_DATA)('each non-M3 DME reads its learned values by its own code', () => {
    for (const dme of DMES) {
        it(`${dme}: every learned-value read builds its own frame and reads an answer to it to the end`, () => {
            const table = readShipped<SgbdResultsTable>(`${dme}.results.json`);
            const jobs = adaptationReadJobs(table);
            expect(jobs.length).toBeGreaterThanOrEqual(6);
            for (const job of jobs) {
                const frame = jobFrameFrom(table, 0x12, job, []);
                expect(frame.ok, `${dme} ${job}: ${frame.ok ? '' : frame.why}`).toBe(true);
                if (!frame.ok) continue;
                // An answer long enough for any of them; zeros, so what comes back is the job's own scaling of zero.
                const read = decodeRead(table, job, frame.hex, answerFrame(0x12, 0xa0, new Uint8Array(64)));
                const stops = STOPS[dme]?.[job];
                if (stops) {
                    expect(read?.stopped?.reason, `${dme} ${job}`).toBe(stops);
                    continue;
                }
                // A DS2 status read to the DME: 12 05 0b <block>.
                expect(frame.hex).toMatch(/^12 05 0b [0-9a-f]{2} [0-9a-f]{2}$/);
                expect(read?.stopped, `${dme} ${job}`).toBeNull();
                expect(read?.status).toBe('OKAY');
                expect(read?.values.length, `${dme} ${job}`).toBeGreaterThan(0);
            }
        });
    }

    it('MS43 sends what its own code builds, which is not the frame its telegram table lists', () => {
        const table = readShipped<SgbdResultsTable>('ms430ds0.results.json');
        const telegrams = readShipped<{ jobs: Record<string, { hex: string }[]> }>('ms430ds0.telegrams.json');
        const frame = jobFrameFrom(table, 0x12, 'STATUS_MUL', []);
        expect(frame.ok && frame.hex).toBe('12 05 0b 91 8d');
        expect(telegrams.jobs.STATUS_MUL.map((t) => t.hex)).not.toContain('12 05 0b 91 8d');
    });

    it('a short answer still stops the job, rather than read zeros as a learned value', () => {
        const table = readShipped<SgbdResultsTable>('bms46ds0.results.json');
        const frame = jobFrameFrom(table, 0x12, 'STATUS_MUL', []);
        if (!frame.ok) throw new Error(frame.why);
        const read = decodeRead(table, 'STATUS_MUL', frame.hex, answerFrame(0x12, 0xa0, new Uint8Array(3)));
        expect(read?.stopped?.reason).toBe('read past the end of a string');
        expect(hex(frame.bytes)).toBe(frame.hex);
    });
});

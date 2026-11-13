import { describe, expect, it } from 'vitest';
import { mayJobSend } from '../runGate.ts';
import { HAVE_SHIPPED_DATA, readShipped } from '../testing/shipped.ts';
import { readFaultsByJob } from './faultRead.ts';
import { answerFrame, type SgbdResultsTable } from './results.ts';
import { runSgbdJob, runSgbdJobLive } from './vm.ts';

/**
 * Fault memories read by the module's own FS_LESEN (operator, 2026-11-13). On the car, a scan sent
 * the literal frames the SGBD contains, in a fixed list, and six modules refused: the mirrors were
 * asked for an entry after saying they held none, the light switch and the seats for an argument
 * their job never sends, the steering-angle sensor without the identity its job reads first. The job
 * now conducts the read; these pin what it sends, answer by answer, from the SGBDs in the data.
 */

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join(' ');

/** A module that answers identity with 20 bytes and every fault-read frame with `faults`. */
function module(address: number, faults: number[]) {
    const sent: string[] = [];
    const exchange = async (control: number, payload: Uint8Array) => {
        sent.push(hex(Uint8Array.from([address, payload.length + 4, control, ...payload])));
        if (control === 0x00) return answerFrame(address, 0xa0, new Uint8Array(20).fill(0x30));
        return answerFrame(address, 0xa0, Uint8Array.from(faults));
    };
    return { sent, exchange };
}
const never = () => false;

describe('the gate on what a job sends', () => {
    it('lets a module’s own read go, and its airbag login, and nothing else', () => {
        expect(mayJobSend('lsz', 0xd0, Uint8Array.from([0xd0, 0x05, 0x04, 0x00]))).toMatchObject({ ok: true, control: 0x04 });
        expect(mayJobSend('mrs3', 0xa4, Uint8Array.from([0xa4, 0x06, 0x90, 0xff, 0xff]))).toMatchObject({ ok: true, control: 0x90 });
        expect(mayJobSend('lsz', 0xd0, Uint8Array.from([0xd0, 0x06, 0x90, 0xff, 0xff]))).toMatchObject({ ok: false });
        // An actuator, a clear, another address, a length that lies: never.
        expect(mayJobSend('lsz', 0xd0, Uint8Array.from([0xd0, 0x05, 0x0c, 0x01]))).toMatchObject({ ok: false });
        expect(mayJobSend('lsz', 0xd0, Uint8Array.from([0xd0, 0x04, 0x05]))).toMatchObject({ ok: false });
        expect(mayJobSend('lsz', 0xd0, Uint8Array.from([0x12, 0x05, 0x04, 0x00]))).toMatchObject({ ok: false });
        expect(mayJobSend('lsz', 0xd0, Uint8Array.from([0xd0, 0x09, 0x04, 0x00]))).toMatchObject({ ok: false });
    });
});

describe('the interpreter conducting a read', () => {
    // send S1 → answer into S1; a result in set 1, then strcat.
    const S1 = 0x1d, S2 = 0x1e;
    const str = (b: number[]) => [b.length & 0xff, b.length >> 8, ...b];
    const name = (s: string) => str([...Array.from(s, (c) => c.charCodeAt(0)), 0]);
    const code = Uint8Array.from([
        0x00, 0x48 + 0x00, S1, ...str([0x57, 0x04, 0x00]), // move S1, "57 04 00"
        0x2a, 0x11, S1, S1, // xsend S1, S1
        0x00, 0x48 + 0x00, S2, ...str([0x57, 0x05, 0x04, 0x01]),
        0x2a, 0x11, S2, S2,
        0x40, 0x00, // enewset
        0x39, 0x81, ...name('F_ORT_TEXT'), S2, // ergs
        0x1d, 0x00,
    ]);

    it('answers every send in turn and keeps the sets', async () => {
        const answers = [answerFrame(0x57, 0xa0, Uint8Array.from([1, 2])), answerFrame(0x57, 0xa0, Uint8Array.from([0x41, 0]))];
        const r = await runSgbdJobLive({ code, base: 0 }, { exchange: async () => answers.shift()! });
        expect(r.exchanges.map((x) => hex(x.request))).toEqual(['57 04 00', '57 05 04 01']);
        expect(r.stopped).toBeNull();
        // After the job's first enewset, results go into set 1.
        expect(r.results.find((x) => x.name === 'F_ORT_TEXT')?.set).toBe(1);
    });

    it('ends the job where a send is refused, with why', async () => {
        const r = await runSgbdJobLive({ code, base: 0 }, { exchange: async () => { throw new Error('not sent: control 0x0c is not a read'); } });
        expect(r.stopped?.reason).toMatch(/not a read/);
        expect(r.exchanges).toHaveLength(1);
    });

    it('still checks a single recorded exchange the old way', () => {
        expect(runSgbdJob({ code, base: 0 }, {}).request).toEqual(Uint8Array.from([0x57, 0x04, 0x00]));
    });
});

describe.skipIf(!HAVE_SHIPPED_DATA)('the six that refused on the car, by their own jobs', () => {
    const table = (id: string) => readShipped<SgbdResultsTable>(`${id}.results.json`);

    it('door mirror: one frame when it holds no entry, so the refused 04 01 is never sent', async () => {
        const m = module(0x9b, [0x00]);
        const r = await readFaultsByJob(table('spm46ft'), 'spm46ft', 0x9b, m.exchange, never);
        expect(m.sent).toEqual(['9b 05 04 00']);
        expect(r).toMatchObject({ outcome: 'answered', read: { status: 'OKAY', faults: [] } });
    });

    it('light switch and seats: 04 00 first, not the argument 1e they refused', async () => {
        for (const [id, addr] of [['lsz', 0xd0], ['sm46c_5', 0x72]] as const) {
            const m = module(addr, [0x00]);
            const r = await readFaultsByJob(table(id), id, addr, m.exchange, never);
            expect(m.sent[0]).toBe(`${addr.toString(16)} 05 04 00`);
            expect(m.sent.some((s) => s.endsWith(' 1e'))).toBe(false);
            expect(r.read.status).toBe('OKAY');
        }
    });

    it('steering angle: its identity first, as its job reads it, then the entries', async () => {
        const m = module(0x57, [0x00]);
        await readFaultsByJob(table('lws5'), 'lws5', 0x57, m.exchange, never);
        expect(m.sent).toEqual(['57 04 00', '57 05 04 01']);
    });

    it('airbag MRS3: its login, then the count', async () => {
        const m = module(0xa4, [0x00]);
        const r = await readFaultsByJob(table('mrs3'), 'mrs3', 0xa4, m.exchange, never);
        expect(m.sent.slice(0, 2)).toEqual(['a4 06 90 ff ff', 'a4 05 04 00']);
        expect(r.outcome).toBe('answered');
    });

    it('modules the old table could not ask at all (SZM, ALC, CD changer) now are', async () => {
        for (const [id, addr, first] of [['szm46', 0xf5, 'f5 05 04 01'], ['alc_ds2', 0x66, '66 05 04 00'], ['cdc_46', 0x76, '76 04 04']] as const) {
            const m = module(addr, [0x00]);
            await readFaultsByJob(table(id), id, addr, m.exchange, never);
            expect(m.sent[0]).toBe(first);
        }
    });

    it('one entry comes back with the SGBD’s own code and text', async () => {
        const m = module(0x9b, [0x01, 0x05, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
        const r = await readFaultsByJob(table('spm46ft'), 'spm46ft', 0x9b, m.exchange, never);
        expect(m.sent[0]).toBe('9b 05 04 00');
        expect(r.read.faults.length).toBeGreaterThanOrEqual(1);
        expect(typeof r.read.faults[0].code).toBe('number');
    });

    it('a module that is not there is silent, not refused', async () => {
        const r = await readFaultsByJob(table('alc_ds2'), 'alc_ds2', 0x66, async () => { throw Object.assign(new Error('timeout'), { silent: true }); }, (e) => (e as { silent?: boolean }).silent === true);
        expect(r.outcome).toBe('silent');
    });
});

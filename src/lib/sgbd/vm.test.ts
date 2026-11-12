import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runSgbdJob, type SgbdJobCode } from './vm';

/**
 * The interpreter against the one execution trace we have of a real job on the real car: EdiabasLib
 * running MSS54DS0's IDENT, every instruction with its operands before and after
 * (`E46M3-Monitoring-data/evidence/ifh.trc`). Private data — the answer carries the car's part
 * numbers — so it is read where it lies and nothing of it is written here; without it the test skips.
 */
const DATA = process.env.MONITORING_DATA_DIR ?? path.resolve(import.meta.dirname, '..', '..', '..', '..', 'E46M3-Monitoring-data');
const TRACE = path.join(DATA, 'evidence', 'ifh.trc');
const PRG = path.join(DATA, 'sgbd', 'prg', 'MSS54DS0.prg');
const HAVE = existsSync(TRACE) && existsSync(PRG);

const hexBytes = (s: string) => Uint8Array.from(s.trim().split(/\s+/), (x) => parseInt(x, 16));

/** The job table of a PRG: name → [start, end) in the de-scrambled file. */
export function prgJob(prg: Uint8Array, name: string): SgbdJobCode {
    const dex = prg.map((b) => b ^ 0xf7);
    const view = new DataView(prg.buffer, prg.byteOffset, prg.byteLength);
    const tab = view.getUint32(0x88, true);
    const count = view.getInt32(tab, true);
    const jobs: Array<{ name: string; off: number }> = [];
    for (let i = 0; i < count; i++) {
        const rec = dex.slice(tab + 4 + i * 68, tab + 4 + (i + 1) * 68);
        const nul = rec.indexOf(0);
        const n = String.fromCharCode(...rec.slice(0, nul < 0 || nul > 64 ? 64 : nul));
        const off = new DataView(rec.buffer, rec.byteOffset + 64, 4).getUint32(0, true);
        jobs.push({ name: n, off });
    }
    jobs.sort((a, b) => a.off - b.off);
    const k = jobs.findIndex((j) => j.name === name);
    if (k < 0) throw new Error(`no job ${name}`);
    const end = k + 1 < jobs.length ? jobs[k + 1].off : dex.length;
    return { code: dex.slice(jobs[k].off, end), base: jobs[k].off };
}

describe.skipIf(!HAVE)('the interpreter replays the car trace of MSS54 IDENT', () => {
    const lines = HAVE ? readFileSync(TRACE, 'latin1').split(/\r?\n/) : [];
    const prg = HAVE ? new Uint8Array(readFileSync(PRG)) : new Uint8Array(0);
    const job = HAVE ? prgJob(prg, 'IDENT') : { code: new Uint8Array(0), base: 0 };
    const end = job.base + job.code.length;

    // The trace runs INITIALISIERUNG inside IDENT's first lines; IDENT's own instructions are those
    // whose address lies in its code.
    const visitedInTrace = lines
        .map((l) => /^>([0-9A-F]{8}): /.exec(l))
        .filter((m): m is RegExpExecArray => !!m)
        .map((m) => parseInt(m[1], 16))
        .filter((a) => a >= job.base && a < end);
    const sent = hexBytes(lines.find((l) => l.startsWith(' (Send):'))!.slice(8));
    const answer = hexBytes(lines.find((l) => l.startsWith(' (Resp):'))!.slice(8));
    const traceResults = lines
        .map((l) => /^>[0-9A-F]{8}: erg(\w) #"(\w+)", \w+: (.*)$/.exec(l))
        .filter((m): m is RegExpExecArray => !!m && m[2] !== 'DONE')
        .map((m) => ({ name: m[2], raw: m[3] }));

    // The trace file ends mid-job (it was cut at ID_PROD_NR), so both checks cover what it holds,
    // and the run itself must still reach the job's end.
    it('visits the same instructions in the same order', () => {
        const visited: number[] = [];
        const run = runSgbdJob(job, { sent, answer, tables: { JOBRESULT: [['SB', 'STATUS_TEXT'], ['0xA0', 'OKAY'], ['0xFF', 'ERROR_ECU_UNKNOWN_STATUSBYTE']] }, onStep: (a) => visited.push(a) });
        expect(run.stopped).toBeNull();
        expect(visitedInTrace.length).toBeGreaterThan(1000);
        expect(visited.length).toBeGreaterThanOrEqual(visitedInTrace.length);
        const firstDiff = visitedInTrace.findIndex((a, i) => a !== visited[i]);
        expect(firstDiff, `first divergence at step ${firstDiff}: 0x${visited[firstDiff]?.toString(16)} vs 0x${visitedInTrace[firstDiff]?.toString(16)}`).toBe(-1);
    });

    it('reports every result the trace reports, with the same value', () => {
        const run = runSgbdJob(job, { sent, answer, tables: { JOBRESULT: [['SB', 'STATUS_TEXT'], ['0xA0', 'OKAY'], ['0xFF', 'ERROR_ECU_UNKNOWN_STATUSBYTE']] } });
        const mine = run.results.filter((r) => r.name !== 'DONE' && r.name !== 'ID_EWS_SS');
        const inTrace = traceResults.filter((r) => r.name !== 'ID_EWS_SS').map((r) => r.name);
        expect(inTrace.length).toBeGreaterThan(8);
        expect(mine.map((r) => r.name).slice(0, inTrace.length)).toEqual(inTrace);
        for (const t of traceResults) {
            const r = run.results.find((x) => x.name === t.name)!;
            const quoted = /^"(.*)"$/.exec(t.raw);
            const braced = /^\{(.*)\}$/.exec(t.raw);
            if (quoted) expect(r.value, t.name).toEqual({ kind: 'text', value: quoted[1] });
            else if (braced) {
                const text = String.fromCharCode(...braced[1].split(',').filter(Boolean).map((x) => parseInt(x.replace(/[$.B]/g, ''), 16)).filter((c) => c !== 0));
                expect(r.value, t.name).toEqual({ kind: 'text', value: text });
            }
            else expect((r.value as { value: number }).value, t.name).toBe(parseInt(t.raw.replace('$', ''), 16));
        }
    });
});

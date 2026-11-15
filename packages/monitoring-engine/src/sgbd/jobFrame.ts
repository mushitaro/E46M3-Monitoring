/**
 * The frame a job that takes values sends for the values chosen, built by the job's own code.
 *
 * The owner decided (2026-11-15) that the jobs that drive something run with values chosen on the
 * screen: SMG II's STEUERN_STELLGLIED (which actuator, active or not), the DME's pin forcing, the
 * resets that name what they reset. A scraped frame carries values nobody chose, and a template
 * filled here would be this app's reading of the SGBD. So the module's own SGBD code is run, dry,
 * with the values as EDIABAS takes them (strings, first argument first): it stops at its send and
 * the frame it built is the one to send (sgbd/vm.ts `runSgbdJob` without `sent`). The interface adds
 * the checksum, as EDIABAS's does.
 *
 * The code is carried for these jobs only where the dump has every table they read
 * (tools/gen_sgbd_results.py). A job whose code is not carried is shown and not run.
 */
import { runSgbdJob, type SgbdJobCode } from './vm.ts';
import { loadSgbdResults, type SgbdResultsTable } from './results.ts';

export type JobFrame = { ok: true; hex: string; bytes: Uint8Array } | { ok: false; why: string };

const fromBase64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const hexOf = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join(' ');

/** Whether the module's own code for this job is carried (so its frame can be built for chosen values). */
export function hasJobCode(table: SgbdResultsTable | null, jobId: string): boolean {
    return !!table?.jobs[jobId];
}

/** The frame the job builds for these values, from a loaded table. Pure. */
export function jobFrameFrom(table: SgbdResultsTable | null, address: number, jobId: string, args: readonly string[]): JobFrame {
    const entry = table?.jobs[jobId];
    if (!table || !entry) return { ok: false, why: `the code of ${jobId} is not carried` };
    const job: SgbdJobCode = { code: fromBase64(entry.code), base: entry.base };
    let run;
    try {
        run = runSgbdJob(job, { args, tables: table.tables });
    } catch (e) {
        return { ok: false, why: `the job did not run: ${e instanceof Error ? e.message : String(e)}` };
    }
    const req = run.request;
    if (!req) return { ok: false, why: run.stopped ? `the job stopped before sending: ${run.stopped.reason}` : 'the job sent nothing' };
    if (req.length < 3 || req[0] !== address) return { ok: false, why: `the job would send ${hexOf(req)}, not to this module` };
    // The interface appends the XOR checksum; the job's string carries none.
    const bytes = new Uint8Array(req.length + 1);
    bytes.set(req);
    bytes[req.length] = req.reduce((x, b) => x ^ b, 0);
    if (bytes[1] !== bytes.length) return { ok: false, why: `the job built ${hexOf(bytes)}, whose length byte is not its length` };
    return { ok: true, hex: hexOf(bytes), bytes };
}

/** The frame the job builds for these values. */
export async function buildJobFrame(moduleId: string, address: number, jobId: string, args: readonly string[]): Promise<JobFrame> {
    return jobFrameFrom(await loadSgbdResults(moduleId), address, jobId, args);
}

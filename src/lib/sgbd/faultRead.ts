/**
 * A module's fault memory read by its own FS_LESEN job (operator, 2026-11-13: 「全部読めるようにしろ」).
 *
 * The frames the app used to send were the literals found in the SGBD, sent in a fixed list. But the
 * job does not send a fixed list: it reads the count first, then asks for as many entries as there
 * are; some send their IDENT or a login first. Sent blindly, the list met refusals — the door mirrors
 * refuse `04 01` because they hold no entry to send, the light switch and the seats were sent an
 * argument their job never sends. So the job itself conducts the read here (lib/sgbd/vm
 * `runSgbdJobLive`): each frame it builds is checked (runGate `mayJobSend`: to this module, a read or
 * the access its own job sends first) and sent through the link; each answer goes back to the job,
 * which decides what to send next and names what it found, entry by entry, with its own text.
 *
 * Nothing here talks to the line: `exchange` is the caller's, and refusing a frame is the gate's.
 */
import { mayJobSend } from '../runGate';
import { faultsOfRun, type SgbdFaultRead, type SgbdResultsTable } from './results';
import { runSgbdJobLive, type SgbdTables } from './vm';

export interface JobFaultRead {
    outcome: 'answered' | 'rejected' | 'silent' | 'refused';
    /** What the job found, in the form a recorded read's decode gives (lib/sgbd/results). */
    read: SgbdFaultRead;
    exchanges: Array<{ request: string; response: string | null; refused?: string }>;
    reason?: string;
    provenance: 'sgbd-job';
}

/** One frame to the module: its answer as it came off the line (address, length, status, data, checksum). */
export type JobExchange = (control: number, payload: Uint8Array) => Promise<Uint8Array>;

const fromBase64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join(' ');
const withSum = (b: Uint8Array) => {
    let x = 0;
    for (const v of b) x ^= v;
    return Uint8Array.from([...b, x]);
};

class Gate extends Error {}
class Silent extends Error {}

/** Whether the table carries the module's own FS_LESEN. */
export const hasFaultJob = (table: SgbdResultsTable | null): boolean => !!table?.jobs.FS_LESEN;

/**
 * Runs the module's FS_LESEN on the car through `exchange`. `isSilence` tells a module that is not
 * there from any other failure: the job ends on it, as EDIABAS's does.
 */
export async function readFaultsByJob(
    table: SgbdResultsTable,
    moduleId: string,
    address: number,
    exchange: JobExchange,
    isSilence: (e: unknown) => boolean,
): Promise<JobFaultRead> {
    const job = table.jobs.FS_LESEN;
    const exchanges: JobFaultRead['exchanges'] = [];
    let refusedBy: string | null = null;
    let silent = false;
    const run = await runSgbdJobLive(
        { code: fromBase64(job.code), base: job.base },
        {
            tables: table.tables as SgbdTables,
            exchange: async (req) => {
                const ok = mayJobSend(moduleId, address, req);
                if (!ok.ok) {
                    refusedBy = ok.why;
                    throw new Gate(`not sent: ${ok.why}`);
                }
                try {
                    const answer = await exchange(ok.control, ok.payload);
                    const status = answer[2];
                    exchanges.push({
                        request: hex(withSum(req)),
                        response: hex(answer.slice(3, answer.length - 1)),
                        ...(status !== 0xa0 ? { refused: `status 0x${status.toString(16).padStart(2, '0')}` } : {}),
                    });
                    return answer;
                } catch (e) {
                    exchanges.push({ request: hex(withSum(req)), response: null });
                    if (isSilence(e)) {
                        silent = true;
                        throw new Silent('no answer');
                    }
                    throw e;
                }
            },
        },
    );
    // The job's verdict: in the set it reports after the entries (or the only one).
    const read = faultsOfRun(run.results, run.stopped);
    const jobStatus = read.status;
    const answered = exchanges.some((x) => x.response !== null && !x.refused);
    // Answered when the module answered and the job got to its verdict; refused by the module when a
    // status said no; otherwise the bytes that came back are kept and the reason says where it ended.
    const outcome: JobFaultRead['outcome'] = refusedBy && exchanges.length === 0
        ? 'refused'
        : silent && !answered
          ? 'silent'
          : exchanges.some((x) => x.refused) && jobStatus !== 'OKAY'
            ? 'rejected'
            : answered
              ? 'answered'
              : 'silent';
    const reason = refusedBy ?? (run.stopped ? run.stopped.reason : jobStatus && jobStatus !== 'OKAY' ? jobStatus : undefined);
    return { outcome, read, exchanges, ...(reason ? { reason } : {}), provenance: 'sgbd-job' };
}

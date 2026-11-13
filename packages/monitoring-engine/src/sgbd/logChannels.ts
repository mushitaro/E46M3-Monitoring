'use client';

/**
 * Another module's values as DATALOG channels: `module:JOB:RESULT`, the same names PROBE samples
 * (lib/probe/plan `moduleChannel`). A channel exists where the module's SGBD code for reading that
 * job's answer ships (lib/sgbd/results) and the job takes no argument; its name and unit are the
 * catalogue's. Each is read once per sample, through the run gate, by the job's own code — so a
 * read that may go only parked is empty while the car moves.
 */

import type { Ds2Frame } from '@tsunagi/ds2-core';
import { jobIndex, loadEcuCatalog, text, type CatalogJob, type EcuProfile } from '../ecuCatalog.ts';
import type { Ledger } from '../ledger.ts';
import { mayRun, telegramBytes } from '../runGate.ts';
import { bestTelegram, loadTelegrams, type Telegram } from '../telegrams.ts';
import type { Motion } from '../vehicleState.ts';
import { answerFrame, decodeRead, loadSgbdResults, type SgbdResultsTable } from './results.ts';


export interface ModuleChannelInfo {
    channel: string;
    module: string;
    job: string;
    result: string;
    name: string;
    ja: string;
    unit: string | null;
}

const CHANNEL = /^([a-z0-9_]{2,32}):([A-Z0-9_]{2,64}):([A-Z0-9_]{1,64})$/;

export const isModuleChannel = (c: string) => CHANNEL.test(c) && !c.startsWith('ram:');

interface ModuleData {
    address: number;
    profile: EcuProfile;
    jobs: Map<string, CatalogJob>;
    telegrams: Awaited<ReturnType<typeof loadTelegrams>>;
    results: SgbdResultsTable;
}

const data = new Map<string, Promise<ModuleData | null>>();

/** The module's catalogue, telegrams and SGBD reading code, or null where any is missing. */
export function moduleLogData(module: string, address: number): Promise<ModuleData | null> {
    let hit = data.get(module);
    if (!hit) {
        hit = Promise.all([loadEcuCatalog(module).catch(() => null), loadTelegrams(module), loadSgbdResults(module)]).then(([profile, telegrams, results]) =>
            profile && results ? { address, profile, jobs: jobIndex(profile), telegrams, results } : null,
        );
        data.set(module, hit);
    }
    return hit;
}

/** Every channel a module offers DATALOG: each numeric result of each argument-free job whose code ships. */
export function moduleChannels(module: string, d: ModuleData): ModuleChannelInfo[] {
    const out: ModuleChannelInfo[] = [];
    for (const jobId of Object.keys(d.results.jobs)) {
        // The fault read is conducted by its own job (sgbd/faultRead), not sampled.
        if (jobId.startsWith('FS_')) continue;
        const job = d.jobs.get(jobId);
        const tel = bestTelegram(d.telegrams, jobId);
        if (!job || job.class !== 'read' || job.args.length > 0 || !tel) continue;
        // The units are constants in the job's own code (`…_EINH`): read them by running it once on
        // an answer of zeros long enough for every value. Nothing is sent. A job whose code would
        // send another frame than the table's, or a second one, cannot be read from one answer:
        // it offers no channel rather than an empty one.
        const probe = decodeRead(d.results, jobId, tel.hex, answerFrame(d.address, 0xa0, new Uint8Array(240)));
        if (!probe || (probe.stopped && /would send|second send|did not make/.test(probe.stopped.reason))) continue;
        const units = new Map<string, string | null>();
        for (const v of probe.values) units.set(v.name, v.unit);
        for (const r of job.results) {
            if (r.role !== 'value' && r.role !== 'status') continue;
            if (r.type === 'string' || r.name === 'JOB_STATUS') continue;
            out.push({
                channel: `${module}:${jobId}:${r.name}`,
                module,
                job: jobId,
                result: r.name,
                name: text(d.profile, r.comment, 'en').text || r.name,
                ja: text(d.profile, r.comment, 'ja').text || r.name,
                unit: units.get(r.name) ?? null,
            });
        }
    }
    return out;
}

/** One module read job a DATALOG run records, with what it needs to go. */
export interface ModuleLogRead {
    module: string;
    address: number;
    job: CatalogJob;
    telegram: Telegram | null;
    results: SgbdResultsTable;
    /** The results of this job the run records. */
    wanted: Set<string>;
}

/** The reads a selection needs, one per (module, job); null entries for channels no read can give. */
export async function moduleLogReads(channels: readonly string[], addressOf: (module: string) => number | null): Promise<{ reads: ModuleLogRead[]; unknown: string[] }> {
    const reads = new Map<string, ModuleLogRead>();
    const unknown: string[] = [];
    for (const c of channels) {
        const m = CHANNEL.exec(c);
        if (!m || m[1] === 'ram') continue;
        const [, module, jobId, result] = m;
        const address = addressOf(module);
        const d = address === null ? null : await moduleLogData(module, address);
        const job = d?.jobs.get(jobId);
        if (!d || !job || job.args.length > 0 || !d.results.jobs[jobId] || !job.results.some((r) => r.name === result)) {
            unknown.push(c);
            continue;
        }
        const key = `${module}:${jobId}`;
        const read = reads.get(key) ?? { module, address: d.address, job, telegram: bestTelegram(d.telegrams, jobId), results: d.results, wanted: new Set<string>() };
        read.wanted.add(result);
        reads.set(key, read);
    }
    return { reads: [...reads.values()], unknown };
}

/**
 * Whether this read may go on this sample, and its frame. `null` frame: not now (moving, or not
 * measured stationary), the values of this sample are empty. A refusal for any other reason is
 * returned as `refused`, and the run stops reading it.
 */
export function moduleLogGate(read: ModuleLogRead, ledger: Ledger, motion: Motion): { frame: Uint8Array | null } | { refused: string } {
    const v = mayRun(read.job, read.telegram, ledger, { moduleId: read.module, motion });
    if (!v.allowed) return v.reason === 'run_block_moving' ? { frame: null } : { refused: v.reason };
    if (v.requires === 'parked' && motion !== 'parked') return { frame: null };
    const bytes = telegramBytes(v.telegram.hex);
    if (!bytes || bytes[0] !== read.address) return { refused: 'run_block_noTelegram' };
    return { frame: bytes };
}

/** The values one answer gives the channels this read records. */
export function moduleLogValues(read: ModuleLogRead, sent: Uint8Array, frame: Ds2Frame): Record<string, number | null> {
    const hex = Array.from(sent, (x) => x.toString(16).padStart(2, '0')).join(' ');
    const decoded = decodeRead(read.results, read.job.id, hex, answerFrame(frame.address, frame.controlOrStatus, frame.payload));
    const out: Record<string, number | null> = {};
    for (const r of read.wanted) out[`${read.module}:${read.job.id}:${r}`] = null;
    for (const v of decoded?.values ?? []) {
        if (read.wanted.has(v.name) && typeof v.value === 'number') out[`${read.module}:${read.job.id}:${v.name}`] = v.value;
    }
    return out;
}

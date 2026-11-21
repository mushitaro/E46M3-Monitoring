/**
 * ADAPTATION's adjustments: a module's calibration jobs that set a zero point (`…ABGLEICH…` —
 * the steering angle sensor's zero, the DSC sensors'), and whether one may run here.
 *
 * A job that drives something runs only as the frames its own SGBD code builds where EdiabasLib builds
 * the same (sgbd/agreedFrame), through the one gate (`mayRun`). Where that is not so, the screen says
 * why in the owner's words — and what is outside the app is said as such: a job whose code also sends
 * to another module, a write in that module's own SGBD (DSC_E46's ABGLEICH_LWS_AQ_SENSOREN programs the
 * steering angle sensor's zero, the LWS5's own ABGLEICH_SCHREIBEN frame), or a job EdiabasLib's run of
 * which sends nothing past the identification.
 */
import {
    agreedFrame,
    decisionFor,
    loadEcuIndex,
    loadJobFramesOracle,
    loadTelegrams,
    mayActuate,
    telegramOfAgreed,
    type ActuationMode,
    type CatalogJob,
    type EcuProfile,
    type Ledger,
    type Motion,
    type RunVerdict,
} from '@tsunagi/monitoring-engine';

/** The calibration jobs that set a zero point, in the module's own catalogue. */
export function adjustmentJobs(profile: EcuProfile | null): CatalogJob[] {
    return (profile?.jobs ?? []).filter((j) => j.class === 'calibration' && /ABGLEICH/.test(j.id) && j.args.length === 0);
}

export type AdjustmentStatus =
    | { kind: 'gate'; verdict: RunVerdict }
    /** Its own code also sends to the module at `address`; `write` names that module's own write job sending the same frame. */
    | { kind: 'otherModule'; address: number; module: string | null; write: string | null }
    /** EdiabasLib's run of it sends nothing (or only an identification read): what it sends after is not known. */
    | { kind: 'sendsNothing' }
    /** EdiabasLib was not run with it, or the two do not build the same frames. */
    | { kind: 'notAgreed'; why: string };

const hex2 = (n: number) => n.toString(16).padStart(2, '0');

/**
 * `mode` is the link's: on the practice car the answer is the one SERVICE's hub gives there
 * (`mayActuate` in PRACTICE), so the row does not say 「PRACTICE で一度実行してください」 to someone
 * who is in PRACTICE (UX-31). On a vehicle `mayActuate` is `mayRun`, unchanged.
 */
export async function adjustmentStatus(moduleId: string, address: number, job: CatalogJob, ledger: Ledger, motion: Motion, mode: ActuationMode = 'vehicle'): Promise<AdjustmentStatus> {
    const r = await agreedFrame(moduleId, address, job.id, []);
    if (r.ok) {
        // Only an identification read: that is all EdiabasLib saw it send, which is not the adjustment.
        const frames = r.frame.sequence ?? [r.frame.hex];
        if (frames.every((h) => /^(\S+ \S+ 00|b8 \S+ f1 \S+ 1a)/.test(h))) return { kind: 'sendsNothing' };
        return { kind: 'gate', verdict: mayActuate(job, telegramOfAgreed(r.frame), ledger, { moduleId, mode, motion }) };
    }
    const oracle = await loadJobFramesOracle();
    const sends = oracle?.jobs[`${moduleId}:${job.id}`]?.cases.find((c) => c.args.length === 0)?.sends ?? [];
    if (sends.length === 0) return oracle?.jobs[`${moduleId}:${job.id}`] ? { kind: 'sendsNothing' } : { kind: 'notAgreed', why: r.why };
    const other = sends.find((h) => parseInt(h.split(' ')[0], 16) !== address);
    if (other) {
        const to = parseInt(other.split(' ')[0], 16);
        const index = await loadEcuIndex().catch(() => null);
        const mod = index?.modules.find((m) => m.address === to) ?? null;
        let write: string | null = null;
        if (mod) {
            const table = await loadTelegrams(mod.id);
            const theirs = sends.filter((h) => h.startsWith(`${hex2(to)} `) && h.split(' ')[2] !== '00');
            for (const [id, ts] of Object.entries(table?.jobs ?? {})) {
                if (ts.some((x) => theirs.includes(x.hex.toLowerCase())) && decisionFor(mod.id, { id, class: 'unclassified' }).nature === 'w') write = id;
            }
        }
        return { kind: 'otherModule', address: to, module: mod ? mod.name || mod.name_en : null, write };
    }
    return { kind: 'notAgreed', why: r.why };
}

/**
 * A PROBE plan: what the tab reads from the car, and when, for one investigation.
 *
 * The desk or the assistant writes it into CO-WORK (lib/notebook/rules.ts); the tab runs it
 * (lib/probe/executor.ts). Every step is a READ — there is no step kind that could carry anything
 * else, and each frame still goes through runGate on its way out. What a plan adds over a datalog
 * is that it says WHY: the hypotheses it tests, the observation that would refute each one, and the
 * judgements the tab computes from what it recorded.
 *
 * Driving is never instructed. A step that needs the car moving waits for the car to move; a
 * capture waits for its condition to happen on its own (TUNER's rule: aim and hold, never "now").
 */

/** When a one-shot step may go. `parked` is measured (lib/vehicleState), never assumed. */
export type When = 'parked' | 'moving' | 'any';

export type Op = '<' | '<=' | '>' | '>=' | '==' | '!=';

/**
 * One test on one channel. Channels are named as the datalog names them — `selection:symbol` for
 * an MSS54 live value (`19:v`), `ram:FFD1A2` for a RAM read the plan itself takes.
 */
export interface Clause {
    channel: string;
    op: Op;
    value: number;
}

export type ProbeStep =
    /** Read a module's fault memory with the frames its own SGBD sends (lib/moduleProtocol). */
    | { n: number; do: string; kind: 'faults'; module: string; when: When; times?: number }
    /** Run one catalogue read job of a module, as mayRun allows it. */
    | { n: number; do: string; kind: 'read'; module: string; job: string; when: When; times?: number }
    /** Keep these MSS54 live channels in every sample while the run is on. */
    | { n: number; do: string; kind: 'sample'; channels: string[] }
    /** Read DME RAM (master windows only) every `every` samples, as raw bytes. */
    | { n: number; do: string; kind: 'ram'; address: string; bytes: number; every: 1 | 2 | 4 | 8; label?: string }
    /** Mark the stretch around each moment every clause holds: `preS` before, `postS` after. */
    | { n: number; do: string; kind: 'capture'; condition: Clause[]; preS: number; postS: number; times?: number };

export type StepKind = ProbeStep['kind'];

/** A guess the plan tests, with the observation that would show it wrong. */
export interface Hypothesis {
    id: string;
    text: string;
    refutedBy: string;
}

/**
 * A judgement the tab computes from the samples, so the desk and the voice read the same number.
 *
 * `provenance` is where the threshold came from. A value nobody can trace is `authored` and is said
 * to be — an estimate shown as a specification is the thing this repo will not do.
 */
export interface Judge {
    id: string;
    hypothesis?: string;
    channel: string;
    stat: 'max' | 'min' | 'mean' | 'spread' | 'count';
    where?: Clause[];
    op: Op;
    value: number;
    unit?: string;
    provenance: 'sgbd' | 'inpa' | 'authored' | 'observed';
    note?: string;
}

export const PROBE_LIMITS = {
    steps: 12,
    stepText: 160,
    sampleChannels: 16,
    ramSteps: 4,
    captureSteps: 4,
    clauses: 6,
    hypotheses: 8,
    judges: 12,
    text: 2000,
    /** Seconds either side of a captured moment. */
    window: 120,
} as const;

/**
 * The DME's RAM windows a 0x06 read may touch — master only; slave RAM is not served on this
 * calibration. Ported from TUNER (`src/lib/dme-link/ramMap.ts`), where the region table at master
 * 0x3AD6 is read and the reads are taken on the car while it drives. `hi` is exclusive.
 */
export const DME_RAM_WINDOWS = [
    { segment: 0x01, lo: 0xff8000, hi: 0xff9000 },
    { segment: 0x04, lo: 0xffd000, hi: 0xfff000 },
] as const;

/** The DME truncates a larger read to 128 bytes without saying so (TUNER, `flash_req_parse`). */
export const DME_RAM_MAX_COUNT = 0x80;

const HEX6 = /^[0-9A-F]{6}$/;
const CHANNEL = /^(\d{1,3}:[A-Za-z0-9_]{1,40}|ram:[0-9A-F]{6})$/;
const MODULE = /^[a-z0-9_]{2,32}$/;
const JOB = /^[A-Z0-9_]{2,64}$/;
const ID = /^[A-Za-z0-9_-]{1,32}$/;
const OPS: readonly Op[] = ['<', '<=', '>', '>=', '==', '!='];

const text = (s: unknown, max: number): s is string => typeof s === 'string' && s.trim().length > 0 && s.length <= max;
const num = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const int = (n: unknown, lo: number, hi: number): n is number => Number.isInteger(n) && (n as number) >= lo && (n as number) <= hi;

/** The segment a RAM read goes out on, or null when the address is outside the windows the DME serves. */
export function ramSegment(address: string, bytes: number): number | null {
    if (!HEX6.test(address) || !int(bytes, 1, DME_RAM_MAX_COUNT)) return null;
    const a = parseInt(address, 16);
    const w = DME_RAM_WINDOWS.find((w) => a >= w.lo && a + bytes <= w.hi);
    return w ? w.segment : null;
}

function clausesProblem(c: unknown, where: string): string | null {
    if (!Array.isArray(c) || c.length === 0 || c.length > PROBE_LIMITS.clauses) {
        return `${where} must be 1-${PROBE_LIMITS.clauses} clauses`;
    }
    for (const x of c as Clause[]) {
        if (!x || !CHANNEL.test(x.channel)) return `${where}: a channel is named like 19:v or ram:FFD1A2`;
        if (!OPS.includes(x.op)) return `${where}: op must be one of ${OPS.join(' ')}`;
        if (!num(x.value)) return `${where}: value must be a number`;
    }
    return null;
}

/** What is wrong with a plan's steps, in a sentence the writer can act on — or null. */
export function stepsProblem(steps: unknown): string | null {
    if (!Array.isArray(steps) || steps.length === 0 || steps.length > PROBE_LIMITS.steps) {
        return `steps must be a list of 1-${PROBE_LIMITS.steps}`;
    }
    let ram = 0;
    let capture = 0;
    for (const [i, s] of (steps as ProbeStep[]).entries()) {
        const at = `step ${i + 1}`;
        if (!s || s.n !== i + 1) return 'steps must be numbered 1, 2, 3 … in order';
        if (!text(s.do, PROBE_LIMITS.stepText)) return `${at} must say what it is for (up to ${PROBE_LIMITS.stepText} characters)`;
        const when = (s as { when?: unknown }).when;
        const times = (s as { times?: unknown }).times;
        if (times !== undefined && !int(times, 1, 99)) return `${at}: times must be a count`;
        switch (s.kind) {
            case 'faults':
                if (!MODULE.test(s.module)) return `${at}: module must be a module id, e.g. dsc_e46`;
                if (when !== 'parked' && when !== 'moving' && when !== 'any') return `${at}: when must be parked, moving or any`;
                break;
            case 'read':
                if (!MODULE.test(s.module)) return `${at}: module must be a module id, e.g. dsc_e46`;
                if (!JOB.test(s.job)) return `${at}: job must be the SGBD job name, e.g. STATUS_LWS`;
                if (when !== 'parked' && when !== 'moving' && when !== 'any') return `${at}: when must be parked, moving or any`;
                break;
            case 'sample':
                if (!Array.isArray(s.channels) || s.channels.length === 0 || s.channels.length > PROBE_LIMITS.sampleChannels) {
                    return `${at}: channels must be 1-${PROBE_LIMITS.sampleChannels} live channels`;
                }
                if (!s.channels.every((c) => typeof c === 'string' && /^\d{1,3}:[A-Za-z0-9_]{1,40}$/.test(c))) {
                    return `${at}: a live channel is named selection:symbol, e.g. 19:v`;
                }
                break;
            case 'ram':
                if (++ram > PROBE_LIMITS.ramSteps) return `a plan reads at most ${PROBE_LIMITS.ramSteps} RAM addresses`;
                if (!int(s.bytes, 1, 4)) return `${at}: bytes must be 1-4`;
                if (![1, 2, 4, 8].includes(s.every)) return `${at}: every must be 1, 2, 4 or 8`;
                if (ramSegment(s.address, s.bytes) === null) {
                    return `${at}: ${s.address} is not inside the DME's master RAM windows (FF8000-FF8FFF, FFD000-FFEFFF)`;
                }
                if (s.label !== undefined && !text(s.label, 60)) return `${at}: label must be short`;
                break;
            case 'capture': {
                if (++capture > PROBE_LIMITS.captureSteps) return `a plan has at most ${PROBE_LIMITS.captureSteps} captures`;
                const p = clausesProblem(s.condition, `${at} condition`);
                if (p) return p;
                if (!num(s.preS) || !num(s.postS) || s.preS < 0 || s.postS < 0 || s.preS > PROBE_LIMITS.window || s.postS > PROBE_LIMITS.window) {
                    return `${at}: preS and postS are seconds, 0-${PROBE_LIMITS.window}`;
                }
                break;
            }
            default:
                return `${at}: kind must be faults, read, sample, ram or capture`;
        }
    }
    return null;
}

export function hypothesesProblem(h: unknown): string | null {
    if (h === undefined) return null;
    if (!Array.isArray(h) || h.length > PROBE_LIMITS.hypotheses) return `hypotheses must be a list of up to ${PROBE_LIMITS.hypotheses}`;
    const ids = new Set<string>();
    for (const x of h as Hypothesis[]) {
        if (!x || !ID.test(x.id) || ids.has(x.id)) return 'each hypothesis needs its own short id';
        ids.add(x.id);
        if (!text(x.text, PROBE_LIMITS.text)) return `hypothesis ${x.id} must say what it is`;
        // A hypothesis nothing could show wrong is not one this plan can test.
        if (!text(x.refutedBy, PROBE_LIMITS.text)) return `hypothesis ${x.id} must say what observation would refute it`;
    }
    return null;
}

export function judgesProblem(j: unknown, hypotheses: readonly Hypothesis[] = []): string | null {
    if (j === undefined) return null;
    if (!Array.isArray(j) || j.length > PROBE_LIMITS.judges) return `judge must be a list of up to ${PROBE_LIMITS.judges}`;
    const ids = new Set<string>();
    const hyp = new Set(hypotheses.map((h) => h.id));
    for (const x of j as Judge[]) {
        if (!x || !ID.test(x.id) || ids.has(x.id)) return 'each judgement needs its own short id';
        ids.add(x.id);
        if (!CHANNEL.test(x.channel)) return `judge ${x.id}: channel is named like 19:v or ram:FFD1A2`;
        if (!['max', 'min', 'mean', 'spread', 'count'].includes(x.stat)) return `judge ${x.id}: stat must be max, min, mean, spread or count`;
        if (!OPS.includes(x.op) || !num(x.value)) return `judge ${x.id}: op and value are required`;
        if (!['sgbd', 'inpa', 'authored', 'observed'].includes(x.provenance)) {
            return `judge ${x.id}: provenance must say where the threshold came from (sgbd, inpa, authored, observed)`;
        }
        if (x.hypothesis !== undefined && !hyp.has(x.hypothesis)) return `judge ${x.id}: hypothesis ${x.hypothesis} is not in this plan`;
        if (x.where !== undefined) {
            const p = clausesProblem(x.where, `judge ${x.id} where`);
            if (p) return p;
        }
        if (x.note !== undefined && !text(x.note, PROBE_LIMITS.text)) return `judge ${x.id}: note is too long`;
    }
    return null;
}

/** The modules a plan's one-shot steps address — what a mandate has to cover. */
export function modulesOf(steps: readonly ProbeStep[]): string[] {
    const out = new Set<string>();
    for (const s of steps) if (s.kind === 'faults' || s.kind === 'read') out.add(s.module);
    // Samples, RAM reads and captures are the DME's.
    if (steps.some((s) => s.kind === 'sample' || s.kind === 'ram' || s.kind === 'capture')) out.add('mss54');
    return [...out].sort();
}

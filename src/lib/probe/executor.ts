/**
 * The tab's side of PROBE: runs one plan on one link, by itself, and records everything it sent,
 * everything that came back, and everything it declined to send and why.
 *
 * ## Two lanes on one wire
 *
 * Every cycle reads the DME's live blocks the plan needs — always including block 19, because the
 * car's speed is what every other decision here rests on — and the plan's RAM reads that are due.
 * Then, at most ONE one-shot step (a module's fault memory, a catalogue read) goes out, if its
 * `when` matches the car as just measured and the gate lets it. One per cycle keeps the sample
 * cadence a property of the wire rather than of the plan.
 *
 * ## What it never does
 *
 *   - Send a frame without asking runGate (`mayRun` for catalogue reads, `mayRunProtocolRead` for
 *     the frames it builds). The gate is read each time, so a kill list that lands mid-run applies
 *     to the next frame.
 *   - Retry a refusal. A NEGATIVE_RESPONSE is the module saying no; the step is marked `rejected`
 *     and the answer recorded verbatim (tsunagi-m-link §19). Transport failures are the link's to
 *     retry, and it already did — here a step gets one more cycle, then it is `failed`.
 *   - Assume the car is still. A step that may go only parked goes only on the speed read in the
 *     same cycle, and waits otherwise. Nothing here tells anyone to drive.
 */

import { Ds2Address, buildDs2Frame, buildReadMemoryPayload, isDs2Error, toHex, type Ds2Link } from '@tsunagi/ds2-core';
import {
    MSS54_ADAPTATION_BLOCKS,
    adaptationBlockMinLength,
    blockBySelection,
    channelId,
    decodeAdaptationBlock,
    decodeLiveBlock,
    liveBlockRequest,
    planBlockReads,
    type ChannelId,
    type LiveValueBlock,
} from '@tsunagi/ds2-mss54';
import type { CatalogJob } from '../ecuCatalog';
import type { Ledger } from '../ledger';
import type { ModuleProtocol } from '../moduleProtocol';
import { isReadOnlyControl, mayRun, mayRunProtocolRead, telegramBytes, type RunBlockKey } from '../runGate';
import { answerFrame, decodeRead, foldResults, type ReadValue, type SgbdResultsTable } from '../sgbd/results';
import { runSgbdJob } from '../sgbd/vm';
import type { Telegram } from '../telegrams';
import { motionOf, vehicleStateFrom, type Motion } from '../vehicleState';
import { holds, judge, type JudgeResult, type ProbeSample } from './criteria';
import { moduleChannel, ramSegment, type Judge, type ProbeStep } from './plan';

const SPEED_CHANNELS: ChannelId[] = ['19:v' as ChannelId, '19:v_asc' as ChannelId];
/** Live-lane transport failures in a row that end the run: the cable or the DME has gone. */
const LINK_LOST_AFTER = 3;
/** Cycles a one-shot step may fail on transport before it is given up as `failed`. */
const ONE_SHOT_ATTEMPTS = 2;

/**
 * Another frame of this tab held the link's gate (a heartbeat, a read on the screen). The line said
 * nothing, so it is not a failure of the line: the frame goes on a later cycle.
 */
const gateHeld = (e: unknown) => isDs2Error(e) && e.code === 'GATE_HELD';

export interface ProbeModule {
    protocol: ModuleProtocol;
    /** A catalogue job of this module and its best telegram; null when the job is not in the catalogue. */
    job(jobId: string): { job: CatalogJob; telegram: Telegram | null } | null;
    /** The module's SGBD code for reading its answers (lib/sgbd/results); null where none ships. */
    results?: SgbdResultsTable | null;
}

export interface ProbePlan {
    id: string;
    v: number;
    steps: readonly ProbeStep[];
    judge?: readonly Judge[];
}

export interface ProbeDeps {
    link: Ds2Link;
    module(moduleId: string): ProbeModule | null;
    /** Read each time: a kill list that arrives mid-run applies to the next frame. */
    ledger(): Ledger;
    now(): number;
    /** Hands the event loop back once per cycle (see useDs2Link's yieldToEventLoop). */
    pause(): Promise<void>;
    stopped(): boolean;
    /** A read that answered on a car measured stationary in the same cycle — for the ledger. */
    onObserved?(o: { id: string; telegram: string; response: string; at: number }): void;
    onSample?(s: ProbeSample): void;
    /** The run as it is being written — its steps and exchanges, for whoever asks how it is going. */
    onStart?(run: ProbeRun): void;
    onExchange?(e: ProbeExchange): void;
    /** A one-shot step settled: what the hub's PROBE line counts. */
    onStep?(n: number, state: StepState): void;
    maxSamples?: number;
    maxSeconds?: number;
}

export type ExchangeOutcome = 'ok' | 'refused' | 'rejected' | 'failed';

export interface ProbeExchange {
    /** Seconds since the run began. */
    t: number;
    step: number;
    module: string;
    /** The job, `FS_LESEN`, `LIVE_19` or `RAM_FFD1A2`. */
    what: string;
    request: string | null;
    response: string | null;
    outcome: ExchangeOutcome;
    /** The gate's key, the ECU's status, or the transport's message. */
    reason?: string;
    motion: Motion;
    /** The answer as the module's own SGBD job reads it, where its code ships (lib/sgbd/results). */
    values?: ReadValue[];
}

export type StepState = 'pending' | 'done' | 'refused' | 'rejected' | 'failed';

export interface ProbeRun {
    planId: string;
    planV: number;
    startedAt: number;
    endedAt: number;
    end: 'done' | 'stopped' | 'link-lost' | 'limit';
    samples: ProbeSample[];
    exchanges: ProbeExchange[];
    captures: Array<{ step: number; at: number; from: number; to: number }>;
    steps: Array<{
        n: number;
        state: StepState;
        sent: number;
        reason?: string;
        /**
         * A pending step that is due but held: why it has not gone yet (`parked only` — the car was
         * measured moving, or its motion could not be measured). Cleared when it goes.
         */
        waiting?: string;
    }>;
    judges: JudgeResult[];
    /**
     * The learned values an `adapt` step read: the MSS54's keyed `adapt:<selection>:<symbol>`, null
     * where the block answered too short to hold the field; SMG II's keyed `adapt:smg2.<argument>:<RESULT>`
     * (0 clutch, 1 gearbox, 2 gearbox data). Empty when the plan has no such step; absent on runs kept
     * before the step existed.
     */
    adaptations?: Record<string, number | null>;
}

const isLive = (c: string) => /^\d{1,3}:/.test(c);

/** Why a due step has not gone: the car as measured this cycle. */
const heldFor = (motion: Motion) => (motion === 'moving' ? 'parked only: the car was measured moving' : 'parked only: the car could not be measured stationary');

/** A module's read job sampled every cycle (`module:JOB:RESULT` channels), grouped per job. */
interface ModuleLane {
    module: string;
    job: string;
    /** The results asked for; `*` is every number the job reports. */
    results: Set<string>;
    /** No longer read this run, and why (a refusal, a rejection, repeated transport failures). */
    dropped?: string;
    failures: number;
    answered: boolean;
}

function moduleLanes(steps: readonly ProbeStep[], judges: readonly Judge[]): ModuleLane[] {
    const lanes = new Map<string, ModuleLane>();
    const add = (c: string) => {
        const m = moduleChannel(c);
        if (!m) return;
        const key = `${m.module}:${m.job}`;
        const lane = lanes.get(key) ?? { module: m.module, job: m.job, results: new Set<string>(), failures: 0, answered: false };
        lane.results.add(m.result);
        lanes.set(key, lane);
    };
    for (const s of steps) {
        if (s.kind === 'sample') s.channels.forEach(add);
        if (s.kind === 'capture') s.condition.forEach((c) => add(c.channel));
    }
    for (const j of judges) {
        add(j.channel);
        j.where?.forEach((c) => add(c.channel));
    }
    return [...lanes.values()];
}

const hexOf = (b: ArrayLike<number>) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join(' ');
const withChecksum = (b: Uint8Array) => {
    let x = 0;
    for (const v of b) x ^= v;
    return Uint8Array.from([...b, x]);
};
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/**
 * `3:*` asks for the whole of block 3. A block is read whole whichever of its values is named, so
 * one of its own channels stands for it.
 */
function expandWhole(c: string): string | null {
    const m = /^(\d{1,3}):\*$/.exec(c);
    if (!m) return c;
    const first = blockBySelection(Number(m[1]))?.fields[0];
    return first ? channelId(Number(m[1]), first.symbol) : null;
}

/** Every live channel the plan needs, plus the speed. */
function liveChannels(steps: readonly ProbeStep[], judges: readonly Judge[]): ChannelId[] {
    const out = new Set<string>(SPEED_CHANNELS);
    for (const s of steps) {
        if (s.kind === 'sample') s.channels.forEach((c) => {
            const x = expandWhole(c);
            if (x) out.add(x);
        });
        if (s.kind === 'capture') s.condition.forEach((c) => isLive(c.channel) && out.add(c.channel));
    }
    for (const j of judges) {
        if (isLive(j.channel)) out.add(j.channel);
        j.where?.forEach((c) => isLive(c.channel) && out.add(c.channel));
    }
    return [...out] as ChannelId[];
}

/** Big-endian unsigned, which is how the DME lays out its words. A reading, not a decode. */
function beUint(bytes: Uint8Array): number {
    let v = 0;
    for (const b of bytes) v = v * 256 + b;
    return v;
}

const isOneShot = (s: ProbeStep): s is Extract<ProbeStep, { kind: 'faults' | 'read' | 'adapt' }> =>
    s.kind === 'faults' || s.kind === 'read' || s.kind === 'adapt';

function oneShotDue(s: ProbeStep, motion: Motion): boolean {
    if (!isOneShot(s)) return false;
    return s.when === 'any' || s.when === motion;
}

export async function runProbe(plan: ProbePlan, deps: ProbeDeps): Promise<ProbeRun> {
    const startedAt = deps.now();
    const secs = () => (deps.now() - startedAt) / 1000;
    const judges = plan.judge ?? [];
    const run: ProbeRun = {
        planId: plan.id,
        planV: plan.v,
        startedAt,
        endedAt: startedAt,
        end: 'done',
        samples: [],
        exchanges: [],
        captures: [],
        steps: plan.steps.map((s) => ({ n: s.n, state: isOneShot(s) ? 'pending' : 'done', sent: 0 })),
        judges: [],
        adaptations: {},
    };
    const stepOf = (n: number) => run.steps[n - 1];
    const failures = new Map<number, number>();
    const record = (e: Omit<ProbeExchange, 't'>) => {
        const x = { ...e, t: secs() };
        run.exchanges.push(x);
        deps.onExchange?.(x);
    };

    const { blocks: allBlocks } = planBlockReads(liveChannels(plan.steps, judges));
    let blocks: LiveValueBlock[] = allBlocks;
    const ramSteps = plan.steps.filter((s): s is Extract<ProbeStep, { kind: 'ram' }> => s.kind === 'ram');
    const hasLiveSteps = plan.steps.some((s) => s.kind === 'sample' || s.kind === 'ram' || s.kind === 'capture');
    const lanes = moduleLanes(plan.steps, judges);
    deps.onStart?.(run);
    const dme = deps.link.to(Ds2Address.DME);
    let lost = 0;
    let cycle = 0;
    const lastCapture = new Map<number, number>();

    for (;;) {
        if (deps.stopped()) {
            run.end = 'stopped';
            break;
        }
        if ((deps.maxSamples && run.samples.length >= deps.maxSamples) || (deps.maxSeconds && secs() >= deps.maxSeconds)) {
            run.end = 'limit';
            break;
        }

        // ---- the live lane: DME blocks, then RAM reads that are due ---------------------------
        const values: Record<string, number | null> = {};
        let laneFailed = false;
        let held = false;
        for (const block of [...blocks]) {
            const id = `mss54:LIVE_${block.selection}`;
            const gate = mayRunProtocolRead(id, 'dme-measured', deps.ledger(), 'unknown');
            if (!gate.allowed) {
                blocks = blocks.filter((b) => b !== block);
                record({ step: 0, module: 'mss54', what: `LIVE_${block.selection}`, request: null, response: null, outcome: 'refused', reason: gate.reason, motion: 'unknown' });
                continue;
            }
            const req = liveBlockRequest(block.selection);
            try {
                const frame = await dme.exchangeWithRetry(req.control, req.payload, { attempts: 2 });
                deps.link.assertPositive(frame, `Live block ${block.selection}`);
                for (const v of decodeLiveBlock(block, frame)) values[channelId(block.selection, v.symbol)] = v.value;
            } catch (e) {
                if (gateHeld(e)) {
                    held = true;
                    break;
                }
                if (isDs2Error(e) && (e.code === 'NEGATIVE_RESPONSE' || e.code === 'PAYLOAD_TOO_SHORT')) {
                    // The DME said no, or answered short: a fact about this block, not the line.
                    blocks = blocks.filter((b) => b !== block);
                    record({ step: 0, module: 'mss54', what: `LIVE_${block.selection}`, request: toHex(buildDs2Frame(Ds2Address.DME, req.control, req.payload)), response: null, outcome: 'rejected', reason: e.message, motion: 'unknown' });
                } else {
                    // A transport failure: what the line said is kept, so a run that ends link-lost
                    // can be read for why (timeout, framing, a closed port).
                    record({ step: 0, module: 'mss54', what: `LIVE_${block.selection}`, request: toHex(buildDs2Frame(Ds2Address.DME, req.control, req.payload)), response: null, outcome: 'failed', reason: e instanceof Error ? e.message : String(e), motion: 'unknown' });
                    laneFailed = true;
                    break;
                }
            }
        }
        for (const s of laneFailed || held ? [] : ramSteps) {
            if (cycle % s.every !== 0) continue;
            const id = `mss54:RAM_${s.address}`;
            const segment = ramSegment(s.address, s.bytes);
            const gate = mayRunProtocolRead(id, 'dme-measured', deps.ledger(), 'unknown');
            if (segment === null || !gate.allowed) {
                if (stepOf(s.n).state !== 'refused') {
                    stepOf(s.n).state = 'refused';
                    stepOf(s.n).reason = segment === null ? 'outside the RAM windows' : (gate as { reason: string }).reason;
                    record({ step: s.n, module: 'mss54', what: `RAM_${s.address}`, request: null, response: null, outcome: 'refused', reason: stepOf(s.n).reason, motion: 'unknown' });
                }
                continue;
            }
            try {
                const frame = await dme.exchangeWithRetry(0x06, buildReadMemoryPayload(segment, parseInt(s.address, 16), s.bytes), { attempts: 2 });
                deps.link.assertPositive(frame, `RAM ${s.address}`);
                values[`ram:${s.address}`] = frame.payload.length >= s.bytes ? beUint(frame.payload.slice(0, s.bytes)) : null;
            } catch (e) {
                if (gateHeld(e)) {
                    held = true;
                    break;
                }
                if (isDs2Error(e) && e.code === 'NEGATIVE_RESPONSE') {
                    stepOf(s.n).state = 'rejected';
                    stepOf(s.n).reason = e.message;
                    record({ step: s.n, module: 'mss54', what: `RAM_${s.address}`, request: null, response: null, outcome: 'rejected', reason: e.message, motion: 'unknown' });
                } else {
                    record({ step: s.n, module: 'mss54', what: `RAM_${s.address}`, request: null, response: null, outcome: 'failed', reason: e instanceof Error ? e.message : String(e), motion: 'unknown' });
                    laneFailed = true;
                    break;
                }
            }
        }
        if (held) {
            await deps.pause();
            continue;
        }
        if (laneFailed) {
            if (++lost >= LINK_LOST_AFTER) {
                run.end = 'link-lost';
                break;
            }
            await deps.pause();
            continue;
        }
        lost = 0;

        const now = deps.now();
        const motion = motionOf(vehicleStateFrom(values, now), now);

        // ---- the module lane: other modules' read jobs whose values the plan samples -----------
        let moduleHeld = false;
        for (const lane of lanes) {
            if (lane.dropped) continue;
            const r = await moduleRead(lane, motion, values);
            if (r === 'held') {
                moduleHeld = true;
                break;
            }
        }
        if (moduleHeld) {
            await deps.pause();
            continue;
        }

        const t = secs();
        if (hasLiveSteps) {
            const sample = { t, values };
            run.samples.push(sample);
            deps.onSample?.(sample);
            for (const s of plan.steps) {
                if (s.kind !== 'capture') continue;
                const count = run.captures.filter((c) => c.step === s.n).length;
                const after = lastCapture.get(s.n);
                if (count >= (s.times ?? 99) || (after !== undefined && t <= after)) continue;
                if (holds(s.condition, values)) {
                    const c = { step: s.n, at: t, from: Math.max(0, t - s.preS), to: t + s.postS };
                    run.captures.push(c);
                    lastCapture.set(s.n, c.to);
                }
            }
        }

        // ---- the one-shot lane: at most one step, if its `when` is now -------------------------
        // At most one step goes. A step held for a stationary car says why on itself and lets the
        // next due step have the cycle: a parked-only read no longer stands in front of a fault read
        // that may go while moving.
        for (const s of plan.steps) {
            const st = stepOf(s.n);
            if (st.state !== 'pending' || !oneShotDue(s, motion)) continue;
            const exchanges = run.exchanges.length;
            const sent = st.sent;
            if (s.kind === 'adapt') await (s.module === 'smg2' ? smgAdaptShot(s, motion) : adaptShot(s, motion));
            else if (s.kind === 'faults' || s.kind === 'read') await oneShot(s, motion);
            const held = st.state === 'pending' && st.sent === sent && run.exchanges.length === exchanges && st.waiting !== undefined;
            if (!held) break;
        }

        if (!hasLiveSteps && run.steps.every((s) => s.state !== 'pending')) {
            run.end = 'done';
            break;
        }
        cycle++;
        await deps.pause();
    }

    run.endedAt = deps.now();
    run.judges = judges.map((j) => judge(j, run.samples));
    return run;

    /**
     * The MSS54's learned values, every block the table can read, as the ADAPTATION tab reads them.
     * Each block asks the gate on its own; a block the DME refuses is recorded and the rest still
     * go, because four of five learned blocks beat none.
     */
    async function adaptShot(s: Extract<ProbeStep, { kind: 'adapt' }>, motion: Motion) {
        const st = stepOf(s.n);
        const settle = (state: StepState, reason?: string) => {
            st.state = state;
            if (reason) st.reason = reason;
            deps.onStep?.(s.n, state);
        };
        const gates = MSS54_ADAPTATION_BLOCKS.map((b) => ({ block: b, gate: mayRunProtocolRead(`mss54:ADAPT_${b.selection}`, 'module', deps.ledger(), motion) }));
        const blocked = gates.find((g) => !g.gate.allowed);
        if (blocked && !blocked.gate.allowed) {
            // A moving car is not a refusal: the step waits for the car to stop.
            if (blocked.gate.reason === 'run_block_moving') {
                st.waiting = heldFor(motion);
                return;
            }
            settle('refused', blocked.gate.reason);
            record({ step: s.n, module: 'mss54', what: `ADAPT_${blocked.block.selection}`, request: null, response: null, outcome: 'refused', reason: blocked.gate.reason, motion });
            return;
        }
        if (gates.some((g) => g.gate.allowed && g.gate.requires === 'parked') && motion !== 'parked') {
            st.waiting = heldFor(motion);
            return;
        }
        delete st.waiting;

        for (const { block } of gates) {
            const req = liveBlockRequest(block.selection);
            const what = `ADAPT_${block.selection}`;
            const hex = toHex(buildDs2Frame(Ds2Address.DME, req.control, req.payload));
            try {
                const frame = await dme.exchangeWithRetry(req.control, req.payload, { attempts: 2 });
                deps.link.assertPositive(frame, `Adaptation block ${block.selection}`);
                const response = toHex(frame.payload);
                record({ step: s.n, module: 'mss54', what, request: hex, response, outcome: 'ok', motion });
                if (frame.payload.length < adaptationBlockMinLength(block)) {
                    record({ step: s.n, module: 'mss54', what, request: hex, response, outcome: 'rejected', reason: `answered ${frame.payload.length} bytes, needs ${adaptationBlockMinLength(block)}`, motion });
                }
                for (const v of decodeAdaptationBlock(block, frame.payload)) run.adaptations![`adapt:${block.selection}:${v.symbol}`] = v.value;
                if (motion === 'parked') deps.onObserved?.({ id: `mss54:${what}`, telegram: hex, response, at: deps.now() });
            } catch (e) {
                if (gateHeld(e)) return;
                const message = e instanceof Error ? e.message : String(e);
                const refused = isDs2Error(e) && e.code === 'NEGATIVE_RESPONSE';
                record({ step: s.n, module: 'mss54', what, request: hex, response: null, outcome: refused ? 'rejected' : 'failed', reason: message, motion });
                if (!refused) {
                    const n = (failures.get(s.n) ?? 0) + 1;
                    failures.set(s.n, n);
                    if (n >= ONE_SHOT_ATTEMPTS) settle('failed', message);
                    return;
                }
            }
        }
        st.sent++;
        if (st.sent >= (s.times ?? 1)) settle('done');
    }

    /**
     * One module read job for the sample: its gate, its frame, its answer read by the job's own SGBD
     * code into the channels the plan named. 'held' when another frame of this tab holds the link.
     */
    async function moduleRead(lane: ModuleLane, motion: Motion, values: Record<string, number | null>): Promise<'ok' | 'held' | 'skipped'> {
        const channels = [...lane.results].filter((r) => r !== '*').map((r) => `${lane.module}:${lane.job}:${r}`);
        for (const c of channels) values[c] = null;
        const what = lane.job;
        const drop = (outcome: ExchangeOutcome, reason: string, request: string | null = null) => {
            lane.dropped = reason;
            record({ step: 0, module: lane.module, what, request, response: null, outcome, reason, motion });
            return 'skipped' as const;
        };
        const mod = deps.module(lane.module);
        if (!mod) return drop('refused', 'unknown module');
        const hit = mod.job(lane.job);
        if (!hit) return drop('refused', 'not in the catalogue');
        if (!mod.results?.jobs[lane.job]) return drop('refused', 'no SGBD code ships to read this answer (tools/gen_sgbd_results.py)');
        const verdict = mayRun(hit.job, hit.telegram, deps.ledger(), { moduleId: lane.module, motion });
        // Moving, or not measured parked: this sample goes without it; it is read when it may be.
        if (!verdict.allowed) return verdict.reason === 'run_block_moving' ? 'skipped' : drop('refused', verdict.reason);
        if (verdict.requires === 'parked' && motion !== 'parked') return 'skipped';
        const bytes = telegramBytes(verdict.telegram.hex);
        if (!bytes || bytes[0] !== mod.protocol.address) return drop('refused', 'run_block_noTelegram');
        const hex = verdict.telegram.hex;
        try {
            const frame = await deps.link.to(mod.protocol.address).exchangeWithRetry(bytes[2], bytes.slice(3, bytes.length - 1), { attempts: 2 });
            deps.link.assertPositive(frame, `${lane.module} ${what}`);
            lane.failures = 0;
            const decoded = decodeRead(mod.results, what, hex, answerFrame(frame.address, frame.controlOrStatus, frame.payload));
            for (const v of decoded?.values ?? []) {
                if (typeof v.value !== 'number') continue;
                const c = `${lane.module}:${lane.job}:${v.name}`;
                if (lane.results.has('*') || lane.results.has(v.name)) values[c] = v.value;
            }
            // The first answer of the run is kept whole, as evidence of what this read looks like.
            if (!lane.answered) {
                lane.answered = true;
                record({ step: 0, module: lane.module, what, request: hex, response: toHex(frame.payload), outcome: 'ok', motion, ...(decoded ? { values: decoded.values } : {}) });
                if (decoded?.stopped) record({ step: 0, module: lane.module, what, request: hex, response: toHex(frame.payload), outcome: 'rejected', reason: `read stopped: ${decoded.stopped.reason}`, motion });
            }
            if (motion === 'parked') deps.onObserved?.({ id: `${lane.module}:${what}`, telegram: hex, response: toHex(frame.payload), at: deps.now() });
            return 'ok';
        } catch (e) {
            if (gateHeld(e)) return 'held';
            const message = e instanceof Error ? e.message : String(e);
            if (isDs2Error(e) && e.code === 'NEGATIVE_RESPONSE') return drop('rejected', message, hex);
            record({ step: 0, module: lane.module, what, request: hex, response: null, outcome: 'failed', reason: message, motion });
            if (++lane.failures >= LINK_LOST_AFTER) lane.dropped = message;
            return 'skipped';
        }
    }

    /**
     * SMG II's learned values: ADAPTIONSWERTE_LESEN with argument 0 (clutch), 1 (gearbox) and 2
     * (gearbox data). The frame for each argument is built by the job's own code (a dry run of
     * lib/sgbd/vm), must carry a control byte that reads on SMG II, and goes through the gate like
     * the MSS54's blocks. A refusal of one argument is recorded and the others still go.
     */
    async function smgAdaptShot(s: Extract<ProbeStep, { kind: 'adapt' }>, motion: Motion) {
        const st = stepOf(s.n);
        const settle = (state: StepState, reason?: string) => {
            st.state = state;
            if (reason) st.reason = reason;
            deps.onStep?.(s.n, state);
        };
        const job = 'ADAPTIONSWERTE_LESEN';
        const mod = deps.module('smg2');
        const code = mod?.results?.jobs[job];
        if (!mod || !code || !mod.results) {
            settle('refused', 'no SGBD code ships for SMG II learned values');
            record({ step: s.n, module: 'smg2', what: job, request: null, response: null, outcome: 'refused', reason: st.reason, motion });
            return;
        }
        const results = mod.results;
        const gates = ['0', '1', '2'].map((arg) => ({ arg, gate: mayRunProtocolRead(`smg2:${job}:${arg}`, 'module', deps.ledger(), motion) }));
        const blocked = gates.find((g) => !g.gate.allowed);
        if (blocked && !blocked.gate.allowed) {
            if (blocked.gate.reason === 'run_block_moving') {
                st.waiting = heldFor(motion);
                return;
            }
            settle('refused', blocked.gate.reason);
            record({ step: s.n, module: 'smg2', what: `${job}(${blocked.arg})`, request: null, response: null, outcome: 'refused', reason: blocked.gate.reason, motion });
            return;
        }
        if (gates.some((g) => g.gate.allowed && g.gate.requires === 'parked') && motion !== 'parked') {
            st.waiting = heldFor(motion);
            return;
        }
        delete st.waiting;
        const to = deps.link.to(mod.protocol.address);
        for (const { arg } of gates) {
            const what = `${job}(${arg})`;
            const dry = runSgbdJob({ code: fromB64(code.code), base: code.base }, { args: [arg], tables: results.tables });
            const req = dry.request;
            if (!req || req.length < 3 || req[0] !== mod.protocol.address || !isReadOnlyControl(req[2], 'smg2')) {
                record({ step: s.n, module: 'smg2', what, request: req ? hexOf(req) : null, response: null, outcome: 'refused', reason: req ? 'the job builds a frame that is not a read on SMG II' : `the job built no frame (${dry.stopped?.reason ?? 'no send'})`, motion });
                continue;
            }
            const sent = withChecksum(req);
            const hex = hexOf(sent);
            try {
                const frame = await to.exchangeWithRetry(req[2], req.slice(3), { attempts: 2 });
                deps.link.assertPositive(frame, `SMG II ${what}`);
                const response = toHex(frame.payload);
                const run2 = runSgbdJob({ code: fromB64(code.code), base: code.base }, { args: [arg], tables: results.tables, sent, answer: answerFrame(frame.address, frame.controlOrStatus, frame.payload) });
                const folded = foldResults(run2.results);
                record({ step: s.n, module: 'smg2', what, request: hex, response, outcome: 'ok', motion, values: folded.values });
                if (run2.stopped) record({ step: s.n, module: 'smg2', what, request: hex, response, outcome: 'rejected', reason: `read stopped: ${run2.stopped.reason}`, motion });
                for (const v of folded.values) if (typeof v.value === 'number') run.adaptations![`adapt:smg2.${arg}:${v.name}`] = v.value;
                if (motion === 'parked') deps.onObserved?.({ id: `smg2:${what}`, telegram: hex, response, at: deps.now() });
            } catch (e) {
                if (gateHeld(e)) return;
                const message = e instanceof Error ? e.message : String(e);
                const refused = isDs2Error(e) && e.code === 'NEGATIVE_RESPONSE';
                record({ step: s.n, module: 'smg2', what, request: hex, response: null, outcome: refused ? 'rejected' : 'failed', reason: message, motion });
                if (!refused) {
                    const n = (failures.get(s.n) ?? 0) + 1;
                    failures.set(s.n, n);
                    if (n >= ONE_SHOT_ATTEMPTS) settle('failed', message);
                    return;
                }
            }
        }
        st.sent++;
        if (st.sent >= (s.times ?? 1)) settle('done');
    }

    async function oneShot(s: Extract<ProbeStep, { kind: 'faults' | 'read' }>, motion: Motion) {
        const st = stepOf(s.n);
        const mod = deps.module(s.module);
        const settle = (state: StepState, reason?: string) => {
            st.state = state;
            if (reason) st.reason = reason;
            deps.onStep?.(s.n, state);
        };
        // A KWP-on-DS2 module (DSC MK60) is read on its own screen and in the scan; PROBE's frames are DS2's.
        if (mod?.protocol.kwp) {
            settle('refused', 'KWP2000-shaped frames: read on the module screen or in the scan, not in PROBE yet');
            record({ step: s.n, module: s.module, what: s.kind === 'read' ? s.job : 'FS_LESEN', request: null, response: null, outcome: 'refused', reason: st.reason, motion });
            return;
        }
        if (!mod) {
            settle('refused', 'unknown module');
            record({ step: s.n, module: s.module, what: s.kind === 'read' ? s.job : 'FS_LESEN', request: null, response: null, outcome: 'refused', reason: 'unknown module', motion });
            return;
        }

        // What would go out, and whether the gate lets it.
        let frames: Array<{ hex: string; control: number; payload: Uint8Array }>;
        let what: string;
        let requires: 'parked' | 'none';
        if (s.kind === 'faults') {
            what = 'FS_LESEN';
            if (mod.protocol.faults.length === 0) {
                settle('refused', 'no fault-read frame in its SGBD');
                record({ step: s.n, module: s.module, what, request: null, response: null, outcome: 'refused', reason: st.reason, motion });
                return;
            }
            const gate = mayRunProtocolRead(`${s.module}:FS_LESEN`, 'fault-read', deps.ledger(), motion);
            if (!gate.allowed) return refuse(gate.reason);
            frames = mod.protocol.faults;
            requires = gate.requires;
        } else {
            what = s.job;
            const hit = mod.job(s.job);
            if (!hit) {
                settle('refused', 'not in the catalogue');
                record({ step: s.n, module: s.module, what, request: null, response: null, outcome: 'refused', reason: st.reason, motion });
                return;
            }
            const verdict = mayRun(hit.job, hit.telegram, deps.ledger(), { moduleId: s.module, motion });
            if (!verdict.allowed) return refuse(verdict.reason);
            const bytes = telegramBytes(verdict.telegram.hex);
            if (!bytes || bytes[0] !== mod.protocol.address) return refuse('run_block_noTelegram');
            frames = [{ hex: verdict.telegram.hex, control: bytes[2], payload: bytes.slice(3, bytes.length - 1) }];
            requires = verdict.requires;
        }
        // The car as measured this cycle. Not parked: the step waits, and says so on the step (the
        // run's overview shows it); no exchange is recorded, because nothing was sent — it goes when
        // the car stops.
        if (requires === 'parked' && motion !== 'parked') {
            st.waiting = heldFor(motion);
            return;
        }
        delete st.waiting;

        const to = deps.link.to(mod.protocol.address);
        for (const f of frames) {
            try {
                const frame = await to.exchangeWithRetry(f.control, f.payload);
                deps.link.assertPositive(frame, `${s.module} ${what}`);
                const response = toHex(frame.payload);
                let decoded: ReturnType<typeof decodeRead> = null;
                if (s.kind === 'read') {
                    try {
                        decoded = decodeRead(mod.results ?? null, what, f.hex, answerFrame(frame.address, frame.controlOrStatus, frame.payload));
                    } catch {
                        decoded = null;
                    }
                }
                record({ step: s.n, module: s.module, what, request: f.hex, response, outcome: 'ok', motion, ...(decoded ? { values: decoded.values } : {}) });
                if (motion === 'parked') deps.onObserved?.({ id: `${s.module}:${what}`, telegram: f.hex, response, at: deps.now() });
            } catch (e) {
                if (gateHeld(e)) return;
                if (isDs2Error(e) && e.code === 'NEGATIVE_RESPONSE') {
                    settle('rejected', e.message);
                    record({ step: s.n, module: s.module, what, request: f.hex, response: null, outcome: 'rejected', reason: e.message, motion });
                    return;
                }
                const n = (failures.get(s.n) ?? 0) + 1;
                failures.set(s.n, n);
                const message = e instanceof Error ? e.message : String(e);
                record({ step: s.n, module: s.module, what, request: f.hex, response: null, outcome: 'failed', reason: message, motion });
                if (n >= ONE_SHOT_ATTEMPTS) settle('failed', message);
                return;
            }
        }
        st.sent++;
        if (st.sent >= (s.times ?? 1)) settle('done');

        function refuse(reason: RunBlockKey) {
            // A moving car is not a refusal of the step — it waits for the car to stop.
            if (reason === 'run_block_moving') {
                st.waiting = heldFor(motion);
                return;
            }
            settle('refused', reason);
            record({ step: s.n, module: s.module, what, request: null, response: null, outcome: 'refused', reason, motion });
        }
    }
}

/** The blocks a plan reads, for a cost line like the datalog's. */
export function probeBlocks(plan: Pick<ProbePlan, 'steps' | 'judge'>): number[] {
    return planBlockReads(liveChannels(plan.steps, plan.judge ?? [])).blocks.map((b) => b.selection);
}


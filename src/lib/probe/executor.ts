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
import { channelId, decodeLiveBlock, liveBlockRequest, planBlockReads, type ChannelId, type LiveValueBlock } from '@tsunagi/ds2-mss54';
import type { CatalogJob } from '../ecuCatalog';
import type { Ledger } from '../ledger';
import type { ModuleProtocol } from '../moduleProtocol';
import { mayRun, mayRunProtocolRead, telegramBytes, type RunBlockKey } from '../runGate';
import type { Telegram } from '../telegrams';
import { motionOf, vehicleStateFrom, type Motion } from '../vehicleState';
import { holds, judge, type JudgeResult, type ProbeSample } from './criteria';
import { ramSegment, type Judge, type ProbeStep } from './plan';

const SPEED_CHANNELS: ChannelId[] = ['19:v' as ChannelId, '19:v_asc' as ChannelId];
/** Live-lane transport failures in a row that end the run: the cable or the DME has gone. */
const LINK_LOST_AFTER = 3;
/** Cycles a one-shot step may fail on transport before it is given up as `failed`. */
const ONE_SHOT_ATTEMPTS = 2;

export interface ProbeModule {
    protocol: ModuleProtocol;
    /** A catalogue job of this module and its best telegram; null when the job is not in the catalogue. */
    job(jobId: string): { job: CatalogJob; telegram: Telegram | null } | null;
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
    steps: Array<{ n: number; state: StepState; sent: number; reason?: string }>;
    judges: JudgeResult[];
}

const isLive = (c: string) => /^\d{1,3}:/.test(c);

/** Every live channel the plan needs, plus the speed. */
function liveChannels(steps: readonly ProbeStep[], judges: readonly Judge[]): ChannelId[] {
    const out = new Set<string>(SPEED_CHANNELS);
    for (const s of steps) {
        if (s.kind === 'sample') s.channels.forEach((c) => out.add(c));
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

function oneShotDue(s: ProbeStep, motion: Motion): boolean {
    if (s.kind !== 'faults' && s.kind !== 'read') return false;
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
        steps: plan.steps.map((s) => ({ n: s.n, state: s.kind === 'faults' || s.kind === 'read' ? 'pending' : 'done', sent: 0 })),
        judges: [],
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
                if (isDs2Error(e) && (e.code === 'NEGATIVE_RESPONSE' || e.code === 'PAYLOAD_TOO_SHORT')) {
                    // The DME said no, or answered short: a fact about this block, not the line.
                    blocks = blocks.filter((b) => b !== block);
                    record({ step: 0, module: 'mss54', what: `LIVE_${block.selection}`, request: toHex(buildDs2Frame(Ds2Address.DME, req.control, req.payload)), response: null, outcome: 'rejected', reason: e.message, motion: 'unknown' });
                } else {
                    laneFailed = true;
                    break;
                }
            }
        }
        for (const s of laneFailed ? [] : ramSteps) {
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
                if (isDs2Error(e) && e.code === 'NEGATIVE_RESPONSE') {
                    stepOf(s.n).state = 'rejected';
                    stepOf(s.n).reason = e.message;
                    record({ step: s.n, module: 'mss54', what: `RAM_${s.address}`, request: null, response: null, outcome: 'rejected', reason: e.message, motion: 'unknown' });
                } else {
                    laneFailed = true;
                    break;
                }
            }
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
        const next = plan.steps.find((s) => stepOf(s.n).state === 'pending' && oneShotDue(s, motion));
        if (next && (next.kind === 'faults' || next.kind === 'read')) {
            await oneShot(next, motion);
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

    async function oneShot(s: Extract<ProbeStep, { kind: 'faults' | 'read' }>, motion: Motion) {
        const st = stepOf(s.n);
        const mod = deps.module(s.module);
        const settle = (state: StepState, reason?: string) => {
            st.state = state;
            if (reason) st.reason = reason;
            deps.onStep?.(s.n, state);
        };
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
            const gate = mayRunProtocolRead(`${s.module}:FS_LESEN`, 'module', deps.ledger(), motion);
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
        // The car as measured this cycle. Not parked: the step waits; nothing is recorded, because
        // nothing was decided — it goes when the car stops.
        if (requires === 'parked' && motion !== 'parked') return;

        const to = deps.link.to(mod.protocol.address);
        for (const f of frames) {
            try {
                const frame = await to.exchangeWithRetry(f.control, f.payload);
                deps.link.assertPositive(frame, `${s.module} ${what}`);
                const response = toHex(frame.payload);
                record({ step: s.n, module: s.module, what, request: f.hex, response, outcome: 'ok', motion });
                if (motion === 'parked') deps.onObserved?.({ id: `${s.module}:${what}`, telegram: f.hex, response, at: deps.now() });
            } catch (e) {
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
            if (reason === 'run_block_moving') return;
            settle('refused', reason);
            record({ step: s.n, module: s.module, what, request: null, response: null, outcome: 'refused', reason, motion });
        }
    }
}

/** The blocks a plan reads, for a cost line like the datalog's. */
export function probeBlocks(plan: Pick<ProbePlan, 'steps' | 'judge'>): number[] {
    return planBlockReads(liveChannels(plan.steps, plan.judge ?? [])).blocks.map((b) => b.selection);
}


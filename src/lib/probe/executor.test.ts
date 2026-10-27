import { afterEach, describe, expect, it } from 'vitest';
import { Ds2Link, Ds2Status, WebSerialTransport, minPayloadLength, simulatedPort, type SimulatedEcuOptions } from '@tsunagi/ds2-core';
import { blockBySelection } from '@tsunagi/ds2-mss54';
import type { CatalogJob } from '../ecuCatalog';
import { EMPTY_LEDGER, type Ledger } from '../ledger';
import { moduleProtocol } from '../moduleProtocol';
import type { TelegramTable } from '../telegrams';
import { runProbe, type ProbeDeps, type ProbePlan } from './executor';
import type { ProbeStep } from './plan';

/**
 * The executor against a K-line of simulated modules, with the car's speed in the test's hand.
 *
 * The DME answers block 3 and block 19 with the speed set here, and a RAM read; DSC answers its
 * own fault read. What is asserted is what went out on the wire and what was recorded — the
 * executor's promises are about frames, so the frames are the evidence.
 */

const opened: WebSerialTransport[] = [];
afterEach(async () => {
    for (const t of opened) await t.close().catch(() => {});
    opened.length = 0;
});

function block(selection: number, fill: (b: Uint8Array) => void): Uint8Array {
    const def = blockBySelection(selection)!;
    const b = new Uint8Array(Math.max(minPayloadLength(def.fields), def.expectedLength));
    fill(b);
    return b;
}

function car(opts: { speed: () => number; dme?: 'dead'; dscRefuses?: boolean; noSpeed?: boolean }) {
    const dme: SimulatedEcuOptions = {
        address: 0x12,
        script: opts.dme === 'dead' ? Array.from({ length: 50 }, () => ({ kind: 'dead' as const })) : undefined,
        respond: (req) => {
            if (req.controlOrStatus === 0x0b && req.payload[0] === 19) {
                if (opts.noSpeed) return { status: Ds2Status.REJECTED };
                const v = opts.speed();
                return { payload: block(19, (b) => {
                    b[0] = v >> 8; b[1] = v & 0xff;
                    const can = Math.round(v * 16);
                    b[2] = can >> 8; b[3] = can & 0xff;
                }) };
            }
            if (req.controlOrStatus === 0x0b && req.payload[0] === 3) return { payload: block(3, (b) => { b[0] = 0x03; b[1] = 0x70; }) };
            if (req.controlOrStatus === 0x06) return { payload: new Uint8Array([0x12, 0x34]) };
            if (req.controlOrStatus === 0x0b && req.payload[0] === 4) return { payload: new Uint8Array([0xaa, 0xbb]) };
            return { status: Ds2Status.REJECTED };
        },
    };
    const dsc: SimulatedEcuOptions = {
        address: 0x56,
        respond: (req) =>
            req.controlOrStatus === 0x04
                ? opts.dscRefuses
                    ? { status: Ds2Status.REJECTED }
                    : { payload: new Uint8Array([0x01, 0x5d, 0x20]) }
                : { status: Ds2Status.REJECTED },
    };
    return [dme, dsc];
}

const DSC_TABLE: TelegramTable = {
    module: 'dsc_e46',
    sgbd: 'DSC_E46',
    address: 0x56,
    jobs: { IDENT: [{ hex: '56 04 00 52', cmd: 0, cmdName: '', occurrences: 1, confidence: 'shared' }], FS_LESEN: [{ hex: '56 05 04 01 56', cmd: 4, cmdName: '', occurrences: 1, confidence: 'shared' }] },
};
const STATUS_DIGITAL = { id: 'STATUS_DIGITAL', class: 'read', args: [], results: [] } as unknown as CatalogJob;

async function harness(opts: Parameters<typeof car>[0], stopAfterCycles = 6, ledger: Ledger = EMPTY_LEDGER) {
    const { port, requestPort } = simulatedPort(car(opts));
    const transport = new WebSerialTransport({ requestPort });
    opened.push(transport);
    const link = new Ds2Link(transport, { address: 0x12, timings: { responseTimeoutMs: 40, retryDelayMs: 1, resyncSettleMs: 0, breakSettleMs: 1 } });
    await link.connect();
    let cycles = 0;
    const observed: string[] = [];
    let clock = 1_000_000;
    const deps: ProbeDeps = {
        link,
        module: (id) =>
            id === 'dsc_e46'
                ? { protocol: moduleProtocol('dsc_e46', 0x56, DSC_TABLE), job: () => null }
                : id === 'mss54'
                  ? { protocol: moduleProtocol('mss54', 0x12, null), job: (j) => (j === 'STATUS_DIGITAL' ? { job: STATUS_DIGITAL, telegram: { hex: '12 05 0b 04 18', cmd: 0x0b, cmdName: '', occurrences: 1, confidence: 'single' } } : null) }
                  : null,
        ledger: () => ledger,
        now: () => (clock += 200),
        pause: async () => {
            cycles++;
        },
        stopped: () => cycles >= stopAfterCycles,
        onObserved: (o) => observed.push(o.id),
    };
    return { deps, bus: port.bus!, observed, cyclesRun: () => cycles };
}

const plan = (steps: ProbeStep[], judge?: ProbePlan['judge']): ProbePlan => ({ id: 'plan-0001', v: 1, steps, judge });
const FAULTS_PARKED: ProbeStep = { n: 1, do: 'DSC faults, parked', kind: 'faults', module: 'dsc_e46', when: 'parked' };

describe('a parked car', () => {
    it('reads the module’s own fault frame at its own address, records it, and tells the ledger', async () => {
        const h = await harness({ speed: () => 0 });
        const run = await runProbe(plan([FAULTS_PARKED, { n: 2, do: 'Digital status', kind: 'read', module: 'mss54', job: 'STATUS_DIGITAL', when: 'parked' }]), h.deps);
        expect(run.end).toBe('done');
        expect(run.steps.map((s) => s.state)).toEqual(['done', 'done']);
        expect(h.bus.at(0x56)!.trace.map((e) => Array.from(e.bytes))).toEqual([[0x56, 0x05, 0x04, 0x01, 0x56]]);
        expect(run.exchanges.filter((e) => e.outcome === 'ok').map((e) => [e.module, e.what, e.response])).toEqual([
            ['dsc_e46', 'FS_LESEN', '01 5d 20'],
            ['mss54', 'STATUS_DIGITAL', 'aa bb'],
        ]);
        expect(h.observed).toEqual(['dsc_e46:FS_LESEN', 'mss54:STATUS_DIGITAL']);
    });
});

describe('a moving car', () => {
    it('lets a parked-only step wait — no frame, no refusal — and sends it once the car stops', async () => {
        let speed = 30;
        const h = await harness({ speed: () => speed }, 12);
        const steps: ProbeStep[] = [FAULTS_PARKED, { n: 2, do: 'speed', kind: 'sample', channels: ['19:v'] }];
        const p = runProbe(plan(steps), { ...h.deps, pause: async () => { if (h.cyclesRun() === 5) speed = 0; await h.deps.pause(); } });
        const run = await p;
        const dscFrames = h.bus.at(0x56)!.trace;
        expect(dscFrames).toHaveLength(1);
        // Every sample before the stop read 30 km/h; the fault read went after the speed fell to 0.
        const firstFault = run.exchanges.find((e) => e.what === 'FS_LESEN')!;
        expect(firstFault.motion).toBe('parked');
        expect(run.samples.filter((s) => s.values['19:v'] === 30).length).toBeGreaterThan(3);
        expect(run.exchanges.some((e) => e.outcome === 'refused')).toBe(false);
    });

    it('marks the stretch around each moment a capture’s condition holds, and judges the samples', async () => {
        const h = await harness({ speed: () => 25 }, 8);
        const run = await runProbe(
            plan(
                [{ n: 1, do: 'slow corners', kind: 'capture', condition: [{ channel: '19:v', op: '<=', value: 40 }, { channel: '19:v', op: '>', value: 10 }], preS: 1, postS: 1, times: 2 }],
                [{ id: 'j1', channel: '19:v', stat: 'max', op: '<=', value: 50, provenance: 'authored' }],
            ),
            h.deps,
        );
        expect(run.captures.length).toBe(2);
        expect(run.captures[1].at).toBeGreaterThan(run.captures[0].to);
        expect(run.judges).toEqual([expect.objectContaining({ id: 'j1', value: 25, pass: true })]);
    });
});

describe('an unknown speed is not a stopped car', () => {
    it('keeps a parked-only step waiting when the DME will not give the speed', async () => {
        const h = await harness({ speed: () => 0, noSpeed: true }, 8);
        const run = await runProbe(plan([FAULTS_PARKED, { n: 2, do: 'rpm', kind: 'sample', channels: ['3:n'] }]), h.deps);
        // The gate lets an unknown-motion read through on condition that the car is measured
        // stationary; the executor is where that condition is kept. Nothing went to DSC.
        expect(h.bus.at(0x56)!.trace).toHaveLength(0);
        expect(run.steps[0].state).toBe('pending');
        expect(run.exchanges).toEqual([expect.objectContaining({ what: 'LIVE_19', outcome: 'rejected' })]);
        expect(run.samples.length).toBeGreaterThan(0);
    });

    it('keeps even an any-time step waiting, when the read it sends has to go to a stationary car', async () => {
        const h = await harness({ speed: () => 0, noSpeed: true }, 8);
        const run = await runProbe(plan([{ ...FAULTS_PARKED, when: 'any' }]), h.deps);
        expect(h.bus.at(0x56)!.trace).toHaveLength(0);
        expect(run.steps[0].state).toBe('pending');
    });
});

describe('what it refuses, and how it says so', () => {
    it('sends nothing to a module whose read was withdrawn, and records why once', async () => {
        const killed: Ledger = { version: 1, records: { 'dsc_e46:FS_LESEN': { id: 'dsc_e46:FS_LESEN', status: 'revoked', reason: 'bad frame' } } };
        const h = await harness({ speed: () => 0 }, 6, killed);
        const run = await runProbe(plan([FAULTS_PARKED]), h.deps);
        expect(h.bus.at(0x56)!.trace).toHaveLength(0);
        expect(run.exchanges.filter((e) => e.outcome === 'refused')).toEqual([expect.objectContaining({ reason: 'run_block_revoked' })]);
        expect(run.steps[0].state).toBe('refused');
    });

    it('takes a module’s refusal as an answer: recorded verbatim, never asked again', async () => {
        const h = await harness({ speed: () => 0, dscRefuses: true }, 10);
        const run = await runProbe(plan([FAULTS_PARKED]), h.deps);
        expect(h.bus.at(0x56)!.trace).toHaveLength(1);
        expect(run.steps[0].state).toBe('rejected');
        expect(run.exchanges.at(-1)).toMatchObject({ outcome: 'rejected', reason: expect.stringMatching(/0x/) });
    });

    it('ends the run when the DME stops answering, instead of recording silence as data', async () => {
        const h = await harness({ speed: () => 0, dme: 'dead' }, 50);
        const run = await runProbe(plan([{ n: 1, do: 'speed', kind: 'sample', channels: ['19:v'] }]), h.deps);
        expect(run.end).toBe('link-lost');
        expect(run.samples).toHaveLength(0);
    });

    it('reads DME RAM only in the master windows, as raw big-endian bytes', async () => {
        const h = await harness({ speed: () => 0 }, 3);
        const run = await runProbe(plan([{ n: 1, do: 'torque request', kind: 'ram', address: 'FFD1A2', bytes: 2, every: 1 }]), h.deps);
        expect(run.samples[0].values['ram:FFD1A2']).toBe(0x1234);
        const ramReq = h.bus.at(0x12)!.trace.find((e) => e.request.controlOrStatus === 0x06)!;
        expect(Array.from(ramReq.request.payload)).toEqual([0x04, 0xff, 0xd1, 0xa2, 0x02]);
    });
});

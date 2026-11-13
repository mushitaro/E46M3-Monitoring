import { afterEach, describe, expect, it } from 'vitest';
import { Ds2Link, Ds2Status, WebSerialTransport, minPayloadLength, simulatedPort, type SimulatedEcuOptions } from '@tsunagi/ds2-core';
import { blockBySelection } from '@tsunagi/ds2-mss54';
import { jobIndex, type EcuProfile } from '../ecuCatalog.ts';
import { EMPTY_LEDGER, type Ledger } from '../ledger.ts';
import { moduleProtocol } from '../moduleProtocol.ts';
import type { SgbdResultsTable } from '../sgbd/results.ts';
import { bestTelegram, type TelegramTable } from '../telegrams.ts';
import { HAVE_SHIPPED_DATA, readShipped } from '../testing/shipped.ts';
import { runProbe, type ProbeDeps, type ProbeModule, type ProbePlan } from './executor.ts';
import type { ProbeStep } from './plan.ts';

/**
 * PROBE and SMG II, with SMG II's own data as shipped: its telegrams, its catalogue, and the SGBD
 * code that reads its answers (lib/sgbd/results). The simulated SMG II answers every status block
 * and every 0x40 read with 128 bytes whose first two say 3000 — STATUS_IO_LESEN's engine speed, as
 * its own code reads it (`STAT_MOTORDREHZAHL_WERT` = byte 0 << 8 | byte 1, 1/min).
 */

const opened: WebSerialTransport[] = [];
afterEach(async () => {
    for (const t of opened) await t.close().catch(() => {});
    opened.length = 0;
});

function smgAnswer(): Uint8Array {
    const b = new Uint8Array(128);
    b[0] = 0x0b;
    b[1] = 0xb8;
    return b;
}

function bus(speed: () => number) {
    const def = blockBySelection(19)!;
    const dme: SimulatedEcuOptions = {
        address: 0x12,
        respond: (req) => {
            if (req.controlOrStatus === 0x0b && req.payload[0] === 19) {
                const b = new Uint8Array(Math.max(minPayloadLength(def.fields), def.expectedLength));
                const v = speed();
                b[0] = v >> 8;
                b[1] = v & 0xff;
                const can = Math.round(v * 16);
                b[2] = can >> 8;
                b[3] = can & 0xff;
                return { payload: b };
            }
            return { status: Ds2Status.REJECTED };
        },
    };
    const smg: SimulatedEcuOptions = {
        address: 0x32,
        respond: (req) => {
            if (req.controlOrStatus === 0x0b || req.controlOrStatus === 0x40) return { payload: smgAnswer() };
            if (req.controlOrStatus === 0x04) return { payload: new Uint8Array([0x00]) };
            return { status: Ds2Status.REJECTED };
        },
    };
    return [dme, smg];
}

function smg2Module(): ProbeModule {
    const table = readShipped<TelegramTable>('smg2.telegrams.json');
    const jobs = jobIndex(readShipped<EcuProfile>('smg2.jobs.json'));
    return {
        protocol: moduleProtocol('smg2', 0x32, table),
        job: (id) => {
            const job = jobs.get(id);
            return job ? { job, telegram: bestTelegram(table, id) } : null;
        },
        results: readShipped<SgbdResultsTable>('smg2.results.json'),
    };
}

async function harness(speed: () => number, cyclesToRun = 4, ledger: Ledger = EMPTY_LEDGER) {
    const { port, requestPort } = simulatedPort(bus(speed));
    const transport = new WebSerialTransport({ requestPort });
    opened.push(transport);
    const link = new Ds2Link(transport, { address: 0x12, timings: { responseTimeoutMs: 40, retryDelayMs: 1, resyncSettleMs: 0, breakSettleMs: 1 } });
    await link.connect();
    let cycles = 0;
    let clock = 1_000_000;
    const observed: string[] = [];
    const smg = smg2Module();
    const deps: ProbeDeps = {
        link,
        module: (id) => (id === 'smg2' ? smg : id === 'mss54' ? { protocol: moduleProtocol('mss54', 0x12, null), job: () => null } : null),
        ledger: () => ledger,
        now: () => (clock += 200),
        pause: async () => {
            cycles++;
        },
        stopped: () => cycles >= cyclesToRun,
        onObserved: (o) => observed.push(o.id),
    };
    return { deps, bus: port.bus!, observed };
}

const plan = (steps: ProbeStep[]): ProbePlan => ({ id: 'plan-smg2', v: 1, steps });
const sentTo = (h: { bus: { at(a: number): { trace: { bytes: Uint8Array }[] } | undefined } }, a: number) =>
    (h.bus.at(a)?.trace ?? []).map((e) => Array.from(e.bytes, (x) => x.toString(16).padStart(2, '0')).join(' '));

describe.skipIf(!HAVE_SHIPPED_DATA)('PROBE samples SMG II values read by its own SGBD code', () => {
    const RPM = 'smg2:STATUS_IO_LESEN:STAT_MOTORDREHZAHL_WERT';

    it('reads the value into every sample while the car is parked', async () => {
        const h = await harness(() => 0);
        const run = await runProbe(plan([{ n: 1, do: 'SMG II engine speed', kind: 'sample', channels: [RPM] }]), h.deps);
        expect(run.samples.length).toBeGreaterThan(0);
        expect(run.samples.every((s) => s.values[RPM] === 3000)).toBe(true);
        expect(sentTo(h, 0x32).every((f) => f === '32 05 0b 03 3f')).toBe(true);
        // The first answer is kept whole, with what was read from it.
        const first = run.exchanges.find((e) => e.module === 'smg2' && e.outcome === 'ok')!;
        expect(first.request).toBe('32 05 0b 03 3f');
        expect(first.values?.find((v) => v.name === 'STAT_MOTORDREHZAHL_WERT')).toEqual({ name: 'STAT_MOTORDREHZAHL_WERT', value: 3000, unit: '1/min' });
        expect(h.observed).toContain('smg2:STATUS_IO_LESEN');
    });

    it('sends nothing to SMG II while the car moves, and leaves the value empty', async () => {
        const h = await harness(() => 40);
        const run = await runProbe(plan([{ n: 1, do: 'SMG II engine speed', kind: 'sample', channels: [RPM] }]), h.deps);
        expect(run.samples.length).toBeGreaterThan(0);
        expect(run.samples.every((s) => s.values[RPM] === null)).toBe(true);
        expect(sentTo(h, 0x32)).toEqual([]);
    });

    it('reads it while moving once the owner has cleared it for a moving car', async () => {
        const ledger: Ledger = { ...EMPTY_LEDGER, records: { 'smg2:STATUS_IO_LESEN': { id: 'smg2:STATUS_IO_LESEN', status: 'moving-ok', movingOkBy: 'owner', movingOkAt: '2026-11-12T00:00:00Z' } } };
        const h = await harness(() => 40, 4, ledger);
        const run = await runProbe(plan([{ n: 1, do: 'SMG II engine speed', kind: 'sample', channels: [RPM] }]), h.deps);
        expect(run.samples.length).toBeGreaterThan(0);
        expect(run.samples.every((s) => s.values[RPM] === 3000)).toBe(true);
    });
});

describe.skipIf(!HAVE_SHIPPED_DATA)('a read step on SMG II', () => {
    it('keeps the values its SGBD code reads from the answer', async () => {
        const h = await harness(() => 0);
        const run = await runProbe(plan([{ n: 1, do: 'SMG II inputs', kind: 'read', module: 'smg2', job: 'STATUS_IO_LESEN', when: 'parked' }]), h.deps);
        expect(run.steps[0].state).toBe('done');
        const x = run.exchanges.find((e) => e.outcome === 'ok')!;
        expect(x.values?.find((v) => v.name === 'STAT_MOTORDREHZAHL_WERT')?.value).toBe(3000);
    });

    it('says why it waits when the car moves, and lets a fault read behind it go', async () => {
        const h = await harness(() => 40);
        const run = await runProbe(
            plan([
                { n: 1, do: 'SMG II inputs', kind: 'read', module: 'smg2', job: 'STATUS_IO_LESEN', when: 'any' },
                { n: 2, do: 'SMG II faults', kind: 'faults', module: 'smg2', when: 'any' },
            ]),
            h.deps,
        );
        expect(run.steps[0]).toMatchObject({ state: 'pending', sent: 0, waiting: 'parked only: the car was measured moving' });
        expect(run.steps[1].state).toBe('done');
        expect(sentTo(h, 0x32).some((f) => f.startsWith('32 05 0b'))).toBe(false);
    });
});

describe.skipIf(!HAVE_SHIPPED_DATA)('SMG II learned values', () => {
    it('sends the frames the job builds for arguments 0, 1 and 2, parked, and keeps the values', async () => {
        const h = await harness(() => 0);
        const run = await runProbe(plan([{ n: 1, do: 'SMG II learned values', kind: 'adapt', module: 'smg2', when: 'parked' }]), h.deps);
        expect(run.steps[0].state).toBe('done');
        expect(sentTo(h, 0x32)).toEqual(['32 05 40 00 77', '32 05 40 01 76', '32 05 40 02 75']);
        const keys = Object.keys(run.adaptations ?? {});
        expect(keys.some((k) => k.startsWith('adapt:smg2.0:'))).toBe(true);
        expect(keys.some((k) => k.startsWith('adapt:smg2.1:'))).toBe(true);
        expect(keys.some((k) => k.startsWith('adapt:smg2.2:'))).toBe(true);
        expect(h.observed).toEqual(['smg2:ADAPTIONSWERTE_LESEN(0)', 'smg2:ADAPTIONSWERTE_LESEN(1)', 'smg2:ADAPTIONSWERTE_LESEN(2)']);
    });

    it('waits, saying why, while the car moves', async () => {
        const h = await harness(() => 40);
        const run = await runProbe(plan([{ n: 1, do: 'SMG II learned values', kind: 'adapt', module: 'smg2', when: 'any' }]), h.deps);
        expect(run.steps[0]).toMatchObject({ state: 'pending', waiting: 'parked only: the car was measured moving' });
        expect(sentTo(h, 0x32)).toEqual([]);
    });
});

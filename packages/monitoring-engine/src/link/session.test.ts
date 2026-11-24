import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { configureEcuData, fetchEcuDataFromPage, type EcuDataLoader } from '../ecuData.ts';
import type { EcuIndex } from '../ecuCatalog.ts';
import { moduleProtocol } from '../moduleProtocol.ts';
import { practiceCar, resetPracticeCar } from '../practiceCar.ts';
import type { TelegramTable } from '../telegrams.ts';
import { HAVE_SHIPPED_DATA, readShipped } from '../testing/shipped.ts';
import type { EcuProfile } from '../ecuCatalog.ts';
import { mayActuate } from '../actuationGate.ts';
import { loadScanTargets, loadProbeModules } from '../probe/modules.ts';
import { moduleLogReads } from '../sgbd/logChannels.ts';
import { telemetryValues, answerFrame, type SgbdResultsTable } from '../sgbd/results.ts';
import type { ChannelId } from '@tsunagi/ds2-mss54';
import { EMPTY_LEDGER } from '../ledger.ts';
import { decisionFor } from '../policy.ts';
import { permitFor } from '../runGate.ts';
import { bestTelegram } from '../telegrams.ts';
import { LinkSession, type LinkSnapshot } from './session.ts';

/**
 * The link session with no screen: what the app's hook and another app's screens drive. Run here
 * against the practice car (the simulator behind a real Web Serial transport), with the ECU data
 * handed in through `configureEcuData` — the way an app other than MONITORING gives it.
 */

/** The shipped data read from disk, answered as `fetch` would. */
const fromDisk: EcuDataLoader = async (file) => {
    try {
        const body = readShipped<unknown>(file);
        return { ok: true, status: 200, json: async () => body };
    } catch {
        return { ok: false, status: 404, json: async () => null };
    }
};

describe.skipIf(!HAVE_SHIPPED_DATA)('a LinkSession on the practice car', () => {
    let index: EcuIndex;
    const opened: LinkSession[] = [];
    const sessionFor = (id: string) => {
        const entry = index.modules.find((m) => m.id === id)!;
        const s = new LinkSession({ target: moduleProtocol(id, entry.address, readShipped<TelegramTable>(`${id}.telegrams.json`)) });
        opened.push(s);
        return s;
    };

    beforeAll(() => {
        configureEcuData(fromDisk);
        index = readShipped<EcuIndex>('index.json');
        return () => configureEcuData(fetchEcuDataFromPage);
    });
    afterEach(async () => {
        for (const s of opened) {
            await s.disconnect();
            s.dispose();
        }
        opened.length = 0;
        resetPracticeCar();
    });

    it.each(['ms450ds0','me9k_ng4','me9n45','mev9n46','mev9n46l','dde50k47','d50m47a','d50m47b1','d50m57a1','d50m57e1'])(
        'identifies %s on the practice link and samples its own RPM for a PROBE verdict', async id => {
            practiceCar.rpmProgram = id;
            practiceCar.idents = { ...practiceCar.idents, 0x12: { hw: '00', diag: '00' } };
            const s = sessionFor('mss54');
            await s.connect('practice');
            await s.readIdent();
            expect(s.getSnapshot().fitment.get(0x12)?.moduleId, JSON.stringify(s.getSnapshot().log.slice(-8))).toBe(id);
            const channel = id + ':STATUS_MOTORDREHZAHL:STAT_MOTORDREHZAHL_WERT';
            const steps = [{ n: 1, kind: 'sample' as const, do: 'RPM', channels: [channel] }];
            const modules = await loadProbeModules(steps, index);
            let count = 0;
            const run = await s.startProbe({ id: 'practice', v: 1, steps, judge: [{ id: 'rotation', channel, stat: 'max', op: '>', value: 0, provenance: 'authored' }] },
                { module: m => modules.get(m) ?? null, ledger: () => EMPTY_LEDGER, onSample: () => { if (++count === 4) s.stopLog(); } });
            expect(run?.judges[0], s.lastError() ?? '').toMatchObject({ pass: true, n: 4 });
        }
    );

    it('connects, says so in its snapshot and to subscribers, and identifies the DME through the loader it was given', async () => {
        const s = sessionFor('mss54');
        const seen: LinkSnapshot['state'][] = [];
        const off = s.subscribe(() => seen.push(s.getSnapshot().state));
        await s.connect('practice');
        off();
        expect(s.getSnapshot()).toMatchObject({ state: 'connected', mode: 'practice', error: null });
        expect(seen).toContain('connecting');
        expect(seen.at(-1)).toBe('connected');
        // The identity is read on the DME before anything else goes to it: the M3 rule needs the
        // variant rules, which came through the configured loader.
        const ident = await s.readIdent();
        expect(ident?.length).toBeGreaterThan(0);
        expect(s.getSnapshot().fitment.get(0x12)?.moduleId).toBe('mss54');
    });

    it.each([
        ['ms420ds0', '15', '10'], ['ms430ds0', '19', '10'],
        ['bms46ds0', '61', '10'], ['bms46ds1', '61', 'A7'],
    ])('reads the independently simulated idle adaptation and speed on %s', async (module, hw, diag) => {
        practiceCar.idents = { 0x12: { hw, diag } };
        const session = sessionFor(module);
        await session.connect('practice');
        const targets = (await loadScanTargets(index)).filter(t => t.address === 0x12);
        await session.scanAll(targets, () => EMPTY_LEDGER);
        const read = await session.readFittedJob(module, 0x12, 'STATUS_LL_ADAPTION', () => EMPTY_LEDGER);
        const expected = readShipped<{ practiceLearned: { expectedIdle: { value: number; unit: string } } }>(module + '.results.json').practiceLearned.expectedIdle;
        expect(read?.decoded?.status, session.getSnapshot().error ?? module).toBe('OKAY');
        const idle = read?.decoded?.values.find(v => v.name === 'STAT_LL_ADAPTION_WERT');
        expect(idle?.unit).toBe(expected.unit);
        expect(idle?.value).toBeCloseTo(expected.value, 5);
        await session.disconnect();
        await session.connect('practice');
        expect(await session.readFittedJob(module, 0x12, 'STATUS_LL_ADAPTION', () => EMPTY_LEDGER)).toBeNull();
        await session.readIdent();
        expect((await session.readFittedJob(module, 0x12, 'STATUS_LL_ADAPTION', () => EMPTY_LEDGER))?.decoded?.status).toBe('OKAY');
        expect(await session.readVehicleState()).toBe('parked');
        practiceCar.speedKmh = 23;
        expect(await session.readVehicleState()).toBe('moving');
    });

    it('runs a SERVICE read only for the module found by a scan of this connection', async () => {
        const s = sessionFor('mss54');
        await s.connect('practice');
        const read = (module: string, job = 'STATUS_DIGITAL') => s.readFittedJob(module, 0x12, job, () => EMPTY_LEDGER);
        expect(await read('mss54')).toBeNull();
        const targets = (await loadScanTargets(index)).filter(t => t.address === 0x12);
        await s.scanAll(targets, () => EMPTY_LEDGER);
        expect(await read('ms430ds0')).toBeNull();
        expect(await read('mss54', 'FS_LOESCHEN')).toBeNull();
        expect(await read('mss54')).toMatchObject({ jobId: 'STATUS_DIGITAL', error: null });
        await s.disconnect();
        await s.connect('practice');
        expect(await read('mss54')).toBeNull();
    });

    it('keeps DDE3 identification when this ECU has no released fault reader', async () => {
        practiceCar.idents = { 0x12: { hw: '52', diag: '10' } };
        const s = sessionFor('dde30ds0');
        await s.connect('practice');
        const targets = (await loadScanTargets(index)).filter(t => t.address === 0x12);
        const scan = await s.scanAll(targets, () => EMPTY_LEDGER);
        expect(scan?.results[0]).toMatchObject({ outcome: 'identified', variant: { moduleId: 'dde30ds0' } });
        expect(scan?.results[0]?.faults).toBeUndefined();
        const start = s.getSnapshot().log.length;
        expect(await s.readVehicleState()).toBe('unknown');
        expect(s.getSnapshot().log.slice(start).some(line => line.text.includes('Speed preflight (DME block'))).toBe(false);
    });

    it.each([
        ['mss54', '1B', '90'], ['ms430ds0', '19', '10'], ['ms420ds0', '15', '10'],
        ['dde30ds0', '52', '10'], ['bms43ds0', '60', '10'], ['bms46ds0', '61', '10'], ['bms46ds1', '61', 'A7'],
    ])('%s logs the identified ECU and judges its native RPM in PROBE', async (id, hw, diag) => {
        const mss54 = id === 'mss54';
        const channel = mss54 ? '3:n' : `${id}:STATUS_MOTORDREHZAHL:STAT_MOTORDREHZAHL_WERT`;
        practiceCar.idents = { 0x12: { hw, diag } };
        practiceCar.engineRunning = true;
        const s = sessionFor(id);
        await s.connect('practice');
        await s.readIdent();
        expect(s.getSnapshot().fitment.get(0x12)?.moduleId).toBe(id);
        const { reads, unknown } = await moduleLogReads(mss54 ? [] : [channel], () => 0x12);
        expect(unknown).toEqual([]);
        const samples: number[] = [];
        await new Promise<void>((resolve, reject) => {
            s.startLog(mss54 ? [channel as ChannelId] : [], sample => {
                const value = (sample.values as Record<string, number>)[channel];
                if (typeof value === 'number') samples.push(value);
                s.stopLog();
            }, failure => failure ? reject(new Error(failure)) : resolve(), { reads, ledger: () => EMPTY_LEDGER });
            if (s.getSnapshot().state !== 'logging') reject(new Error(s.lastError() ?? 'not logging'));
        });
        expect(samples).toHaveLength(1);
        expect(samples[0]).toBeGreaterThan(750);
        expect(samples[0]).toBeLessThan(900);
        const steps = [{ n: 1, kind: 'sample' as const, do: 'RPM', channels: [channel] }];
        const modules = await loadProbeModules(steps, index);
        let measured = 0;
        const run = await s.startProbe({ id: 'rpm', v: 1, steps, judge: [{ id: 'rpm', channel, stat: 'mean', op: '>', value: 750, provenance: 'authored' }] },
            { module: m => modules.get(m) ?? null, ledger: () => EMPTY_LEDGER, onSample: () => { if (++measured === 3) s.stopLog(); } });
        expect(run?.samples.length, s.lastError() ?? '').toBe(3);
        expect(run?.judges[0]).toMatchObject({ pass: true, n: 3 });
        if (!mss54) {
            expect(run!.samples.every(sample => Object.keys(sample.values).every(c => c.startsWith(id + ':')))).toBe(true);
            const incompatible = await s.startProbe({ id: 'wrong', v: 1, steps: [{ ...steps[0], channels: ['3:n'] }] },
                { module: () => null, ledger: () => EMPTY_LEDGER, onSample: () => s.stopLog() });
            expect(incompatible).toBeNull();
            const table = readShipped<SgbdResultsTable>(`${id}.results.json`);
            expect(telemetryValues(table, 'STATUS_MOTORDREHZAHL', reads[0].telegram!.hex,
                answerFrame(0x12, 0xa0, new Uint8Array([4])))).toEqual([]);
        }
    });

    it('reads the DME fault memory, decoded', async () => {
        const s = sessionFor('mss54');
        await s.connect('practice');
        const faults = await s.readFaults();
        expect(Array.isArray(faults)).toBe(true);
        expect(s.getSnapshot().faults?.length).toBe(practiceCar.dmeFaults.length);
    });

    it('sends nothing that must wait for a stationary car while the car is moving', async () => {
        const s = sessionFor('mss54');
        await s.connect('practice');
        practiceCar.speedKmh = 40;
        const cleared = await s.clearFaults();
        expect(cleared).toBeNull();
        expect(s.lastError()).toMatch(/not sent — the car could not be shown to be stationary \(moving\)/);
        // The same refusal as a shape, with the speed the DME gave (for SUITE's maintenance_car_run).
        expect(s.lastNotSent()).toMatchObject({ reason: 'moving', measured: { motion: 'moving', speedKmh: 40 } });
        s.clearError();
        expect(s.lastNotSent()).toBeNull();
        expect(s.getSnapshot().state).toBe('connected');
    });

    it('refuses an operation for a module other than the one the link was opened for', async () => {
        const s = sessionFor('mss54');
        await s.connect('practice');
        const smg = index.modules.find((m) => m.id === 'smg2')!;
        s.setTarget(moduleProtocol('smg2', smg.address, readShipped<TelegramTable>('smg2.telegrams.json')));
        expect(await s.readIdent()).toBeNull();
        expect(s.lastError()).toMatch(/The module changed under an open link/);
    });

    it('keeps a snapshot until something changes, so a screen re-renders only on a change', async () => {
        const s = sessionFor('mss54');
        const before = s.getSnapshot();
        s.clearError();
        expect(s.getSnapshot()).toBe(before);
        await s.connect('practice');
        expect(s.getSnapshot()).not.toBe(before);
    });

    describe('a job that drives something (owner, 2026-11-15)', () => {
        /** An MSS54 job the owner decided to run, with a certain frame and no arguments, and its verdict in PRACTICE. */
        const drive = (pred: (j: EcuProfile['jobs'][number]) => boolean = () => true) => {
            const profile = readShipped<EcuProfile>('mss54.jobs.json');
            const tables = readShipped<TelegramTable>('mss54.telegrams.json');
            for (const job of profile.jobs) {
                if (!pred(job)) continue;
                const v = mayActuate(job, bestTelegram(tables, job.id), EMPTY_LEDGER, { moduleId: 'mss54', mode: 'practice', motion: 'parked', group: 'engine' });
                if (v.allowed && v.actuation && decisionFor('mss54', job, 'engine').how === 'run') return { job, v };
            }
            throw new Error('no such job');
        };

        it('runs in PRACTICE with its permit, measures the battery and engine first, and counts as practised', async () => {
            const practised: string[] = [];
            const s = new LinkSession({ target: moduleProtocol('mss54', 0x12, readShipped<TelegramTable>('mss54.telegrams.json')), onPracticed: (p) => practised.push(p.jobId) });
            opened.push(s);
            await s.connect('practice');
            const { job, v } = drive((j) => !j.preconditions.includes('engine_off'));
            const permit = permitFor(v, 'mss54', job.id, Date.now())!;
            const r = await s.runRead(job.id, v.telegram.hex, v.requires, permit);
            expect(r, s.lastError() ?? '').not.toBeNull();
            expect(practised).toEqual([job.id]);
            expect(s.getSnapshot().log.some((l) => /Battery and engine preflight/.test(l.text))).toBe(true);
        });

        it('sends nothing on a permit for another frame, a weak battery, or an engine its SGBD wants stopped', async () => {
            const s = sessionFor('mss54');
            await s.connect('practice');
            const { job, v } = drive((j) => j.preconditions.includes('engine_off'));
            const permit = permitFor(v, 'mss54', job.id, Date.now())!;
            expect(await s.runRead(job.id, '12 05 0b 03 1f', v.requires, permit)).toBeNull();
            expect(s.lastError()).toMatch(/the permit does not cover this frame/);
            expect(s.lastNotSent()).toMatchObject({ reason: 'permission', what: job.id });
            // The practice car idles: an engine-off job is not sent.
            expect(await s.runRead(job.id, v.telegram.hex, v.requires, permit)).toBeNull();
            expect(s.lastError()).toMatch(/asks for the engine stopped/);
            expect(s.lastNotSent()).toMatchObject({ reason: 'engine', measured: { engineWanted: 'off' } });
            expect(s.lastNotSent()?.measured.voltageV).toBeGreaterThanOrEqual(12);
            expect(s.lastNotSent()?.measured.rpm).toBeGreaterThan(0);
            practiceCar.engineRunning = false;
            practiceCar.batteryV = 11.4;
            expect(await s.runRead(job.id, v.telegram.hex, v.requires, permit)).toBeNull();
            expect(s.lastError()).toMatch(/battery reads 11\.4 V, under 12 V/);
            expect(s.lastNotSent()).toMatchObject({ reason: 'voltage', measured: { voltageV: 11.4, minVoltageV: 12 } });
            practiceCar.batteryV = 12.6;
            expect(await s.runRead(job.id, v.telegram.hex, v.requires, permit)).not.toBeNull();
        });

        it('asks a running thing again without measuring, and releases it whatever is measured', async () => {
            const s = sessionFor('mss54');
            await s.connect('practice');
            const { job, v } = drive((j) => j.preconditions.includes('engine_off'));
            const run = permitFor(v, 'mss54', job.id, Date.now())!;
            const before = s.getSnapshot().log.length;
            // The engine idles, which the run itself would refuse: a re-ask and a release are not held back by it.
            expect(await s.runRead(job.id, v.telegram.hex, 'parked', { ...run, kind: 'follow' })).not.toBeNull();
            expect(await s.runRead(job.id, v.telegram.hex, 'none', { ...run, kind: 'stop' })).not.toBeNull();
            expect(s.getSnapshot().log.slice(before).some((l) => /preflight/.test(l.text))).toBe(false);
        });
    });
});

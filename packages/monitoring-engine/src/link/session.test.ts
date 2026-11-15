import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { configureEcuData, fetchEcuDataFromPage, type EcuDataLoader } from '../ecuData.ts';
import type { EcuIndex } from '../ecuCatalog.ts';
import { moduleProtocol } from '../moduleProtocol.ts';
import { practiceCar, resetPracticeCar } from '../practiceCar.ts';
import type { TelegramTable } from '../telegrams.ts';
import { HAVE_SHIPPED_DATA, readShipped } from '../testing/shipped.ts';
import type { EcuProfile } from '../ecuCatalog.ts';
import { mayActuate } from '../actuationGate.ts';
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
            // The practice car idles: an engine-off job is not sent.
            expect(await s.runRead(job.id, v.telegram.hex, v.requires, permit)).toBeNull();
            expect(s.lastError()).toMatch(/asks for the engine stopped/);
            practiceCar.engineRunning = false;
            practiceCar.batteryV = 11.4;
            expect(await s.runRead(job.id, v.telegram.hex, v.requires, permit)).toBeNull();
            expect(s.lastError()).toMatch(/battery reads 11\.4 V, under 12 V/);
            practiceCar.batteryV = 12.6;
            expect(await s.runRead(job.id, v.telegram.hex, v.requires, permit)).not.toBeNull();
        });
    });
});

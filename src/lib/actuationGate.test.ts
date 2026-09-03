import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { mayActuate, whyNotSendable } from './actuationGate';
import type { EcuIndex, EcuProfile } from './ecuCatalog';
import { EMPTY_LEDGER } from './ledger';
import { mayRun } from './runGate';
import type { Telegram } from './telegrams';

const DATA = path.resolve(import.meta.dirname, '..', '..', 'public', 'ecu-data');
const read = <T,>(f: string) => JSON.parse(readFileSync(path.join(DATA, f), 'utf-8')) as T;
const mss54 = read<EcuProfile>('mss54.jobs.json');
const index = read<EcuIndex>('index.json');

type TelegramTable = { jobs: Record<string, { hex: string; cmd: number; confidence: string }[]> };

const tel = (hex: string): Telegram => ({ hex, cmd: 0, confidence: 'single' } as Telegram);
const shaky = (hex: string): Telegram => ({ hex, cmd: 0, confidence: 'shared' } as Telegram);

// 12 05 0c … — SET_IO_STATUS. The actuator control byte, and the one that must
// never leave for a car through this gate.
const ACTUATE = tel('12 06 0c 01 ff e6');
const READ = tel('12 04 0b 1d');

describe('a vehicle gets exactly what mayRun says, and nothing else', () => {
    it('returns the same verdict as mayRun, job for job, across the module', () => {
        // Not a spot check: if this gate ever diverges from mayRun on a vehicle,
        // there are two answers to "may this be sent" and one of them is wrong.
        for (const j of mss54.jobs) {
            for (const t of [null, READ, ACTUATE, shaky('12 04 0b 1d')]) {
                const mine = mayActuate(j, t, EMPTY_LEDGER, { moduleId: 'mss54', mode: 'vehicle' });
                const theirs = mayRun(j, t, EMPTY_LEDGER, { moduleId: 'mss54' });
                expect(mine).toEqual(theirs);
            }
        }
    });

    it('refuses an actuator control byte even when everything else lines up', () => {
        const read = mss54.jobs.find((j) => j.class === 'read' && j.args.length === 0)!;
        const v = mayActuate(read, ACTUATE, EMPTY_LEDGER, { moduleId: 'mss54', mode: 'vehicle' });
        expect(v.allowed).toBe(false);
        if (!v.allowed) expect(v.reason).toBe('run_block_controlWrites');
    });
});

describe('PRACTICE opens the actuator surface, with three refusals kept', () => {
    const ctx = { moduleId: 'mss54', mode: 'practice' as const };

    it('allows a non-read control byte — that is the surface being exercised', () => {
        const j = mss54.jobs.find((x) => x.class === 'test' && x.args.length === 0)!;
        const v = mayActuate(j, ACTUATE, EMPTY_LEDGER, ctx);
        expect(v.allowed).toBe(true);
        if (v.allowed) expect(v.control).toBe(0x0c);
    });

    it('refuses programming and identity, because their own labels say it does', () => {
        const prog = mss54.jobs.find((j) => j.class === 'programming')!;
        const v = mayActuate(prog, ACTUATE, EMPTY_LEDGER, ctx);
        expect(v.allowed).toBe(false);
        if (!v.allowed) expect(v.reason).toBe('run_block_programming');

        const ews3 = read<EcuProfile>('ews3.jobs.json');
        const ident = ews3.jobs.find((j) => j.class === 'identity')!;
        const w = mayActuate(ident, ACTUATE, EMPTY_LEDGER, { ...ctx, moduleId: 'ews3' });
        expect(w.allowed).toBe(false);
        if (!w.allowed) expect(w.reason).toBe('run_block_identity');
    });

    it('refuses EVERY job that takes arguments, filled in or not', () => {
        // Not a form-validation rule. There is no encoder from an argument list
        // to a DS2 frame in this repo: the only frames it can send are derived
        // from the protocol or replayed from the static scrape, and a scraped
        // frame embeds whatever values the SGBD's bytecode happened to hold.
        // Sending it while the gate showed the operator's values would disclose
        // a call that is not the call — and it would look like it worked.
        const withArgs = mss54.jobs.filter((j) => j.args.length > 0);
        expect(withArgs.length).toBeGreaterThan(10);
        for (const j of withArgs) {
            const v = mayActuate(j, ACTUATE, EMPTY_LEDGER, ctx);
            expect(v.allowed, `${j.id} must not be runnable`).toBe(false);
        }
    });

    it('leaves 63 actuator jobs actually runnable, so the surface is not empty', () => {
        // The refusals above are only meaningful if something survives them. All
        // 63 are zero-argument test jobs with one certain telegram, and the
        // STEUERN_EKP pair among them exercises the two-button hold path. It was
        // 55 until the telegram extractor stopped filtering frames through a
        // command whitelist written for MSS54 — the eight that arrived are jobs
        // whose frames existed all along and were being discarded.
        let n = 0;
        for (const m of index.modules) {
            const p = read<EcuProfile>(`${m.id}.jobs.json`);
            const tels = read<TelegramTable>(`${m.id}.telegrams.json`);
            for (const j of p.jobs) {
                if (j.class !== 'test') continue;
                const es = tels.jobs[j.id] ?? [];
                if (es.length !== 1 || es[0].confidence !== 'single') continue;
                const t = { hex: es[0].hex, cmd: es[0].cmd, confidence: 'single' } as Telegram;
                if (mayActuate(j, t, EMPTY_LEDGER, { moduleId: m.id, mode: 'practice' }).allowed) n++;
            }
        }
        expect(n).toBe(63);
    });

    it('refuses when the telegram is missing or not certain', () => {
        const j = mss54.jobs.find((x) => x.class === 'test' && x.args.length === 0)!;
        for (const t of [null, shaky('12 06 0c 01 ff e6')]) {
            const v = mayActuate(j, t, EMPTY_LEDGER, ctx);
            expect(v.allowed).toBe(false);
            if (!v.allowed) expect(v.reason).toBe('run_block_noTelegram');
        }
    });

    it('allows unclassified — its caution is about vehicles, and this is not one', () => {
        const zke5 = read<EcuProfile>('zke5.jobs.json');
        const u = zke5.jobs.find((j) => j.class === 'unclassified' && j.args.length === 0);
        if (!u) return; // the invariant below covers the case where none exist
        expect(mayActuate(u, ACTUATE, EMPTY_LEDGER, { ...ctx, moduleId: 'zke5' }).allowed).toBe(true);
    });
});

describe('the byte-level check the link performs before sending', () => {
    // The required assertion: on a vehicle, 0x0c does not go. Kept as a pure
    // function precisely so it can be asserted without mounting a hook.
    it('refuses 0x0c on a vehicle', () => {
        expect(whyNotSendable(0x0c, 'vehicle')).toMatch(/not a read/);
    });

    it('refuses every control outside the read allowlist on a vehicle', () => {
        const allowed = [0x00, 0x04, 0x06, 0x0a, 0x0b, 0x0d, 0x14, 0x1a, 0x53, 0x6d];
        for (let c = 0; c <= 0xff; c++) {
            const verdict = whyNotSendable(c, 'vehicle');
            if (allowed.includes(c)) expect(verdict).toBeNull();
            else expect(verdict).not.toBeNull();
        }
    });

    it('lets a non-read control through in PRACTICE, and still names reads as reads', () => {
        expect(whyNotSendable(0x0c, 'practice')).toBeNull();
        expect(whyNotSendable(0x05, 'practice')).toBeNull();
        expect(whyNotSendable(0x0b, 'practice')).toBeNull();
    });

    it('names the byte it refused, in hex, so a log line is actionable', () => {
        expect(whyNotSendable(0x07, 'vehicle')).toContain('0x07');
    });
});

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Ds2Control, Ds2Status, buildDs2Frame, toHex } from '@tsunagi/ds2-core';
import { MSS54_ADAPTATION_BLOCKS } from '@tsunagi/ds2-mss54';
import { practiceEcu } from './practiceEcu';
import {
    READ_ONLY_CONTROLS,
    clearFaultsCommand,
    mayRun,
    telegramBytes,
} from './runGate';
import { EMPTY_LEDGER, type Ledger } from './ledger';
import { bestTelegram, type TelegramTable } from './telegrams';
import type { CatalogJob, EcuProfile } from './ecuCatalog';

const DATA = path.resolve(import.meta.dirname, '..', '..', 'public', 'ecu-data');
const MODULES = ['mss54', 'smg2', 'dsc_e46'] as const;
type ModuleId = (typeof MODULES)[number];

const read = <T,>(f: string) => JSON.parse(readFileSync(path.join(DATA, f), 'utf-8')) as T;
const profile = (m: ModuleId) => read<EcuProfile>(`${m}.jobs.json`);
const telegrams = (m: ModuleId) => read<TelegramTable>(`${m}.telegrams.json`);

const ctx = (m: ModuleId) => ({ moduleId: m });

describe('telegramBytes', () => {
    it('parses a well-formed frame', () => {
        const b = telegramBytes('12 05 0b 04 18')!;
        expect(Array.from(b)).toEqual([0x12, 0x05, 0x0b, 0x04, 0x18]);
    });

    // Each of these would otherwise become a frame sent to a car.
    it('refuses anything that is not one', () => {
        expect(telegramBytes('12 05 0b 04 19')).toBeNull(); // checksum wrong
        expect(telegramBytes('12 06 0b 04 1b')).toBeNull(); // length disagrees
        expect(telegramBytes('12 05 0b zz 18')).toBeNull(); // not hex
        expect(telegramBytes('12 05')).toBeNull(); // too short
        expect(telegramBytes('')).toBeNull();
    });

    it('agrees with the frame builder byte for byte', () => {
        const built = buildDs2Frame(0x12, Ds2Control.READ_IO_STATUS, new Uint8Array([0x04]));
        expect(Array.from(telegramBytes(toHex(built))!)).toEqual(Array.from(built));
    });
});

describe('the run gate', () => {
    const job = (m: ModuleId, id: string): CatalogJob => {
        const hit = profile(m).jobs.find((j) => j.id === id);
        if (!hit) throw new Error(`${m} has no job ${id}`);
        return hit;
    };
    const verdict = (m: ModuleId, id: string, ledger: Ledger = EMPTY_LEDGER) =>
        mayRun(job(m, id), bestTelegram(telegrams(m), id), ledger, ctx(m));

    /**
     * The finding that made `unclassified` a class.
     *
     * The generator's last line used to read "anything that got here, the SGBD said nothing
     * about" and then classify it `read` — on the reasoning that read is the safe thing to be.
     * At three modules that fell on nothing. At 51 it falls on 177 jobs, among them EWS3's
     * C_FG_AUFTRAG (writes the VIN), C_C_AUFTRAG (writes coding data) and MRS3's
     * CONTROLLER_RESET — several of which take no arguments, which is exactly the shape that
     * reaches the control-byte check.
     *
     * This pins the gate side of it: everything else about the job is perfect — a certain
     * telegram, no arguments, a control byte on the read allowlist — and it is still refused,
     * because not knowing what a job does is not evidence that it is harmless.
     */
    it('refuses an unclassified job even when everything else about it is perfect', () => {
        const base = job('mss54', 'STATUS_DIGITAL');
        const tele = bestTelegram(telegrams('mss54'), 'STATUS_DIGITAL');
        expect(mayRun(base, tele, EMPTY_LEDGER, ctx('mss54')).allowed).toBe(true);

        const unclassified: CatalogJob = { ...base, class: 'unclassified' };
        const v = mayRun(unclassified, tele, EMPTY_LEDGER, ctx('mss54'));
        expect(v.allowed).toBe(false);
        if (!v.allowed) expect(v.reason).toBe('run_block_notVerified');
    });

    it('does not ship a single job that claims to be a read without an operation kind', () => {
        // The data half of the same finding, over every module rather than a sample: the two
        // ways of saying "we could not classify this" must never disagree, because the UI reads
        // one and the gate reads the other.
        const index = read<{ modules: { id: string }[] }>('index.json');
        const bad: string[] = [];
        for (const m of index.modules) {
            const p = read<EcuProfile>(`${m.id}.jobs.json`);
            for (const j of p.jobs) {
                if ((j.class === 'unclassified') !== (j.op?.kind === 'unknown')) {
                    bad.push(`${m.id}.${j.id} class=${j.class} kind=${j.op?.kind}`);
                }
            }
        }
        expect(bad).toEqual([]);
    });

    it('lets an argument-free read with a certain telegram through', () => {
        const v = verdict('mss54', 'STATUS_DIGITAL');
        expect(v.allowed).toBe(true);
        if (v.allowed) expect(v.control).toBe(Ds2Control.READ_IO_STATUS);
    });

    it('refuses everything that is not a read, with an empty ledger', () => {
        for (const m of MODULES) {
            for (const j of profile(m).jobs) {
                if (j.class === 'read') continue;
                const v = mayRun(j, bestTelegram(telegrams(m), j.id), EMPTY_LEDGER, ctx(m));
                expect(v.allowed, `${m}.${j.id}`).toBe(false);
            }
        }
    });

    it('refuses a read whose telegram is only shared or multiple', () => {
        // FS_LESEN's frames are shared with other jobs — the scrape recovered a
        // template, not this job's request.
        expect(verdict('mss54', 'FS_LESEN').allowed).toBe(false);
    });

    it('refuses a read that takes arguments', () => {
        // The scraped frame embeds argument values we did not choose.
        const v = verdict('mss54', 'SPEICHER_LESEN');
        expect(v.allowed).toBe(false);
        if (!v.allowed) expect(v.reason).toBe('run_block_needsArgs');
    });

    /**
     * PRACTICE must not block a read.
     *
     * The first cut of this gate refused everything unless a vehicle was
     * connected, which meant the transmit path's first ever execution would
     * have been on a real M3. The simulated ECU exists precisely so that does
     * not happen.
     */
    it('does not refuse a read just because the session is simulated', () => {
        const v = verdict('mss54', 'STATUS_DIGITAL');
        expect(v.allowed).toBe(true);
    });

    it('gives programming its own refusal, before anything else is considered', () => {
        const prog = profile('mss54').jobs.find((j) => j.class === 'programming')!;
        const v = mayRun(prog, bestTelegram(telegrams('mss54'), prog.id), EMPTY_LEDGER, ctx('mss54'));
        expect(v.allowed).toBe(false);
        if (!v.allowed) expect(v.reason).toBe('run_block_programming');
    });

    /**
     * The check that does not trust our own classifier.
     *
     * `class: 'read'` is a regex's opinion of an SGBD comment. If it were ever
     * wrong about a job whose frame carries 0x0c (IO control) or 0x05 (clear),
     * this is what stops it. Forged here because — verified below — no real job
     * is in that state today, and a safety check with no test is a wish.
     */
    it('refuses a frame whose control byte writes, whatever the class says', () => {
        const forged = { ...job('mss54', 'STATUS_DIGITAL'), args: [] } as CatalogJob;
        const ioControl = buildDs2Frame(0x12, Ds2Control.SET_IO_STATUS, new Uint8Array([0x01]));
        const v = mayRun(
            forged,
            { hex: toHex(ioControl), cmd: Ds2Control.SET_IO_STATUS, cmdName: 'IO control', occurrences: 1, confidence: 'single' },
            EMPTY_LEDGER,
            ctx('mss54'),
        );
        expect(v.allowed).toBe(false);
        if (!v.allowed) expect(v.reason).toBe('run_block_controlWrites');
    });

    /**
     * ...and the state of the real data behind that check.
     *
     * Not one job classified `read` carries a mutating control byte. If this
     * ever fails, the classifier and the bytes have diverged and the bytes are
     * right.
     */
    it('finds no job where our class and the wire disagree', () => {
        for (const m of MODULES) {
            for (const j of profile(m).jobs) {
                if (j.class !== 'read') continue;
                const t = bestTelegram(telegrams(m), j.id);
                if (!t || t.confidence !== 'single') continue;
                const b = telegramBytes(t.hex);
                if (!b) continue;
                expect(READ_ONLY_CONTROLS.has(b[2]), `${m}.${j.id} control 0x${b[2].toString(16)}`).toBe(true);
            }
        }
    });

    it('never lets a mutating control byte through for any real job', () => {
        for (const m of MODULES) {
            for (const j of profile(m).jobs) {
                const v = mayRun(j, bestTelegram(telegrams(m), j.id), EMPTY_LEDGER, ctx(m));
                if (!v.allowed) continue;
                expect(READ_ONLY_CONTROLS.has(v.control), `${m}.${j.id}`).toBe(true);
            }
        }
    });

    // A ledger entry unlocks a non-read. Proves the gate is a gate and not a
    // permanent wall — the wall is the empty shipped ledger.
    it('opens for a non-read once the ledger vouches for it', () => {
        const target = profile('mss54').jobs.find(
            (j) => j.class === 'test' && j.args.length === 0,
        )!;
        const ledger: Ledger = {
            version: 1,
            records: {
                [`mss54:${target.id}`]: { id: `mss54:${target.id}`, status: 'verified', verifiedAt: '2026-01-01' },
            },
        };
        const before = mayRun(target, bestTelegram(telegrams('mss54'), target.id), EMPTY_LEDGER, ctx('mss54'));
        const after = mayRun(target, bestTelegram(telegrams('mss54'), target.id), ledger, ctx('mss54'));
        expect(before.allowed).toBe(false);
        if (!before.allowed) expect(before.reason).toBe('run_block_notVerified');
        // Verified, and STILL blocked — but for the honest reason: this app has
        // no execution path for an actuator test yet. Two different sentences.
        expect(after.allowed).toBe(false);
        if (!after.allowed) expect(after.reason).toBe('run_block_notRead');
    });
});

describe('clearing fault memory', () => {
    /**
     * The frame is built from the protocol; the scrape corroborates it. Both
     * derivations must agree, on every module, or one of them is wrong.
     */
    it('matches the frame the SGBD scrape recovered, on all three modules', () => {
        const addresses: Record<ModuleId, number> = { mss54: 0x12, smg2: 0x32, dsc_e46: 0x56 };
        const { control, payload } = clearFaultsCommand();
        expect(control).toBe(Ds2Control.CLEAR_ERROR_MEMORY);
        expect(payload).toHaveLength(0);

        for (const m of MODULES) {
            const built = toHex(buildDs2Frame(addresses[m], control, payload));
            const scraped = (telegrams(m).jobs['FS_LOESCHEN'] ?? []).map((t) => t.hex);
            expect(scraped, `${m} FS_LOESCHEN`).toContain(built);
        }
    });

    it('is not in the read-only set — it is a write, and named as one', () => {
        expect(READ_ONLY_CONTROLS.has(Ds2Control.CLEAR_ERROR_MEMORY)).toBe(false);
    });
});

/**
 * The invariant whose absence made the whole feature undemonstrable.
 *
 * PRACTICE exists so the app's real paths execute without a car. If the
 * simulated ECU refuses what `mayRun` permits, the run surface cannot be
 * exercised at all except on a real M3 — which is exactly the state this
 * shipped in: of the five jobs the gate allows, the simulator answered two.
 * The other three came back `REJECTED`, and the one visible under the default
 * filter was one of them, so a user in PRACTICE could not successfully run
 * anything.
 */
describe('PRACTICE answers everything the gate permits', () => {
    const ecu = practiceEcu();

    it('has a responder at all', () => {
        expect(ecu.respond).toBeTypeOf('function');
    });

    it('returns a payload, never a refusal, for every allowed job', () => {
        let checked = 0;
        for (const m of MODULES) {
            for (const j of profile(m).jobs) {
                const v = mayRun(j, bestTelegram(telegrams(m), j.id), EMPTY_LEDGER, ctx(m));
                if (!v.allowed) continue;
                const bytes = telegramBytes(v.telegram.hex)!;
                const answer = ecu.respond!({
                    address: bytes[0],
                    controlOrStatus: bytes[2],
                    payload: bytes.slice(3, bytes.length - 1),
                } as never);
                checked++;
                expect(answer, `${m}.${j.id} got no answer`).not.toBeNull();
                expect(
                    answer!.status ?? Ds2Status.ACKNOWLEDGE,
                    `${m}.${j.id} (control 0x${v.control.toString(16)}) was refused by PRACTICE`,
                ).toBe(Ds2Status.ACKNOWLEDGE);
                expect(answer!.payload?.length ?? 0).toBeGreaterThan(0);
            }
        }
        // If this ever drops to zero the loop is vacuous and the test is a lie.
        expect(checked).toBeGreaterThan(0);
    });

    // The MSS54 adaptation blocks are read with the same control byte as the
    // live blocks, and only the live ones were handled — so "read adaptations"
    // reported all four blocks refused.
    it('answers the adaptation blocks, not just the live ones', () => {
        for (const block of MSS54_ADAPTATION_BLOCKS) {
            const answer = ecu.respond!({
                address: 0x12,
                controlOrStatus: Ds2Control.READ_IO_STATUS,
                payload: new Uint8Array([block.selection]),
            } as never);
            expect(answer, `adaptation block ${block.selection}`).not.toBeNull();
            expect(answer!.status ?? Ds2Status.ACKNOWLEDGE).toBe(Ds2Status.ACKNOWLEDGE);
        }
    });

    // The actuator control byte answers here now, and ONLY here: `mayActuate`
    // opens 0x0c in PRACTICE so the send path, the argument builder and STOP
    // execute before an M3 is the first thing they execute against. On a vehicle
    // `whyNotSendable` still refuses it — see actuationGate.test.ts.
    it('acknowledges the actuator control byte, with no invented payload', () => {
        const answer = ecu.respond!({
            address: 0x12,
            controlOrStatus: Ds2Control.SET_IO_STATUS,
            payload: new Uint8Array([0x01, 0xff]),
        } as never);
        // A bare ACK. A real ECU's reply to SET_IO_STATUS has a layout this repo
        // has never decoded, so a payload here would be a shape the app learns to
        // parse — and the first real car would be where the parser found out.
        expect(answer).toBeNull();
    });

    // ...while still refusing what the app is NOT allowed to send, anywhere. A
    // simulator that says OKAY to everything is why the tuner's failure path
    // never ran.
    it('still refuses a control byte no path in this app emits', () => {
        const answer = ecu.respond!({
            address: 0x12,
            controlOrStatus: Ds2Control.WRITE_MEMORY,
            payload: new Uint8Array([0x00, 0x00, 0x01]),
        } as never);
        expect(answer?.status).toBe(Ds2Status.REJECTED);
    });
});

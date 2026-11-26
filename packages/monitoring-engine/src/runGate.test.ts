import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Ds2Control, Ds2Status, buildDs2Frame, toHex } from '@tsunagi/ds2-core';
import { MSS54_ADAPTATION_BLOCKS } from '@tsunagi/ds2-mss54';
import { practiceBus, practiceEcu } from './practiceEcu.ts';
import {
    READ_ONLY_CONTROLS,
    clearFaultsCommand,
    isReadOnlyControl,
    mayRun,
    mayRunProtocolRead,
    permitCovers,
    permitFor,
    telegramBytes,
} from './runGate.ts';
import { EMPTY_LEDGER, recordPracticeRun, type Ledger } from './ledger.ts';
import { bestTelegram, type Telegram, type TelegramTable } from './telegrams.ts';
import type { CatalogJob, EcuProfile } from './ecuCatalog.ts';

const DATA = path.resolve(import.meta.dirname, '..', '..', '..', 'public', 'ecu-data');
const MODULES = ['mss54', 'smg2', 'dsc_e46'] as const;

/**
 * Controls the simulator answers without a payload, because we do not know the
 * layout and will not invent one. 0x0c is the actuator; 0x14 and 0x0d are the
 * two reads whose frames the extractor used to drop, so nothing had ever asked.
 */
const BARE_ACK: ReadonlySet<number> = new Set([0x0c, 0x0d, 0x14, 0x9e, 0x9f]);
type ModuleId = (typeof MODULES)[number];

const read = <T,>(f: string) => JSON.parse(readFileSync(path.join(DATA, f), 'utf-8')) as T;
const profile = (m: ModuleId) => read<EcuProfile>(`${m}.jobs.json`);
const telegrams = (m: ModuleId) => read<TelegramTable>(`${m}.telegrams.json`);

const ctx = (m: ModuleId) => ({ moduleId: m, motion: 'parked' as const });

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
    it('judges an unclassified job by its nature: a read name reads, anything else is the owner’s decision', () => {
        const base = job('mss54', 'STATUS_DIGITAL');
        const tele = bestTelegram(telegrams('mss54'), 'STATUS_DIGITAL');
        expect(mayRun(base, tele, EMPTY_LEDGER, ctx('mss54')).allowed).toBe(true);

        // Named as a read: a read filed away (policy r_misc), parked, and its frame must read.
        const unclassified: CatalogJob = { ...base, class: 'unclassified' };
        expect(mayRun(unclassified, tele, EMPTY_LEDGER, ctx('mss54'))).toMatchObject({ allowed: true, requires: 'parked' });
        expect(mayRun(unclassified, tele, EMPTY_LEDGER, { moduleId: 'mss54', motion: 'moving' })).toEqual({ allowed: false, reason: 'run_block_moving' });
        // Named as a mode change: runs (owner, 2026-11-16; shown only before), so like every job
        // that drives something it goes parked, with its terms and the screen's confirmation — never as
        // a read. PRACTICE first is the build's (owner, 2026-11-26: src/lib/practiceEveryItem.test.ts).
        const mode: CatalogJob = { ...base, id: 'SLEEP_MODE', class: 'unclassified' };
        expect(mayRun(mode, tele, EMPTY_LEDGER, ctx('mss54'))).toMatchObject({ allowed: true, requires: 'parked', actuation: {} });
        expect(mayRun(mode, tele, EMPTY_LEDGER, { moduleId: 'mss54', motion: 'moving' })).toEqual({ allowed: false, reason: 'run_block_moving' });
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

    it('lets nothing that is not a read go as a read: parked, with its terms, or not at all', () => {
        for (const m of MODULES) {
            for (const j of profile(m).jobs) {
                if (j.class === 'read') continue;
                const tele = bestTelegram(telegrams(m), j.id);
                const v = mayRun(j, tele, EMPTY_LEDGER, ctx(m));
                if (v.allowed && !isReadOnlyControl(v.control, m)) expect(v, `${m}.${j.id}`).toMatchObject({ requires: 'parked', actuation: {} });
                const moving = mayRun(j, tele, EMPTY_LEDGER, { moduleId: m, motion: 'moving' });
                if (moving.allowed) expect(isReadOnlyControl(moving.control, m) && !moving.actuation, `${m}.${j.id} moving`).toBe(true);
            }
        }
    }, 30_000);

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

    it('never lets a mutating control byte through for any real job without its terms', () => {
        for (const m of MODULES) {
            for (const j of profile(m).jobs) {
                const v = mayRun(j, bestTelegram(telegrams(m), j.id), EMPTY_LEDGER, ctx(m));
                if (!v.allowed || v.actuation) continue;
                expect(isReadOnlyControl(v.control, m), `${m}.${j.id}`).toBe(true);
            }
        }
        // Every job of every module (2,297 since 2026-11-11): past vitest's 5 s when the suite runs in parallel.
    }, 30_000);

    // The owner's table runs it: parked, with its terms, from the shipped (empty) ledger — PRACTICE first is
    // the build's (owner, 2026-11-26). The ledger still withdraws it.
    it('drives an engine actuator the owner decided to run, parked, and never once withdrawn', () => {
        const tables = telegrams('mss54');
        const target = profile('mss54').jobs.find(
            (j) => j.class === 'test' && j.args.length === 0 && j.id.startsWith('STEUERN_') && bestTelegram(tables, j.id)?.confidence === 'single',
        )!;
        expect(target).toBeDefined();
        const tele = bestTelegram(tables, target.id);
        const id = `mss54:${target.id}`;
        // Not asked of this device: the build ran it in PRACTICE (src/lib/practiceEveryItem.test.ts).
        expect(mayRun(target, tele, EMPTY_LEDGER, { ...ctx('mss54'), group: 'engine' })).toMatchObject({ allowed: true, requires: 'parked' });
        const practiced = recordPracticeRun(EMPTY_LEDGER, id, '2026-11-15T00:00:00Z');
        const v = mayRun(target, tele, practiced, { ...ctx('mss54'), group: 'engine' });
        expect(v).toMatchObject({ allowed: true, requires: 'parked', actuation: { nature: 'a_engine', who: 'ai' } });
        // Never while moving, and never once withdrawn.
        expect(mayRun(target, tele, practiced, { moduleId: 'mss54', motion: 'moving', group: 'engine' })).toEqual({ allowed: false, reason: 'run_block_moving' });
        const killed: Ledger = { ...practiced, records: { [id]: { ...practiced.records[id], status: 'revoked', reason: 'x' } } };
        expect(mayRun(target, tele, killed, { ...ctx('mss54'), group: 'engine' })).toEqual({ allowed: false, reason: 'run_block_revoked' });
        // The permit is for exactly this frame.
        if (v.allowed) {
            const permit = permitFor(v, 'mss54', target.id, 1000)!;
            expect(permitCovers(permit, 'mss54', target.id, v.telegram.hex, 1000)).toBe(true);
            expect(permitCovers(permit, 'smg2', target.id, v.telegram.hex, 1000)).toBe(false);
            expect(permitCovers(permit, 'mss54', target.id, '12 05 0b 03 1f', 1000)).toBe(false);
        }
    });

    it('runs the brake hydraulics like the other actuators — practised first, parked — and offers no writes (owner, 2026-11-15)', () => {
        const dsc = profile('dsc_e46');
        const pump = dsc.jobs.find((j) => j.id === 'DRUCKHALTEN')!;
        const v = mayRun(pump, bestTelegram(telegrams('dsc_e46'), pump.id), EMPTY_LEDGER, ctx('dsc_e46'));
        expect(v.allowed).toBe(false);
        if (!v.allowed) expect(v.reason).not.toBe('run_block_policyShow');
        const write = profile('mss54').jobs.find((j) => j.id === 'SPEICHER_SCHREIBEN')!;
        expect(mayRun(write, null, EMPTY_LEDGER, ctx('mss54')).allowed).toBe(false);
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

    // 0x40 reads on SMG II by its SGBD's own comment. On the MSS54 the same byte heads
    // ABGLEICHFLAG_SCHREIBEN, a write: the byte is a read only where the module's list says so.
    it('treats 0x40 as a read on SMG II and nowhere else', () => {
        expect(isReadOnlyControl(0x40, 'smg2')).toBe(true);
        expect(isReadOnlyControl(0x40, 'mss54')).toBe(false);
        expect(isReadOnlyControl(0x40, 'navmk3')).toBe(false);
        expect(READ_ONLY_CONTROLS.has(0x40)).toBe(false);
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
                // The reads. What drives something runs in PRACTICE through the link, its preflight and its
                // own code, in src/lib/practiceEveryItem.test.ts.
                if (!v.allowed || v.actuation) continue;
                const bytes = telegramBytes(v.telegram.hex)!;
                // The module's own responder on the PRACTICE line, as the app reaches it. This
                // asked the DME's responder for every module, which answered SMG II's status
                // blocks 2-4 with the DME's blocks and refused block 5.
                const own = practiceBus([bytes[0]]).find((e) => e.address === bytes[0])!;
                const answer = own.respond!({
                    address: bytes[0],
                    controlOrStatus: bytes[2],
                    payload: bytes.slice(3, bytes.length - 1),
                } as never);
                checked++;
                expect(
                    answer?.status ?? Ds2Status.ACKNOWLEDGE,
                    `${m}.${j.id} (control 0x${v.control.toString(16)}) was refused by PRACTICE`,
                ).toBe(Ds2Status.ACKNOWLEDGE);
                // A payload is required only where the response layout is
                // actually known. For the rest the simulator answers with a
                // bare ACK — `null` — and that is the honest answer, not a
                // gap: inventing a shape here is how a parser learns fiction
                // and the first real car is where it finds out. See the note
                // on 0x0c in practiceEcu.ts.
                if (!BARE_ACK.has(v.control)) {
                    expect(answer, `${m}.${j.id} got no answer`).not.toBeNull();
                    expect(answer!.payload?.length ?? 0).toBeGreaterThan(0);
                }
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

describe('the car, as the gate sees it', () => {
    const tel = (hex: string): Telegram => ({ hex, cmd: parseInt(hex.split(' ')[2], 16), cmdName: '', occurrences: 1, confidence: 'single' });
    const READ: CatalogJob = {
        id: 'STATUS_X',
        class: 'read',
        args: [],
        results: [],
    } as unknown as CatalogJob;
    const T = tel('12 05 0b 03 1f');

    it('lets a status read go whatever the car is doing: the owner decided status values are read while moving (2026-11-15)', () => {
        for (const motion of ['parked', 'moving', 'unknown'] as const) {
            expect(mayRun(READ, T, EMPTY_LEDGER, { moduleId: 'mss54', motion })).toMatchObject({ allowed: true, requires: 'none' });
            expect(mayRun({ ...READ, id: 'STATUS_Y' }, tel('32 05 0b 03 3f'), EMPTY_LEDGER, { moduleId: 'smg2', motion })).toMatchObject({ allowed: true, requires: 'none' });
        }
    });

    it('lets a read filed with the writes go only to a stationary car, and says the link must measure that first', () => {
        const filed: CatalogJob = { ...READ, id: 'READ_CODING_DATA', class: 'unclassified' };
        expect(mayRun(filed, T, EMPTY_LEDGER, { moduleId: 'mss54', motion: 'parked' })).toMatchObject({ allowed: true, requires: 'parked' });
        // Unknown is not a refusal at render time — the preflight at the wire decides — and it is
        // never treated as parked: the requirement still says measure.
        expect(mayRun(filed, T, EMPTY_LEDGER, { moduleId: 'mss54', motion: 'unknown' })).toMatchObject({ allowed: true, requires: 'parked' });
        expect(mayRun(filed, T, EMPTY_LEDGER, { moduleId: 'mss54', motion: 'moving' })).toEqual({ allowed: false, reason: 'run_block_moving' });
        const cleared: Ledger = { version: 1, records: { 'mss54:READ_CODING_DATA': { id: 'mss54:READ_CODING_DATA', status: 'moving-ok' } } };
        expect(mayRun(filed, T, cleared, { moduleId: 'mss54', motion: 'moving' })).toMatchObject({ allowed: true, requires: 'none' });
    });

    it('refuses a withdrawn read whatever the car is doing', () => {
        const killed: Ledger = { version: 1, records: { 'mss54:STATUS_X': { id: 'mss54:STATUS_X', status: 'revoked', reason: 'x' } } };
        for (const motion of ['parked', 'moving', 'unknown'] as const) {
            expect(mayRun(READ, T, killed, { moduleId: 'mss54', motion })).toEqual({ allowed: false, reason: 'run_block_revoked' });
        }
    });
});

describe('the cluster’s VIN read (identity-read, intake 2026-11-10)', () => {
    const id = 'kombi46r:STATUS_AIF_FG_NR_LESEN';

    it('goes as an IDENT goes: it does not wait for the car to stop', () => {
        for (const motion of ['parked', 'moving', 'unknown'] as const) {
            expect(mayRunProtocolRead(id, 'identity-read', EMPTY_LEDGER, motion)).toEqual({ allowed: true, requires: 'none' });
        }
    });

    it('stops when it has been withdrawn', () => {
        const ledger: Ledger = { version: 1, records: { [id]: { id, status: 'revoked', reason: 'kill list' } } };
        expect(mayRunProtocolRead(id, 'identity-read', ledger, 'parked')).toEqual({ allowed: false, reason: 'run_block_revoked' });
    });

    it('its control byte, 0x02, is not a read on every module (SMG II learns with it): never on the allowlist', () => {
        expect(READ_ONLY_CONTROLS.has(0x02)).toBe(false);
    });
});

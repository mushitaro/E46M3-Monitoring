'use client';

/**
 * PRACTICE mode: a simulated MSS54 behind the real transport and link.
 *
 * Selected by an explicit opt-in, never as a silent fallback — the one thing a
 * diagnostic tool must never do is let synthetic values be mistaken for a
 * vehicle's. The UI marks the whole session, not just a toast at connect time.
 *
 * What this is FOR: rehearsing the workflow, and doing UI work without a car.
 * What it is NOT for: predicting the real sample rate (it answers instantly, so
 * its Hz is a property of this machine) or reproducing K-line failure modes. It
 * models state, it does not script it — a block read reflects the same simulated
 * engine each time rather than replaying a canned frame.
 */

import { Ds2Control, Ds2Status } from '@tsunagi/ds2-core';
import {
    ERROR_MEMORY_RECORD_LENGTH,
    MSS54_ADAPTATION_BLOCKS,
    adaptationBlockMinLength,
    blockBySelection,
    type LiveValueBlock,
} from '@tsunagi/ds2-mss54';
import { SimulatedSerialPort, type ExchangeBehavior, type SerialOptions, type SerialPortLike, type SimulatedEcuOptions } from '@tsunagi/ds2-core';
import { KWP_FORMAT, KWP_TESTER, xorOf } from './kwpOnDs2.ts';
import type { JobFramesOracle } from './sgbd/agreedFrame.ts';
import {
    cleanAnswer,
    clearPracticeAdaptations,
    clearPracticeSmg2Adaptations,
    clusterVinAnswer,
    driveNow,
    finishPracticeSmg2Program,
    ds2IdentData,
    perCylinder,
    practiceAdaptation,
    practiceCar,
    practiceDmeOf,
    practiceSmg2AdaptAnswer,
    PRACTICE_DME_RECORDS,
    practiceSpeed,
    smg2PhydBytes,
    type PracticeInjection,
} from './practiceCar.ts';

const START = Date.now();

/** A plausible warming S54: idling when parked, pulling a gear's worth of rpm when the practice car moves. */
function engine() {
    const t = (Date.now() - START) / 1000;
    const v = practiceSpeed();
    const drive = driveNow();
    // A healthy idle wanders about 15 rpm; a sick one as far as the scenario says (practiceCar `symptoms`).
    const swing = practiceCar.symptoms?.idleRpmSwing ?? 15;
    return {
        rpm: drive ? Math.round(drive.rpm) : practiceCar.engineRunning || v > 0 ? Math.round((v > 0 ? 1200 + v * 35 : 820) + swing * Math.sin(t * 1.3)) : 0,
        coolantC: Math.min(92, 22 + 70 * (1 - Math.exp(-t / 90))),
        oilC: Math.min(98, 22 + 76 * (1 - Math.exp(-t / 130))),
        battV: practiceCar.batteryV ?? (practiceCar.engineRunning || v > 0 ? 13.9 + 0.12 * Math.sin(t / 2.5) : 12.5),
    };
}

/**
 * Fills a block payload. Every field gets a value consistent with its own scale
 * and offset, so what the UI renders is what the decoder actually produced —
 * writing plausible *decoded* numbers directly would bypass the very code
 * PRACTICE exists to exercise.
 */
function blockPayload(block: LiveValueBlock): Uint8Array {
    const need = block.fields.reduce(
        (m, f) => Math.max(m, f.offset + (f.format === 'uint8' || f.format === 'int7' ? 1 : f.format === 'int31' || f.format === 'uint32' ? 4 : 2)),
        0,
    );
    const buf = new Uint8Array(Math.max(need, block.expectedLength));
    const e = engine();
    const rough = perCylinder(practiceCar.symptoms?.roughness, 0);
    let sym: RegExpExecArray | null;

    for (const f of block.fields) {
        // Choose a raw value that decodes to something sane for this field.
        let target: number;
        const d = driveNow();
        const vanos = d && /^(e|a)van\d_(ist|soll)$/.exec(f.symbol);
        if (vanos) target = vanos[1] === 'e' ? (vanos[2] === 'ist' ? d.inIst : d.inSoll) : vanos[2] === 'ist' ? d.exIst : d.exSoll;
        else if (d && f.symbol === 'gang') target = d.gear;
        else if (d && f.unit === '%' && /^(pwg|wdk)/.test(f.symbol)) target = d.pedal;
        else if (f.symbol === 'n') target = e.rpm;
        // The symptoms a scenario gave the engine (practiceCar `symptoms`); healthy values otherwise.
        else if ((sym = /^la_f_regler([12])$/.exec(f.symbol))) target = practiceCar.symptoms?.lambdaFactor?.[Number(sym[1]) - 1] ?? 1;
        else if ((sym = /^ll_abw([1-6])$/.exec(f.symbol))) target = rough[Number(sym[1]) - 1];
        else if ((sym = /^lu\[([0-5])\]$/.exec(f.symbol))) target = rough[Number(sym[1])];
        else if (f.symbol === 'tmot') target = e.coolantC;
        // The battery: the DME's `ub` (block 3, main relay) and the UUB fields. Other volts are sensors.
        else if (f.unit === 'V') target = f.symbol.startsWith('UUB') || f.symbol === 'ub' ? e.battV : 2.5;
        else if (f.unit === '°C') target = e.oilC;
        else if (f.unit === 'rpm') target = e.rpm;
        // The practice car's speed: 0 unless a scenario drives it. The speed preflight reads block 19
        // before every read it lets go, so a simulator that drifted along at 1 km/h would refuse
        // everything PRACTICE exists to run.
        else if (f.unit === 'km/h') target = practiceSpeed();
        else if (f.unit === '%') target = 14;
        else if (f.unit === '°KW') target = 12;
        else target = 1;

        const raw = Math.round((target - f.add) / (f.scale || 1));
        writeRaw(buf, f.offset, f.format, raw);
    }
    return buf;
}

function writeRaw(buf: Uint8Array, offset: number, format: string, raw: number): void {
    const clamp = (v: number, hi: number) => Math.max(0, Math.min(hi, v));
    // The signed formats (as ds2-core's readRaw sign-extends them) in two's complement, so a learned
    // offset or a rough cylinder below zero reads back below zero instead of as 0.
    const signed = (v: number, bits: number) => Math.max(-(2 ** (bits - 1)), Math.min(2 ** (bits - 1) - 1, v)) & (2 ** bits - 1);
    switch (format) {
        case 'int7':
            if (offset < buf.length) buf[offset] = signed(raw, 8);
            break;
        case 'uint8':
            if (offset < buf.length) buf[offset] = clamp(raw, 0xff);
            break;
        case 'uint10':
        case 'uint16':
        case 'int15': {
            const v = format === 'int15' ? signed(raw, 16) : clamp(raw, 0xffff);
            if (offset + 1 < buf.length) {
                buf[offset] = (v >> 8) & 0xff;
                buf[offset + 1] = v & 0xff;
            }
            break;
        }
        default: {
            const v = raw >>> 0;
            if (offset + 3 < buf.length) {
                buf[offset] = (v >>> 24) & 0xff;
                buf[offset + 1] = (v >>> 16) & 0xff;
                buf[offset + 2] = (v >>> 8) & 0xff;
                buf[offset + 3] = v & 0xff;
            }
        }
    }
}

/** The practice car's stored faults — two by default, so the fault view and its freeze frames have
 *  something real to render. */
function faultPayload(): Uint8Array {
    const record = (code: number, type: number, freq: number) => {
        const r = new Array(ERROR_MEMORY_RECORD_LENGTH).fill(0);
        r[0] = code;
        r[1] = type;
        r[2] = freq;
        r[3] = 1;
        // Three freeze frames with distinguishable conditions.
        for (let set = 0; set < 3; set++) {
            const o = 4 + set * 6;
            r[o] = 0x20 + set;
            r[o + 1] = 0x40 + set;
            r[o + 2] = 0x60 + set;
            r[o + 3] = 0x80 + set;
            r[o + 4] = 0x00;
            r[o + 5] = 10 * (set + 1);
        }
        return r;
    };
    const faults = practiceCar.dmeFaults;
    return new Uint8Array([faults.length, ...faults.flatMap((f) => record(f.code, f.type, f.frequency))]);
}

/**
 * How many status polls the simulated test program runs for.
 *
 * The real ones take between ten seconds and sixteen minutes. This is not
 * pretending to be that: it is long enough that the wizard's live view, its
 * elapsed counter and its ABORT all actually execute, and short enough that
 * someone exercising the app is not sitting through a gearbox adaptation.
 */
const SIM_TESTPRG_POLLS = 6;

/**
 * PRACTICE as a K-line: the simulated ECU at the DME's address, and one at each other address
 * the session will talk to — and nobody anywhere else.
 *
 * Every module other than the DME answers its identity and its fault read from the practice car
 * (practiceCar.ts) and everything else with the DME's synthetic responder. That is a shortcut about
 * the PAYLOADS, which are invented whichever module answers; it is not a shortcut about the
 * ADDRESSES. A frame for a module that is not on this bus gets the echo and then silence, as it
 * would on a car, so a request sent to the wrong module fails in PRACTICE too instead of being
 * answered by the DME.
 */
export function practiceBus(addresses: readonly number[]): SimulatedEcuOptions[] {
    const unique = [...new Set([0x12, ...addresses])];
    return unique.map((address) => ({ ...(address === 0x12 ? practiceEcu() : practiceModule(address)), script: lineScript() }));
}

/**
 * The practice car's line, as the simulated module's script: while `practiceCar.lineDown` it is an
 * endless run of `dead` (no echo, no answer), otherwise empty, so the module answers as it always
 * does. A script is read live by the simulator, one entry per exchange, which is what lets a
 * scenario pull the cable in the middle of a run and plug it back.
 */
function lineScript(): ExchangeBehavior[] {
    const dead: ExchangeBehavior = { kind: 'dead' };
    return new Proxy([] as ExchangeBehavior[], {
        get(target, key, receiver) {
            if (key === 'length') return practiceCar.lineDown ? Number.MAX_SAFE_INTEGER : 0;
            if (typeof key === 'string' && /^\d+$/.test(key)) return dead;
            return Reflect.get(target, key, receiver);
        },
    });
}

/** The length of a PRACTICE module's status or calibration answer. */
export const PRACTICE_MODULE_BLOCK = 128;

/** A module other than the DME: its fault memory from the practice car, the rest the DME's responder. */
function practiceModule(address: number): SimulatedEcuOptions {
    const dme = practiceEcu();
    return {
        address,
        respond: (request) => {
            if (request.controlOrStatus === 0x00) return { payload: new Uint8Array(ds2IdentData(practiceCar.idents[address] ?? { hw: '00', diag: '00' })) };
            if (request.controlOrStatus === Ds2Control.READ_ERROR_MEMORY) {
                return { payload: new Uint8Array(practiceCar.moduleFaults[address] ?? cleanAnswer(address)) };
            }
            // The instrument cluster's VIN read (AIF block 2), answered as the SGBD reads it; refused without one.
            if (address === 0x80 && request.controlOrStatus === 0x02 && request.payload.length === 1 && request.payload[0] === 0x02) {
                practiceCar.clusterVinReads++;
                return practiceCar.clusterVin ? { payload: new Uint8Array(clusterVinAnswer(practiceCar.clusterVin)) } : { status: Ds2Status.REJECTED };
            }
            // The clear empties this module's memory, as a car's does.
            if (request.controlOrStatus === Ds2Control.CLEAR_ERROR_MEMORY) {
                delete practiceCar.moduleFaults[address];
                return { payload: new Uint8Array(0) };
            }
            // A status block (0x0B), or SMG II's calibration and learned values (0x40), of another
            // module is not one of the DME's blocks. The answer is zeros, long enough for the
            // longest of SMG II's reads to reach its end (123 bytes: STATUS_FAHRZEUGTESTER_LESEN;
            // lib/sgbd/vm.test.ts): its SGBD code reads every value from them, and every value
            // reads as the zero of its own scale, which nobody can take for a car's. Before,
            // SMG II's STATUS_IO_LESEN (selection 3) came back as the DME's block 3, and a
            // selection the DME has no block for (SMG II's 5) was refused.
            // SMG II's learned values (ADAPTIONSWERTE_LESEN, `40 <group>`), as the practice car holds them.
            if (address === 0x32 && request.controlOrStatus === 0x40 && request.payload.length === 1) {
                return { payload: practiceSmg2AdaptAnswer(request.payload[0], PRACTICE_MODULE_BLOCK) };
            }
            // ADAPTIONSWERTE_LOESCHEN (`43 <n>`): the clutch back to its defaults, or the gearbox data to zero.
            if (address === 0x32 && request.controlOrStatus === 0x43 && request.payload.length === 1) {
                clearPracticeSmg2Adaptations(request.payload[0]);
                return practiceAnswerFor(address, request.controlOrStatus, request.payload) ?? { payload: new Uint8Array(0) };
            }
            if (request.controlOrStatus === Ds2Control.READ_IO_STATUS || request.controlOrStatus === 0x40) {
                const out = new Uint8Array(PRACTICE_MODULE_BLOCK);
                // SMG II's STATUS_IO_LESEN, as the scenario set it (practiceCar `smg2Status`).
                const st = practiceCar.smg2Status;
                if (address === 0x32 && request.controlOrStatus === Ds2Control.READ_IO_STATUS && request.payload[0] === 0x03 && st) {
                    if (typeof st.phydBar === 'number') out.set(smg2PhydBytes(st.phydBar), 50);
                    for (const [k, v] of Object.entries(st.bytes ?? {})) if (Number(k) < out.length) out[Number(k)] = v & 0xff;
                }
                return { payload: out };
            }
            return dme.respond!(request);
        },
    };
}

export function practiceEcu(): SimulatedEcuOptions {
    // The simulated test program's own state. It lives in this closure because
    // the protocol says it should: TESTPRG_STOP resets a run and TESTPRG_STARTEN
    // advances it, so a counter reset by 0x33 and stepped by 0x32 IS the ECU's
    // rule rather than a mock's convenience.
    let testprgPolls = 0;

    return {
        address: 0x12,
        respond: (request) => {
            const arg = request.payload[0];
            switch (request.controlOrStatus) {
                case 0x00: // IDENT
                    // Laid out as the group files read a DS2 IDENT answer (practiceCar
                    // `ds2IdentData`), so the practice car is identified the way a car is:
                    // an M3's MSS54 by default, another DME when a scenario says so.
                    return { payload: new Uint8Array(ds2IdentData(practiceCar.idents[0x12] ?? { hw: '00', diag: '00' })) };

                case Ds2Control.CLEAR_ERROR_MEMORY:
                    // The clear empties the DME's memory; the next read finds none.
                    practiceCar.dmeFaults = [];
                    if (practiceCar.nonM3DmeFaults) practiceCar.nonM3DmeFaults = [];
                    if (practiceCar.ms43Faults) practiceCar.ms43Faults = [];
                    return { payload: new Uint8Array(0) };

                case Ds2Control.READ_ERROR_MEMORY: {
                    // A non-M3 car's DME (MS43, BMS46), in the layout its own SGBD reads (practiceCar
                    // `nonM3DmeFaults`): the record shape of the DME its IDENT selects.
                    const fs = practiceCar.nonM3DmeFaults ?? practiceCar.ms43Faults;
                    const shape = fs ? PRACTICE_DME_RECORDS[practiceDmeOf(practiceCar.idents[0x12]) ?? ''] : undefined;
                    if (fs && shape) {
                        if (arg === 0x00) return { payload: new Uint8Array([fs.length]) };
                        const out = [0x00];
                        for (const f of fs) {
                            const rec = new Array<number>(shape.length).fill(0);
                            rec[shape.code] = f.code;
                            if (f.present) rec[shape.present.at] |= shape.present.mask;
                            rec[shape.frequency] = f.count;
                            out.push(...rec);
                        }
                        return { payload: new Uint8Array(out) };
                    }
                    return arg === 0x00
                        ? { payload: new Uint8Array([0x02, 0x00, 0x02, 0x00, 0x00]) } // quicktest
                        : { payload: faultPayload() };
                }

                case Ds2Control.READ_IO_STATUS: {
                    const dme = practiceDmeOf(practiceCar.idents[0x12]);
                    if (dme) {
                        // These practice RPM bytes are decoded by each variant's STATUS_MOTORDREHZAHL.
                        // Other blocks need their own fixture; an MSS54 reply would give a false reading.
                        if (arg !== 3) return { status: Ds2Status.PARAMETER_ERROR };
                        const payload = new Uint8Array(32);
                        const rpm = engine().rpm;
                        if (dme === 'bms43ds0') payload[0] = Math.round(rpm / 40);
                        else new DataView(payload.buffer).setUint16(0, Math.round(dme.startsWith('bms46') ? rpm / 0.15625 : rpm));
                        return { payload };
                    }
                    const ident = practiceCar.idents[0x12];
                    if (!ident || !('hw' in ident) || ident.hw.toUpperCase() !== '1B') return { status: Ds2Status.PARAMETER_ERROR };
                    const block = blockBySelection(arg);
                    if (block) return { payload: blockPayload(block) };

                    // Control 0x0B also reads the ADAPTATION blocks — selections
                    // 6, 22, 38 and 131. Only the live blocks were handled, so
                    // "read adaptations" reported all four refused, and
                    // STATUS_ADAPTIONSBLOCK_26 (selection 38) — one of the three
                    // jobs the run gate permits — could not be exercised without
                    // a car. A simulator that refuses what the app is allowed to
                    // ask for teaches nothing.
                    //
                    // Length only: these payloads are zeros, so every decoded
                    // adaptation reads as its own zero point rather than as an
                    // invented "typical" value. A learned value is exactly the
                    // kind of number nobody should be able to mistake for real.
                    //
                    // A value a scenario set (practiceCar `mss54Adapt`, or the misfires its symptoms
                    // imply) goes through the field's own scale; the rest stay zero.
                    const adaptation = MSS54_ADAPTATION_BLOCKS.find((b) => b.selection === arg);
                    if (adaptation) {
                        const buf = new Uint8Array(adaptationBlockMinLength(adaptation));
                        for (const f of adaptation.fields) {
                            const value = practiceAdaptation(f.symbol);
                            if (value !== null) writeRaw(buf, f.offset, f.format, Math.round((value - f.add) / (f.scale || 1)));
                        }
                        return { payload: buf };
                    }
                    // A selection EdiabasLib was run with (a VANOS test reads block 5 first): as its simulation answered.
                    return practiceAnswerFor(request.address, request.controlOrStatus, request.payload) ?? { status: Ds2Status.PARAMETER_ERROR };
                }

                // --- The reads the run gate can emit ---------------------
                //
                // These three were missing, and their absence made the whole run
                // surface undemonstrable: of the five jobs `mayRun` permits,
                // three carry these control bytes, so PRACTICE refused them and
                // the feature could not be exercised without a car. A simulator
                // that refuses exactly what the app is allowed to send is not
                // being careful, it is being useless.
                //
                // The PAYLOADS are synthetic and shaped, not decoded from
                // anything — the app shows this response as raw bytes and says
                // it cannot decode it, so there is no layout here to get wrong.
                case 0x53: // manufacturer data
                    return { payload: new Uint8Array([
                        0x07, 0x53, 0x30, 0x30, 0x31, 0x02, 0x11, 0x20,
                        0x03, 0x01, 0x00, 0x00, 0x12, 0x34, 0x56,
                    ]) };

                case Ds2Control.QUERY_ENCODING_CHECKSUM: // 0x0a
                    return { payload: new Uint8Array([0x5a, 0xa5]) };

                case Ds2Control.READ_MEMORY: {
                    // Length is the last argument byte in the DS2 read-memory
                    // request. Answer with that many bytes so a caller that
                    // checks the length gets a truthful one.
                    const want = request.payload[request.payload.length - 1] || 1;
                    return { payload: new Uint8Array(Math.min(want, 64)).fill(0xa5) };
                }

                // --- the actuator control byte -------------------------
                //
                // PRACTICE exists so the send path, the argument builder, the
                // arming state machine and STOP all execute before an M3 is the
                // first thing they execute against. That needs 0x0c to answer.
                //
                // **A BARE ACK, and nothing else.** A real ECU's reply to
                // SET_IO_STATUS carries a layout this repo has never decoded, so
                // any payload invented here would be a shape the app then learns
                // to parse — and the first real car would be where that parser
                // discovers it was reading fiction. Answering "acknowledged" is
                // the whole of what we actually know.
                // --- the SMG II test program ---------------------------
                //
                // 0x33 first, always: "Muss VOR TESTPRG_STARTEN geschickt
                // werden!"  Here that is what resets the run, which is the
                // ECU's own rule rather than a convenience of this mock.
                case 0x33: // TESTPRG_STOP
                    testprgPolls = 0;
                    return null; // bare ACK — the SGBD declares no payload

                // 0x32 answers with the status the wizard reads back. TWO bytes
                // and no more:
                //
                //   [0] TEST_STATUS_BYTE — 1 running, 2 finished
                //   [1] INFO_STATUS_BYTE — 0x00, which every procedure's own
                //       activity table calls "initialization"
                //
                // The infobyte is a real code out of the shipped vocabulary, not
                // an invented one, and it stays 0x00 because this simulator does
                // not initialize anything and must not claim to. Infobyte 2 is
                // omitted entirely rather than sent as zero: on procedure 0x04 it
                // carries a pre-charge pressure, and a fabricated 0 bar would be
                // a measurement this app has no business producing.
                //
                // **The byte POSITIONS are the app's own inference** from the
                // SGBD's "Byte 5 (Lastenheft)" wording — see procedureRun.ts. So
                // this simulator confirms the decoder's reading of a document and
                // nothing more; a real gearbox is what settles it. The wizard
                // prints the raw bytes beside the decode for exactly that reason.
                case 0x32: // TESTPRG_STARTEN
                    testprgPolls++;
                    // The poll that finds the program finished is when SMG II has learnt what it teaches.
                    if (request.address === 0x32 && testprgPolls === SIM_TESTPRG_POLLS) finishPracticeSmg2Program(arg);
                    return {
                        payload: new Uint8Array([testprgPolls >= SIM_TESTPRG_POLLS ? 0x02 : 0x01, 0x00]),
                    };

                // ADAPT_LOESCHEN (`43 FF 00`, and ADAPT_SELEKTIV_LOESCHEN with every bit set, which is the
                // same frame): the learned values go back to zero, and a symptom a learned value caused
                // goes with them. Another selection's bits name groups this app has no table for, so
                // nothing is cleared, rather than guessing which; the answer is EdiabasLib's either way.
                case 0x43:
                    if (arg === 0xff && request.payload[1] === 0x00) clearPracticeAdaptations();
                    return practiceAnswerFor(request.address, request.controlOrStatus, request.payload) ?? { payload: new Uint8Array(0) };

                case Ds2Control.SET_IO_STATUS:
                case Ds2Control.KEEP_ALIVE:
                case Ds2Control.END_DIAGNOSTIC_MODE:
                    return null; // bare ACK

                // Two reads the gate has always been willing to send and that
                // the simulator could not answer, because the extractor was
                // dropping their frames and so nothing ever asked. They are in
                // `READ_ONLY_CONTROLS`; ten jobs across seven modules use them.
                //
                // A BARE ACK for the same reason as 0x0c: the shadow fault
                // memory's record layout is not the fault memory's — it is a
                // DIFFERENT store, and assuming they share a shape is precisely
                // the invention the note above refuses. Answering
                // "acknowledged" says the ECU replied and claims nothing about
                // what it replied with.
                case Ds2Control.READ_SHADOW_ERROR_MEMORY: // 0x14
                case Ds2Control.READ_SYSTEM_ADDRESSES: // 0x0d
                    return null; // bare ACK

                default: {
                    // A frame EdiabasLib was run with (job-frames.oracle.json) gets the answer its
                    // simulation gave — a bare positive one — so every job the owner's table opens
                    // runs in PRACTICE before a car (operator, 2026-11-18). Nothing more is invented.
                    const known = practiceAnswerFor(request.address, request.controlOrStatus, request.payload);
                    if (known) return known;
                    // An unimplemented job is REFUSED, not quietly acknowledged.
                    // A mock that says OKAY to everything is why the tuner's
                    // failure path had never once executed. What changed above is
                    // only that the commands the app IS allowed to send are now
                    // implemented; everything else still gets refused.
                    return { status: Ds2Status.REJECTED };
                }
            }
        },
    };
}

/**
 * What EdiabasLib's simulation answered each frame it was run with (sgbd/agreedFrame's oracle):
 * frame (checksum included, lowercase hex) → answer frame. Set at a PRACTICE connect.
 */
let simulated: ReadonlyMap<string, Uint8Array> = new Map();

/** Hands PRACTICE the frames EdiabasLib was run with and what it was answered. */
export function setPracticeAnswers(oracle: JobFramesOracle | null): void {
    const map = new Map<string, Uint8Array>();
    for (const entry of Object.values(oracle?.jobs ?? {})) {
        for (const c of entry.cases) {
            c.sends.forEach((send, i) => {
                const a = c.answers?.[i];
                if (a) map.set(send, Uint8Array.from(a.split(' '), (h) => parseInt(h, 16)));
            });
        }
    }
    simulated = map;
}

const hexOf = (b: ArrayLike<number>) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join(' ');

/** PRACTICE's answer to a DS2 frame EdiabasLib was run with: its status and data, as the simulation answered. */
function practiceAnswerFor(address: number, control: number, payload: Uint8Array): { status?: number; payload?: Uint8Array } | null {
    const body = [address, payload.length + 4, control, ...payload];
    const answer = simulated.get(hexOf([...body, xorOf(body)]));
    if (!answer || answer.length < 4) return null;
    const status = answer[2];
    return status === 0xa0 ? { payload: answer.slice(3, answer.length - 1) } : { status };
}

/** The DSC MK60's KWP target, behind wire address 0xB8 (lib/kwpOnDs2). */
const MK60_TARGET = 0x29;

/**
 * PRACTICE's answer to a KWP-on-DS2 frame for the DSC MK60, or null when the frame is not one (it then
 * goes to the DS2 bus). Its echo, then `B8 F1 29 LL <SID+0x40> …`, as ISO 14230 lays answers out —
 * the shape the app reads the real one as, and has not yet seen.
 */
export function practiceKwpAnswer(chunk: Uint8Array): Uint8Array[] | null {
    if (chunk.length < 6 || chunk[0] !== KWP_FORMAT || chunk[3] !== chunk.length - 5 || xorOf(chunk.subarray(0, chunk.length - 1)) !== chunk[chunk.length - 1]) return null;
    if (practiceCar.lineDown) return [];
    const echo = Uint8Array.from(chunk);
    if (chunk[1] !== MK60_TARGET || chunk[2] !== KWP_TESTER || !practiceCar.dscMk60) return [echo];
    const sid = chunk[4];
    let data: number[];
    if (sid === 0x1a) data = [0x5a, chunk[5], 0x34, 0x51, 0x12, 0x07];
    else if (sid === 0x18) data = [0x58, practiceCar.dscMk60.length, ...practiceCar.dscMk60.flatMap((d) => [d.code >> 8, d.code & 0xff, d.status])];
    else if (sid === 0x14) {
        // ClearDiagnosticInformation (its own FS_LOESCHEN): the memory empties, as a car's does, and
        // the answer is EdiabasLib's simulation where it ran this frame, else ISO 14230's `54` and the group.
        practiceCar.dscMk60 = [];
        const known = simulated.get(hexOf(chunk));
        if (known) return [echo, known];
        data = [0x54, ...chunk.subarray(5, chunk.length - 1)];
    } else {
        // A frame EdiabasLib was run with: its simulation's answer. Anything else: not supported.
        const known = simulated.get(hexOf(chunk));
        if (known) return [echo, known];
        data = [0x7f, sid, 0x11];
    }
    const head = [KWP_FORMAT, KWP_TESTER, MK60_TARGET, data.length, ...data];
    return [echo, Uint8Array.from([...head, xorOf(head)])];
}

/**
 * PRACTICE's port: the simulated DS2 bus (practiceBus), with the DSC MK60's KWP-on-DS2 frames answered
 * in front of it — the DS2 simulator reads a frame's length from its second byte, so it cannot.
 */
export class PracticePort implements SerialPortLike {
    private readonly inner: SimulatedSerialPort;
    private controller: ReadableStreamDefaultController<Uint8Array> | null = null;
    private _readable: ReadableStream<Uint8Array> | null = null;
    private _writable: WritableStream<Uint8Array> | null = null;

    constructor(addresses: readonly number[]) {
        this.inner = new SimulatedSerialPort(practiceBus(addresses));
    }
    get readable() {
        return this._readable;
    }
    get writable() {
        return this._writable;
    }

    async open(options: SerialOptions): Promise<void> {
        await this.inner.open(options);
        this._readable = new ReadableStream<Uint8Array>({ start: (c) => void (this.controller = c) });
        const reader = this.inner.readable!.getReader();
        void (async () => {
            for (;;) {
                const { value, done } = await reader.read().catch(() => ({ value: undefined, done: true }));
                if (done) return;
                if (value) this.controller?.enqueue(value);
            }
        })();
        const writer = this.inner.writable!.getWriter();
        this._writable = new WritableStream<Uint8Array>({
            write: async (chunk) => {
                const kwp = isKwp(chunk);
                hear(chunk, kwp);
                const injected = practiceCar.lineDown ? undefined : takeInjection(chunk, kwp);
                if (injected?.kind === 'slow') await new Promise((r) => setTimeout(r, injected.delayMs ?? 300));
                else if (injected) {
                    for (const out of injectedAnswer(injected, chunk, kwp)) this.controller?.enqueue(out);
                    return;
                }
                const answer = practiceKwpAnswer(chunk);
                if (answer) for (const out of answer) this.controller?.enqueue(out);
                else await writer.write(chunk);
            },
        });
    }

    async close(): Promise<void> {
        await this.inner.close();
        try {
            this.controller?.close();
        } catch {
            /* already closed */
        }
        this.controller = null;
        this._readable = null;
        this._writable = null;
    }

    async setSignals(signals: Record<string, boolean | undefined>): Promise<void> {
        await this.inner.setSignals(signals);
    }
}

const isKwp = (chunk: Uint8Array) => chunk.length >= 6 && chunk[0] === KWP_FORMAT && chunk[3] === chunk.length - 5;
const hexBytes = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join(' ');

/** Keeps the frame the practice car heard (practiceCar.wire). */
function hear(chunk: Uint8Array, kwp: boolean): void {
    const wire = practiceCar.wire;
    wire.push({ at: Date.now(), to: kwp ? chunk[1] : chunk[0], hex: hexBytes(chunk) });
    if (wire.length > 20_000) wire.splice(0, wire.length - 20_000);
}

/** The first injection that matches this frame and is due, counted off; undefined when none. */
function takeInjection(chunk: Uint8Array, kwp: boolean): PracticeInjection | undefined {
    const to = kwp ? chunk[1] : chunk[0];
    const ctrl = kwp ? chunk[4] : chunk[2];
    const data = hexBytes(kwp ? chunk.subarray(5, chunk.length - 1) : chunk.subarray(3, chunk.length - 1));
    for (const inj of practiceCar.inject) {
        if (inj.to !== to || (inj.ctrl !== undefined && inj.ctrl !== ctrl)) continue;
        if (inj.data && !data.startsWith(inj.data.toLowerCase().replace(/\s+/g, ' ').trim())) continue;
        if ((inj.skip ?? 0) > 0) {
            inj.skip = (inj.skip ?? 0) - 1;
            continue;
        }
        if ((inj.times ?? 1) <= 0) continue;
        inj.times = (inj.times ?? 1) - 1;
        return inj;
    }
    return undefined;
}

/** What the module puts on the wire instead of its own answer: the echo, then the injected answer. */
function injectedAnswer(inj: PracticeInjection, chunk: Uint8Array, kwp: boolean): Uint8Array[] {
    const echo = Uint8Array.from(chunk);
    if (inj.kind === 'silent') return [echo];
    if (kwp) {
        const data = inj.kind === 'short' ? [chunk[4] + 0x40] : [0x7f, chunk[4], inj.kind === 'busy' ? 0x21 : 0x22];
        const head = [KWP_FORMAT, KWP_TESTER, chunk[1], data.length, ...data];
        return [echo, Uint8Array.from([...head, xorOf(head)])];
    }
    const status = inj.kind === 'negative' ? Ds2Status.REJECTED : inj.kind === 'busy' ? Ds2Status.BUSY : Ds2Status.ACKNOWLEDGE;
    const payload = inj.kind === 'short' ? [0x00] : [];
    const frame = [chunk[0], 4 + payload.length, status, ...payload];
    return [echo, Uint8Array.from([...frame, xorOf(frame)])];
}

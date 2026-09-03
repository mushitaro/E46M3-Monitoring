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
import type { SimulatedEcuOptions } from '@tsunagi/ds2-core';

const START = Date.now();

/** A plausible warming, idling S54. */
function engine() {
    const t = (Date.now() - START) / 1000;
    return {
        rpm: Math.round(820 + 15 * Math.sin(t * 1.3)),
        coolantC: Math.min(92, 22 + 70 * (1 - Math.exp(-t / 90))),
        oilC: Math.min(98, 22 + 76 * (1 - Math.exp(-t / 130))),
        battV: 13.9 + 0.12 * Math.sin(t / 2.5),
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

    for (const f of block.fields) {
        // Choose a raw value that decodes to something sane for this field.
        let target: number;
        if (f.symbol === 'n') target = e.rpm;
        else if (f.symbol === 'tmot') target = e.coolantC;
        else if (f.unit === 'V') target = f.symbol.startsWith('UUB') ? e.battV : 2.5;
        else if (f.unit === '°C') target = e.oilC;
        else if (f.unit === 'rpm') target = e.rpm;
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
    switch (format) {
        case 'uint8':
        case 'int7':
            if (offset < buf.length) buf[offset] = clamp(raw, 0xff);
            break;
        case 'uint10':
        case 'uint16':
        case 'int15': {
            const v = clamp(raw, 0xffff);
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

/** Two stored faults, so the fault view and its freeze frames have something real to render. */
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
    return new Uint8Array([0x02, ...record(0x2a, 0x08, 3), ...record(0xd1, 0x02, 1)]);
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
                    // Raw bytes only — the response layout is genuinely unknown,
                    // and inventing a decoded ZB/HW/SW here would teach the UI a
                    // shape the car may not use.
                    return { payload: new Uint8Array([0x77, 0x83, 0x73, 0x40, 0x04, 0x00]) };

                case Ds2Control.READ_ERROR_MEMORY:
                    return arg === 0x00
                        ? { payload: new Uint8Array([0x02, 0x00, 0x02, 0x00, 0x00]) } // quicktest
                        : { payload: faultPayload() };

                case Ds2Control.READ_IO_STATUS: {
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
                    const adaptation = MSS54_ADAPTATION_BLOCKS.find((b) => b.selection === arg);
                    if (adaptation) {
                        return { payload: new Uint8Array(adaptationBlockMinLength(adaptation)) };
                    }
                    return { status: Ds2Status.PARAMETER_ERROR };
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
                    return {
                        payload: new Uint8Array([testprgPolls >= SIM_TESTPRG_POLLS ? 0x02 : 0x01, 0x00]),
                    };

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

                default:
                    // An unimplemented job is REFUSED, not quietly acknowledged.
                    // A mock that says OKAY to everything is why the tuner's
                    // failure path had never once executed. What changed above is
                    // only that the commands the app IS allowed to send are now
                    // implemented; everything else still gets refused.
                    return { status: Ds2Status.REJECTED };
            }
        },
    };
}

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

export function practiceEcu(): SimulatedEcuOptions {
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
                    if (!block) return { status: Ds2Status.PARAMETER_ERROR };
                    return { payload: blockPayload(block) };
                }

                case Ds2Control.KEEP_ALIVE:
                case Ds2Control.END_DIAGNOSTIC_MODE:
                    return null; // bare ACK

                default:
                    // An unimplemented job is REFUSED, not quietly acknowledged.
                    // A mock that says OKAY to everything is why the tuner's
                    // failure path had never once executed.
                    return { status: Ds2Status.REJECTED };
            }
        },
    };
}

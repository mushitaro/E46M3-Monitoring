import { toHex, type Ds2ByteTransport } from '@tsunagi/ds2-core';
import { kwpExchange, kwpRequest } from '../kwpOnDs2.ts';
import type { SgbdResultsTable } from './results.ts';

const RPM_JOB = 'STATUS_MOTORDREHZAHL';
const TEMPERATURE_JOB = 'STATUS_MOTORTEMPERATUR';

export interface NativeEncoding {
    module: string;
    format: 'kwp-star' | 'bmw-fast';
    service: number[];
    offset: number;
    scale: number;
    unit: string;
    timeout: number;
}

export interface NativeMeasurement extends NativeEncoding {
    job: string;
    result: string;
    width: 1 | 2;
    bias: number;
}

const rpmServices = ['22 40 00', '2c 10 00 91', '2c 10 00 9e', '2c 10 00 2d', '2c 10 00 0c', '2c 10 0f 10'];
const temperatureServices = ['21 55', '22 40 00', '2c 10 0f 00', '2c 10 00 05'];

/** Only read jobs with an independently replayed service and result are available. */
export function validMeasurement(spec: NativeMeasurement, module: string, job: string): boolean {
    if (spec.job !== job || spec.module !== module || !Number.isFinite(spec.scale) || spec.scale <= 0 ||
        !Number.isFinite(spec.bias) || ![1, 2].includes(spec.width) ||
        !Number.isInteger(spec.timeout) || spec.timeout < 1 || spec.timeout > 5000 ||
        !Number.isInteger(spec.offset) || spec.offset < 0 || spec.offset > 64 || !spec.unit ||
        !Array.isArray(spec.service) || !spec.service.every(x => Number.isInteger(x) && x >= 0 && x <= 255)) return false;
    const service = toHex(Uint8Array.from(spec.service)).toLowerCase();
    if (job === TEMPERATURE_JOB) {
        return spec.result === 'STAT_MOTORTEMPERATUR_WERT' && spec.format === 'kwp-star' && temperatureServices.includes(service);
    }
    return job === RPM_JOB && spec.result === 'STAT_MOTORDREHZAHL_WERT' && spec.width === 2 && spec.bias === 0 &&
        (spec.format === 'kwp-star' || spec.format === 'bmw-fast') && rpmServices.includes(service);
}

export function nativeMeasurement(table: SgbdResultsTable | null | undefined, module: string, job: string): NativeMeasurement | null {
    if (table?.module !== module) return null;
    const spec = job === RPM_JOB && table.nativeRpm
        ? { ...table.nativeRpm, job, result: 'STAT_MOTORDREHZAHL_WERT', width: 2 as const, bias: 0 }
        : table.nativeMeasurements?.[job];
    return spec && validMeasurement(spec, module, job) ? spec : null;
}

export function measurementValue(spec: NativeMeasurement, data: Uint8Array): number | null {
    const prefix = spec.service[0] === 0x22 ? 3 : 2;
    const pos = prefix + spec.offset;
    if (data.length < pos + spec.width || data[0] !== spec.service[0] + 0x40 ||
        !spec.service.slice(1, prefix).every((b, i) => data[i + 1] === b)) return null;
    const raw = spec.width === 1 ? data[pos] : data[pos] * 256 + data[pos + 1];
    return raw * spec.scale + spec.bias;
}

export function fastFrame(target: number, from: number, data: number[]): Uint8Array {
    const head = [0x80 + data.length, target, from, ...data];
    return Uint8Array.from([...head, head.reduce((sum,b) => sum+b,0) & 255]);
}

/** Caller owns the connection gate and has identified the exact module before every read. */
export async function exchangeMeasurement(transport: Ds2ByteTransport, spec: NativeMeasurement, practice: boolean) {
    const data = Uint8Array.from(spec.service);
    if (spec.format === 'kwp-star') {
        const request = kwpRequest(0x12, data);
        const reply = await kwpExchange(transport, {target: 0x12, data, hex: toHex(request), source: spec.job}, spec.timeout);
        return { request: toHex(request), response: toHex(reply.bytes), value: measurementValue(spec, reply.data) };
    }
    if (!practice) throw new Error('このECUにはBMW-FAST対応の接続が必要です。');
    const request = fastFrame(0x12,0xf1,spec.service);
    transport.purge();
    await transport.write(request);
    const echo = await transport.readExact(request.length,spec.timeout);
    if (toHex(echo) !== toHex(request)) throw new Error('BMW-FAST echo mismatch');
    const head = await transport.readExact(3,spec.timeout);
    if ((head[0]&0xc0)!==0x80 || head[1]!==0xf1 || head[2]!==0x12 || !(head[0]&63)) throw new Error('Unexpected BMW-FAST response header');
    const tail = await transport.readExact((head[0]&63)+1,spec.timeout);
    const payload = tail.subarray(0,-1);
    const expected = fastFrame(0xf1,0x12,[...payload]);
    if (expected.at(-1)!==tail.at(-1)) throw new Error('BMW-FAST checksum mismatch');
    return {request: toHex(request), response: toHex(expected), value: measurementValue(spec,payload)};
}

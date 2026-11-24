import { toHex, type Ds2ByteTransport } from '@tsunagi/ds2-core';
import { kwpExchange, kwpRequest } from '../kwpOnDs2.ts';

export const RPM_JOB = 'STATUS_MOTORDREHZAHL';
export const RPM_RESULT = 'STAT_MOTORDREHZAHL_WERT';

/** Private per-program measurement contract, derived from the original interpreter. */
export interface NativeRpm {
    module: string;
    format: 'kwp-star' | 'bmw-fast';
    service: number[];
    offset: number;
    scale: number;
    unit: string;
    timeout: number;
}

export function validRpm(spec: NativeRpm | undefined, module: string): spec is NativeRpm {
    if (!spec || spec.module !== module || !Number.isFinite(spec.scale) || spec.scale <= 0 ||
        !Number.isInteger(spec.timeout) || spec.timeout < 1 || spec.timeout > 5000 ||
        !Number.isInteger(spec.offset) || spec.offset < 0 || spec.offset > 64 || !spec.unit ||
        !Array.isArray(spec.service) || !spec.service.every(x => Number.isInteger(x) && x >= 0 && x <= 255)) return false;
    const [sid, local] = spec.service;
    return (spec.format === 'kwp-star' || spec.format === 'bmw-fast') &&
        ((sid === 0x22 && spec.service.length === 3 && local === 0x40 && spec.service[2] === 0) || (sid === 0x2c && local === 0x10 && spec.service.length === 4 &&
            ((spec.service[2] === 0 && [0x91, 0x9e, 0x2d, 0x0c].includes(spec.service[3])) || (spec.service[2] === 0x0f && spec.service[3] === 0x10))));
}

export function rpmValue(spec: NativeRpm, data: Uint8Array): number | null {
    const prefix = spec.service[0] === 0x22 ? 3 : 2;
    const pos = prefix + spec.offset;
    if (data.length < pos + 2 || data[0] !== spec.service[0] + 0x40 ||
        !spec.service.slice(1, prefix).every((b,i) => data[i+1] === b)) return null;
    return (data[pos] * 256 + data[pos + 1]) * spec.scale;
}

export function fastFrame(target: number, from: number, data: number[]): Uint8Array {
    const head = [0x80 + data.length, target, from, ...data];
    return Uint8Array.from([...head, head.reduce((sum,b) => sum+b,0) & 255]);
}

/** Caller owns the connection gate and has identified the exact module before every read. */
export async function exchangeRpm(transport: Ds2ByteTransport, spec: NativeRpm, practice: boolean) {
    const data = Uint8Array.from(spec.service);
    if (spec.format === 'kwp-star') {
        const request = kwpRequest(0x12, data);
        const reply = await kwpExchange(transport, {target: 0x12, data, hex: toHex(request), source: RPM_JOB}, spec.timeout);
        return { request: toHex(request), response: toHex(reply.bytes), value: rpmValue(spec, reply.data) };
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
    return {request: toHex(request), response: toHex(expected), value: rpmValue(spec,payload)};
}

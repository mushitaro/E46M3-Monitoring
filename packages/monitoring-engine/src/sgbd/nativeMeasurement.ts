import { toHex, type Ds2ByteTransport } from '@tsunagi/ds2-core';
import { kwpExchange, kwpRequest } from '../kwpOnDs2.ts';
import type { SgbdResultsTable } from './results.ts';

const RPM_JOB = 'STATUS_MOTORDREHZAHL';

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
    signed?: boolean;
}

// Digests of the descriptors verified by independent interpreter replay. The descriptors themselves
// are read through the owner's ECU data door. Bind both the request and the complete decoding rule.
const reviewed = new Set([
    '0240b3061cd3dc99b6b7ceef2ff2067c0b4058f0dda9e72d509750a025bcb3f3',
    '055c7e33271a5d0d0f9c8f9b12fa94487b3a8194eb0ece3a243bb349a176544a',
    '0a3acce687b87b1e30076efc85472056271bcbda484a0aa68a1a051f6b4e70fc',
    '1b7d9ef3611638da1f1887839caef7db654c116ad549e78c7fa35a4d42583c7c',
    '224653faf3bc23f79bb46759975d13848866bb42442c166cf3c1c996943cee95',
    '27618d3bf966a88649aaf85ed7b1b52a1a99b7b08c3842a6db6d2c580f72834d',
    '2e5857fffd2fed0b46e3df9825953565f25d6e65c17fe3a6c4ca53df3f1ea41e',
    '2f0c059f6d879df7e9a0d0005dd297cc6a9ede692a436609a88189dc6e243fa0',
    '3091326146e81d30ab3c547dfe4bd2664fb2dde2b16c8ab3456f53b892e2be56',
    '356a316a87b8331efbd84f745fcc8aa9778698ee6958fc137df0d3c4827fa70a',
    '42de9a3469fd7468072f3a7d0bb38ebddab505cbbe61e39992f21d3ed3060807',
    '4f67f78287ce92014b015e2fcbbf1f30bc58d62cf52882f8de1f89a48e4d1560',
    '5ad33b992ac02c7041ddcf5fc3f7d7fe7a165a2d7a4880f4cd1a9b83fcb34db8',
    '62a96f7c37088eedd47efed2294e854ebb94622ce74285d583f7bfcc51926f34',
    '6c210d7ee59e07b4ba80b54a9bd4aaa0ad8520ccf45fdabf17d488a29ec761e6',
    '707db77f00e710a75eb723fcf9a555ba86c25470e03f066e3e1190f82e319ffa',
    '7259b4513045589e7e7c8b98f685d23a815251e438f345bd7de9a89b253844d2',
    '750cabbb8f4922cb22ba35c43f0ed6c000207fd117671ebc30ccdea429e36a7e',
    '81b95ae4f48ecc2afb0b91c964eb2346510801263e1c2daa63c791816d9cbcd7',
    '8eb7f606f71d72aefd30968f0dd0d9d6c89f21f23b4be5dc3efc8cae06d2d334',
    '8efe6d925085d46b413dad0523100acf03d4f40c33aa11efd88030ad5227df18',
    '91074bcd5310fb477d4241f311f1ec6a531fea3401822608abcdb3b4eca36060',
    '972aa007e424daf62c12f61a6472da3dddc31951502732acfa79ee82da0cbed5',
    '9e34e611d098d1ff7a24cfd1c4ae8e03f5d49014d647a34588d174e55e879f26',
    '9e617731b72e8bc620c0a01af130d7b7f0cccb3e42e3783d71b5f17f87f6fa00',
    'a2f8b176ca7da62db247e2f5a019207cea3f86df1b72aeb60bcae81c147a3451',
    'a6e56b4c3cdc10aaa7f29f0574ba13d9475c13054095aa61bc1da6141897f41d',
    'b86c537c1196037c4ea2969fed4e91dc12af9f8400df1bb24081ef4fd9ca4278',
    'be3f31d58ca7b0dbafc532df9139f465eead5448b5b43c82fc6aea6c1aa4091f',
    'c297031e5cff96ab94da0e89e53bf524227b3a8c3b86b960f08a584e9a65e0f6',
    'e3662d1b367aa55d2da862e99bea84bfcdf5f2d4067b9c15bfdee5260ba86ba8',
    'f463ea315b671ffcf239ffebe60d7c3fc7e7b922e9daebddf0037f848a1def48',
    'f88850acb2bb8c1ba6e8da593d34fbc2c9b57a6c83ec9d792e5267ee5a30bfd1',
]);
const approved = new WeakSet<NativeMeasurement>();
const byTable = new WeakMap<SgbdResultsTable, Map<string, NativeMeasurement>>();

/** Check each descriptor once when the private table arrives, before it can enter a recording plan. */
export async function verifyMeasurements(table: SgbdResultsTable): Promise<void> {
    const definitions = { ...table.nativeMeasurements };
    if (table.nativeRpm) definitions[RPM_JOB] = { ...table.nativeRpm, job: RPM_JOB, result: 'STAT_MOTORDREHZAHL_WERT', width: 2, bias: 0 };
    const entries = new Map<string, NativeMeasurement>();
    for (const [job, source] of Object.entries(definitions)) {
        if (source?.module !== table.module || source.job !== job || !Array.isArray(source.service)) continue;
        const spec = { ...source, service: [...source.service] };
        const descriptor = [spec.module, job, spec.result, spec.format, spec.service, spec.offset, spec.scale,
            spec.unit, spec.timeout, spec.width, spec.bias, spec.signed ?? false];
        const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(descriptor)));
        const hash = Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
        if (!reviewed.has(hash)) continue;
        Object.freeze(spec.service);
        approved.add(Object.freeze(spec));
        entries.set(job, spec);
    }
    byTable.set(table, entries);
}

export function validMeasurement(spec: NativeMeasurement, module: string, job: string): boolean {
    return approved.has(spec) && spec.module === module && spec.job === job;
}

export function nativeMeasurement(table: SgbdResultsTable | null | undefined, module: string, job: string): NativeMeasurement | null {
    return table?.module === module ? byTable.get(table)?.get(job) ?? null : null;
}

export function measurementValue(spec: NativeMeasurement, data: Uint8Array): number | null {
    const prefix = spec.service[0] === 0x22 ? 3 : 2;
    const pos = prefix + spec.offset;
    if (data.length < pos + spec.width || data[0] !== spec.service[0] + 0x40 ||
        !spec.service.slice(1, prefix).every((b, i) => data[i + 1] === b)) return null;
    const unsigned = spec.width === 1 ? data[pos] : data[pos] * 256 + data[pos + 1];
    const raw = spec.signed && (data[pos] & 0x80) !== 0 ? unsigned - 2 ** (spec.width * 8) : unsigned;
    return raw * spec.scale + spec.bias;
}

export function fastFrame(target: number, from: number, data: number[]): Uint8Array {
    const head = [0x80 + data.length, target, from, ...data];
    return Uint8Array.from([...head, head.reduce((sum,b) => sum+b,0) & 255]);
}

/** Caller owns the connection gate and has identified the exact module before every read. */
export async function exchangeMeasurement(transport: Ds2ByteTransport, address: number, spec: NativeMeasurement, practice: boolean) {
    const data = Uint8Array.from(spec.service);
    if (spec.format === 'kwp-star') {
        const request = kwpRequest(address, data);
        const reply = await kwpExchange(transport, {target: address, data, hex: toHex(request), source: spec.job}, spec.timeout);
        return { request: toHex(request), response: toHex(reply.bytes), value: measurementValue(spec, reply.data) };
    }
    if (!practice) throw new Error('このECUにはBMW-FAST対応の接続が必要です。');
    const request = fastFrame(address,0xf1,spec.service);
    transport.purge();
    await transport.write(request);
    const echo = await transport.readExact(request.length,spec.timeout);
    if (toHex(echo) !== toHex(request)) throw new Error('BMW-FAST echo mismatch');
    const head = await transport.readExact(3,spec.timeout);
    if ((head[0]&0xc0)!==0x80 || head[1]!==0xf1 || head[2]!==address || !(head[0]&63)) throw new Error('Unexpected BMW-FAST response header');
    const tail = await transport.readExact((head[0]&63)+1,spec.timeout);
    const payload = tail.subarray(0,-1);
    const expected = fastFrame(0xf1,address,[...payload]);
    if (expected.at(-1)!==tail.at(-1)) throw new Error('BMW-FAST checksum mismatch');
    return {request: toHex(request), response: toHex(expected), value: measurementValue(spec,payload)};
}

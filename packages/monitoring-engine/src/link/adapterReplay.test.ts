import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { type SerialOptions } from '@tsunagi/ds2-core';
import { configureEcuData, fetchEcuDataFromPage } from '../ecuData.ts';
import type { EcuIndex } from '../ecuCatalog.ts';
import { moduleProtocol } from '../moduleProtocol.ts';
import { loadProbeModules } from '../probe/modules.ts';
import { moduleChannels, moduleLogData, moduleLogReads } from '../sgbd/logChannels.ts';
import { EMPTY_LEDGER } from '../ledger.ts';
import type { TelegramTable } from '../telegrams.ts';
import { SHIPPED_DATA, readShipped } from '../testing/shipped.ts';
import { LinkSession } from './session.ts';

interface ReadCase { job: string; request: string; response: string; value: number; unit: string }
interface AdapterCase { module: string; series: string[]; identity: string; readings: ReadCase[] }
const file = 'adapter-replay.oracle.json';
const cases = existsSync(join(SHIPPED_DATA, file)) ? readShipped<{cases: AdapterCase[]}>(file).cases : [];
const bytes = (hex: string) => Uint8Array.from(Buffer.from(hex.replaceAll(' ', ''), 'hex'));
const hex = (data: Uint8Array) => [...data].map(b => b.toString(16).padStart(2, '0')).join(' ');

// The OS port is the only substituted layer. The ordinary chooser, transport, gate, DATALOG
// and PROBE run in vehicle mode. Replies are independent of the decoder and practice vehicle.
function installPort(test: AdapterCase, common: 'refused' | 'silent' = 'refused') {
    const writes: string[] = [];
    let identity = test.identity;
    const pending = [...test.readings, ...test.readings];
    let rx: ReadableStreamDefaultController<Uint8Array>;
    const port = {
        readable: new ReadableStream<Uint8Array>({ start(controller) { rx = controller; } }),
        writable: new WritableStream<Uint8Array>({ write(frame) {
            const request = hex(frame);
            writes.push(request);
            let response: string;
            if (request === '12 04 00 16') {
                if (common === 'silent') { rx.enqueue(frame.slice()); return; }
                response = '12 04 b0 a6';
            } else if (request === 'b8 12 f1 02 1a 80 c3') {
                response = identity;
            } else {
                const reading = pending.shift();
                if (reading?.request !== request) throw new Error('Unexpected adapter request ' + request);
                response = reading.response;
            }
            const reply = bytes(response);
            rx.enqueue(Uint8Array.from([...frame, ...reply.subarray(0, 2)]));
            rx.enqueue(reply.slice(2));
        } }),
        open: vi.fn(async (_options: SerialOptions) => {}),
        close: vi.fn(async () => {}),
        setSignals: async () => {},
    };
    const requestPort = vi.fn(async () => port);
    vi.stubGlobal('navigator', { serial: { requestPort } });
    vi.stubGlobal('location', { search: '' });
    return { writes, pending, port, requestPort, replaceIdentity(reply: string) { identity = reply; } };
}

describe.skipIf(!cases.length)('ordinary Web Serial read path with synthetic interpreter replies', () => {
    const sessions: LinkSession[] = [];
    beforeAll(() => {
        configureEcuData(async name => {
            try {
                const body = readShipped<unknown>(name);
                return { ok: true, status: 200, json: async () => body };
            } catch {
                return { ok: false, status: 404, json: async () => null };
            }
        });
        return () => configureEcuData(fetchEcuDataFromPage);
    });
    afterEach(async () => {
        for (const session of sessions.splice(0)) { await session.disconnect(); session.dispose(); }
        vi.unstubAllGlobals();
    });

    async function connect() {
        const session = new LinkSession({ target: moduleProtocol('mss54', 0x12, readShipped<TelegramTable>('mss54.telegrams.json')) });
        sessions.push(session);
        await session.connect('vehicle');
        expect(session.getSnapshot(), session.lastError() ?? '').toMatchObject({ mode: 'vehicle', state: 'connected' });
        return session;
    }

    it.each(cases)('identifies $module and records the same values in DATALOG and PROBE', async test => {
        const replay = installPort(test);
        const session = await connect();
        const ident = await session.readIdent();
        expect(ident, session.lastError() ?? '').toMatchObject({ hex: hex(bytes(test.identity).slice(4, -1)) });
        expect(session.getSnapshot().fitment.get(0x12)?.moduleId).toBe(test.module);
        const channels = test.readings.map(r => test.module + ':' + r.job + ':' + r.job.replace('STATUS_', 'STAT_') + '_WERT');
        const { reads, unknown } = await moduleLogReads(channels, () => 0x12);
        expect(unknown).toEqual([]);
        const data = await moduleLogData(test.module, 0x12);
        expect(data).toBeTruthy();
        const columns = moduleChannels(test.module, data!);
        expect(channels.map(channel => columns.find(c => c.channel === channel)?.unit)).toEqual(test.readings.map(r => r.unit));
        const row = await new Promise<Partial<Record<string, number | null>>>((resolve, reject) => {
            let saved: Partial<Record<string, number | null>> = {};
            session.startLog([], sample => {
                saved = sample.values;
                expect(session.retuneLog(['3:n'])).toBe(false);
                session.stopLog();
            },
                error => error ? reject(new Error(error)) : resolve(saved), { reads, ledger: () => EMPTY_LEDGER });
        });
        const steps = [{ n: 1, kind: 'sample' as const, do: 'Compare original decoder results', channels }];
        const modules = await loadProbeModules(steps, readShipped<EcuIndex>('index.json'));
        const result = await session.startProbe({ id: 'replay', v: 1, steps,
            judge: channels.map((channel, i) => ({ id: 'read' + i, channel, stat: 'max', op: '>', value: 0, provenance: 'authored' })) },
            { module: id => modules.get(id) ?? null, ledger: () => EMPTY_LEDGER, onSample: () => session.stopLog() });
        for (const [i, read] of test.readings.entries()) {
            expect(row[channels[i]]).toBeCloseTo(read.value, 4);
            expect(result?.judges[i]?.value).toBeCloseTo(read.value, 4);
            expect(result?.judges[i]?.n).toBe(1);
            expect(result?.judges[i]?.pass).toBe(read.value > 0);
        }
        expect(replay.requestPort).toHaveBeenCalledOnce();
        expect(replay.port.open).toHaveBeenCalledWith(expect.objectContaining({ baudRate: 9600, dataBits: 8, parity: 'even', stopBits: 1 }));
        expect(replay.pending).toHaveLength(0);
    }, 20_000);
    it('reads the group identity after an echoed common IDENT receives no ECU answer', async () => {
        const test = cases.find(c => c.module === 'd50m57a1')!;
        const replay = installPort(test, 'silent');
        const session = await connect();
        expect(await session.readIdent(), session.lastError() ?? '').toMatchObject({ hex: hex(bytes(test.identity).slice(4, -1)) });
        expect(session.getSnapshot().fitment.get(0x12)?.moduleId).toBe(test.module);
        expect(replay.writes.at(-1)).toBe('b8 12 f1 02 1a 80 c3');
    }, 20_000);

    it('displays an unlisted group identity and drops the previous ECU before any further measurement', async () => {
        const test = cases.find(c => c.module === 'd50m57a1')!;
        const replay = installPort(test);
        const session = await connect();
        await session.readIdent();
        const unknown = bytes(test.identity);
        unknown.fill(255, 14, 18);
        unknown[unknown.length - 1] = unknown.subarray(0, -1).reduce((a, b) => a ^ b, 0);
        replay.replaceIdentity(hex(unknown));
        expect(await session.readIdent()).toMatchObject({ hex: hex(unknown.slice(4, -1)) });
        expect(session.getSnapshot().fitment.get(0x12)).toMatchObject({ answer: hex(unknown), sgbd: null, moduleId: null });
        const { reads } = await moduleLogReads([test.module + ':STATUS_MOTORDREHZAHL:STAT_MOTORDREHZAHL_WERT'], () => 0x12);
        const before = replay.writes.length;
        const failed = await new Promise<string | null>(resolve => session.startLog([], () => {
            throw new Error('unexpected measurement');
        }, resolve, { reads, ledger: () => EMPTY_LEDGER }));
        expect(failed).toContain('No selected measurement');
        expect(replay.writes.slice(before)).toEqual([]);
    });

});

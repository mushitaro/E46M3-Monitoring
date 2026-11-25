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

interface ReadCase { job: string; request: string; response: string; value: number; unit: string | null }
interface AdapterCase { module: string; series: string[]; identity: string; identityRequest: string; readings: ReadCase[] }
const file = 'adapter-replay.oracle.json';
const cases = existsSync(join(SHIPPED_DATA, file)) ? readShipped<{cases: AdapterCase[]}>(file).cases : [];
interface MenuReading {
    module: string; address: number; job: string; result: string; request: string;
    cases: { reply: string; value: number; unit: string | null }[];
}
const menuFile = 'menu-readings.oracle.json';
const menuReadings = existsSync(join(SHIPPED_DATA, menuFile)) ? readShipped<{ readings: MenuReading[] }>(menuFile).readings : [];
interface GearboxReplay {
    identityRequest: string;
    identities: { selected: string; response: string }[];
    readings: (MenuReading & { boundaries: MenuReading['cases'] })[];
}
const gearboxFile = 'gearbox-replay.oracle.json';
const gearbox = existsSync(join(SHIPPED_DATA, gearboxFile)) ? readShipped<GearboxReplay>(gearboxFile) : null;
const optionalReadings = [...menuReadings, ...(gearbox?.readings.map(r => ({ ...r, cases: r.boundaries })) ?? [])];
const bytes = (hex: string) => Uint8Array.from(Buffer.from(hex.replaceAll(' ', ''), 'hex'));
const hex = (data: Uint8Array) => [...data].map(b => b.toString(16).padStart(2, '0')).join(' ');

// The OS port is the only substituted layer. The ordinary chooser, transport, gate, DATALOG
// and PROBE run in vehicle mode. Replies are independent of the decoder and practice vehicle.
function installPort(test: AdapterCase, common: 'refused' | 'silent' = 'refused', moduleIdents: ReadonlyMap<string, string> = new Map()) {
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
            } else if (request === test.identityRequest) {
                response = identity;
            } else if (moduleIdents.has(request)) {
                response = moduleIdents.get(request)!;
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
    it.each(optionalReadings)('records $module $job on the positively identified optional module', async test => {
        const groups = readShipped<{ groups: Record<string, { answer: string; variant: string | null }[]> }>('variants.oracle.json').groups;
        const group = 'D_' + test.address.toString(16).padStart(4, '0').toUpperCase();
        const identRequest = hex(Uint8Array.of(test.address, 4, 0, test.address ^ 4));
        const idents = test.module === 'gs30' && gearbox
            ? new Map([[identRequest, '32 04 b0 86'], [gearbox.identityRequest, gearbox.identities.find(i => i.selected === 'GS30')!.response]])
            : new Map([[identRequest, groups[group].find(row => row.variant === test.module.toUpperCase())!.answer]]);
        const channel = test.module + ':' + test.job + ':' + test.result;
        const dme = cases.find(c => c.module === 'd50m57a1')!;
        for (const example of test.cases) {
            const read = { job: test.job, response: example.reply, request: test.request, value: example.value, unit: example.unit };
            const replay = installPort({ ...dme, readings: [read] }, 'refused', idents);
            const session = await connect();
            await session.readIdent();
            const { reads, unknown } = await moduleLogReads([channel], () => test.address);
            expect(unknown, channel).toEqual([]);
            const data = await moduleLogData(test.module, test.address);
            const column = moduleChannels(test.module, data!).find(c => c.channel === channel);
            expect(column, channel).toMatchObject({ unit: example.unit });
            const value = await new Promise<number | null | undefined>((resolve, reject) => {
                let saved: number | null | undefined;
                session.startLog([], sample => { saved = sample.values[channel]; session.stopLog(); },
                    error => error ? reject(new Error(error)) : resolve(saved), { reads, ledger: () => EMPTY_LEDGER });
            });
            expect(value).toBeCloseTo(example.value, 4);
            expect(session.getSnapshot().fitment.get(test.address)?.moduleId).toBe(test.module);
            const steps = [{ n: 1, kind: 'sample' as const, do: 'Read the identified module', channels: [channel] }];
            const modules = await loadProbeModules(steps, readShipped<EcuIndex>('index.json'));
            const probe = await session.startProbe({ id: test.module, v: 1, steps,
                judge: [{ id: 'optional', channel, stat: 'max', op: '>', value: 0, provenance: 'authored' }] },
                { module: id => modules.get(id) ?? null, ledger: () => EMPTY_LEDGER, onSample: () => session.stopLog() });
            expect(probe?.judges[0]?.value).toBeCloseTo(example.value, 4);
            expect(probe?.judges[0]).toMatchObject({ pass: example.value > 0, n: 1 });
            expect(replay.pending).toHaveLength(0);
            expect(replay.writes).toContain(identRequest);
            await session.disconnect();
        }
    }, 30_000);

    it.skipIf(!gearbox)('refuses both neighbouring gearbox identities without sending a GS30 measurement', async () => {
        const option = gearbox!;
        const dme = cases.find(c => c.module === 'd50m57a1')!;
        for (const id of option.identities.filter(row => row.selected === 'XYZ')) {
            const replay = installPort({ ...dme, readings: [] }, 'refused', new Map([
                ['32 04 00 36', '32 04 b0 86'], [option.identityRequest, id.response],
            ]));
            const session = await connect();
            await session.readIdent();
            const read = option.readings[0];
            const { reads } = await moduleLogReads([['gs30', read.job, read.result].join(':')], () => 0x32);
            const error = await new Promise<string | null>(resolve =>
                session.startLog([], () => { throw Error('unexpected measurement'); }, resolve, { reads, ledger: () => EMPTY_LEDGER }));
            expect(error).toContain('No selected measurement');
            expect(session.getSnapshot().fitment.get(0x32)).toMatchObject({ moduleId: null, answer: id.response });
            expect(session.getSnapshot().fitment.get(0x12)?.moduleId).toBe(dme.module);
            expect(replay.writes).not.toContain(read.request);
            await session.disconnect();
        }
    });
    it('reads the group identity after an echoed common IDENT receives no ECU answer', async () => {
        const test = cases.find(c => c.module === 'd50m57a1')!;
        const replay = installPort(test, 'silent');
        const session = await connect();
        expect(await session.readIdent(), session.lastError() ?? '').toMatchObject({ hex: hex(bytes(test.identity).slice(4, -1)) });
        expect(session.getSnapshot().fitment.get(0x12)?.moduleId).toBe(test.module);
        expect(replay.writes.at(-1)).toBe(test.identityRequest);
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

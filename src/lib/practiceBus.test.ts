import { afterEach, describe, expect, it } from 'vitest';
import { Ds2Address, Ds2Link, WebSerialTransport, simulatedPort } from '@tsunagi/ds2-core';
import { moduleProtocol } from './moduleProtocol';
import { practiceBus } from './practiceEcu';
import type { TelegramTable } from './telegrams';
import { HAVE_SHIPPED_DATA, readShipped } from './testing/shipped';
import type { EcuIndex } from './ecuCatalog';

/**
 * The frames a module's own SGBD gives the app, sent the way the app sends them, over PRACTICE.
 *
 * This is the path the DIAGNOSIS READ takes for a module other than the DME, end to end below the
 * hook: the protocol picks the frames, `link.to` addresses them, and the bus answers only at that
 * address. Before, every one of these went to 0x12.
 */

const opened: WebSerialTransport[] = [];
afterEach(async () => {
    for (const t of opened) await t.close().catch(() => {});
    opened.length = 0;
});

async function practiceLink(addresses: number[]) {
    const { port, requestPort } = simulatedPort(practiceBus(addresses));
    const transport = new WebSerialTransport({ requestPort });
    opened.push(transport);
    const link = new Ds2Link(transport, { address: Ds2Address.DME, timings: { responseTimeoutMs: 80, retryDelayMs: 1 } });
    await link.connect();
    return { link, bus: port.bus! };
}

describe('the PRACTICE bus', () => {
    it('always carries the DME, and carries each requested module at its own address', () => {
        expect(practiceBus([]).map((m) => m.address)).toEqual([0x12]);
        expect(practiceBus([0x32, 0x12, 0x32]).map((m) => m.address)).toEqual([0x12, 0x32]);
    });

    it('lets a frame for a module that is not on it time out, as a car would', async () => {
        const { link, bus } = await practiceLink([0x32]);
        await expect(link.to(0x56).exchangeWithRetry(0x00)).rejects.toThrow();
        expect(bus.at(0x12)!.trace).toHaveLength(0);
        expect(bus.at(0x32)!.trace).toHaveLength(0);
    });
});

describe.skipIf(!HAVE_SHIPPED_DATA)('a fault read for SMG II and DSC goes to SMG II and DSC', () => {
    const index = HAVE_SHIPPED_DATA ? readShipped<EcuIndex>('index.json') : null;
    const protocolOf = (id: string) => {
        const entry = index!.modules.find((m) => m.id === id)!;
        return moduleProtocol(id, entry.address, readShipped<TelegramTable>(`${id}.telegrams.json`));
    };

    for (const id of ['smg2', 'dsc_e46']) {
        it(`${id}: IDENT and every FS_LESEN frame reach its address, and the DME hears nothing`, async () => {
            const p = protocolOf(id);
            const { link, bus } = await practiceLink([p.address]);
            const to = link.to(p.address);
            for (const f of [p.ident!, ...p.faults]) {
                const frame = await to.exchangeWithRetry(f.control, f.payload);
                expect(frame.address).toBe(p.address);
            }
            expect(bus.at(0x12)!.trace).toHaveLength(0);
            expect(bus.at(p.address)!.trace.map((e) => Array.from(e.bytes))).toEqual(
                [p.ident!, ...p.faults].map((f) => f.hex.split(' ').map((b) => parseInt(b, 16))),
            );
        });
    }
});

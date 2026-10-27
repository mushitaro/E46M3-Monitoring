import { afterEach, describe, expect, it } from 'vitest';
import { Ds2Address, Ds2Control, Ds2Status } from './frame';
import { Ds2Link } from './link';
import { simulatedPort } from './simulator';
import { WebSerialTransport } from './transport';

/**
 * One link, several modules on one wire.
 *
 * The app built its link with the DME's address and never changed it, so SMG II and DSC frames
 * went to 0x12. These tests pin the shape that replaces it: the module is named at every
 * exchange, the bus answers only at the address that was named, and every module still shares
 * the one gate.
 */

const opened: WebSerialTransport[] = [];
afterEach(async () => {
    for (const t of opened) await t.close().catch(() => {});
    opened.length = 0;
});

const FAST = { responseTimeoutMs: 80, retryDelayMs: 1, resyncSettleMs: 0, breakSettleMs: 1 };

async function busOf(addresses: number[]) {
    const { port, requestPort } = simulatedPort(
        addresses.map((address) => ({
            address,
            respond: () => ({ payload: new Uint8Array([address]) }),
        })),
    );
    const transport = new WebSerialTransport({ requestPort });
    opened.push(transport);
    const link = new Ds2Link(transport, { address: Ds2Address.DME, timings: FAST });
    await link.connect();
    return { link, port, bus: port.bus! };
}

describe('a link reaches each module at its own address', () => {
    it('sends to the module it names, and only that module answers', async () => {
        const { link, bus } = await busOf([Ds2Address.DME, Ds2Address.SMG, Ds2Address.DSC]);

        const smg = await link.to(Ds2Address.SMG).exchangeWithRetry(Ds2Control.IDENT);
        expect(smg.address).toBe(Ds2Address.SMG);
        expect(Array.from(smg.payload)).toEqual([Ds2Address.SMG]);

        const dsc = await link.to(Ds2Address.DSC).exchange(Ds2Control.IDENT);
        expect(dsc.address).toBe(Ds2Address.DSC);

        expect(bus.trace.map((e) => e.request.address)).toEqual([Ds2Address.SMG, Ds2Address.DSC]);
        expect(bus.at(Ds2Address.DME)!.trace).toHaveLength(0);
    });

    it('keeps the link’s own methods on the link’s own address', async () => {
        const { link, bus } = await busOf([Ds2Address.DME, Ds2Address.SMG]);
        await link.exchangeWithRetry(Ds2Control.IDENT);
        expect(bus.trace.map((e) => e.request.address)).toEqual([Ds2Address.DME]);
    });

    it('meets a frame for an absent module with silence, not with the DME’s answer', async () => {
        const { link, bus } = await busOf([Ds2Address.DME]);
        await expect(link.to(Ds2Address.DSC).exchangeWithRetry(Ds2Control.IDENT)).rejects.toThrow();
        // Three attempts, all to 0x56, none answered.
        expect(bus.trace.map((e) => [e.request.address, e.behavior])).toEqual([
            [Ds2Address.DSC, 'silent'],
            [Ds2Address.DSC, 'silent'],
            [Ds2Address.DSC, 'silent'],
        ]);
        expect(bus.at(Ds2Address.DME)!.trace).toHaveLength(0);
    });

    it('sends the heartbeat to the module it is asked for', async () => {
        const { link, bus } = await busOf([Ds2Address.DME, Ds2Address.SMG]);
        expect(await link.to(Ds2Address.SMG).keepAlive()).toBe(true);
        expect(bus.trace.map((e) => [e.request.address, e.request.controlOrStatus])).toEqual([
            [Ds2Address.SMG, Ds2Control.KEEP_ALIVE],
        ]);
    });

    it('shares one gate across every module — two modules cannot interleave frames', async () => {
        const { link } = await busOf([Ds2Address.DME, Ds2Address.SMG]);
        const first = link.exchange(Ds2Control.IDENT);
        await expect(link.to(Ds2Address.SMG).exchange(Ds2Control.IDENT)).rejects.toMatchObject({
            code: 'GATE_HELD',
        });
        await first;
    });

    it('refuses an address that is not a byte', async () => {
        const { link } = await busOf([Ds2Address.DME]);
        expect(() => link.to(0x100)).toThrow(RangeError);
        expect(() => link.to(-1)).toThrow(RangeError);
        expect(() => link.to(1.5)).toThrow(RangeError);
    });

    it('still reads a refusal as a refusal, from whichever module gave it', async () => {
        const { port, requestPort } = simulatedPort([
            { address: Ds2Address.DME },
            { address: Ds2Address.SMG, respond: () => ({ status: Ds2Status.REJECTED }) },
        ]);
        const transport = new WebSerialTransport({ requestPort });
        opened.push(transport);
        const link = new Ds2Link(transport, { address: Ds2Address.DME, timings: FAST });
        await link.connect();
        const frame = await link.to(Ds2Address.SMG).exchangeWithRetry(Ds2Control.IDENT);
        expect(() => link.assertPositive(frame, 'SMG ident')).toThrow(/0x/);
        // A refusal is answered once: it is a fact about the module, not a line fault to retry.
        expect(port.bus!.trace).toHaveLength(1);
    });
});

describe('the bus itself', () => {
    it('will not hold two modules at one address', () => {
        expect(() => simulatedPort([{ address: 0x12 }, { address: 0x12 }])).toThrow(/two simulated modules/);
    });
});

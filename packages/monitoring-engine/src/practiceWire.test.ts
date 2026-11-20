import { afterEach, describe, expect, it } from 'vitest';
import { Ds2Address, Ds2Link, WebSerialTransport } from '@tsunagi/ds2-core';
import { PracticePort } from './practiceEcu.ts';
import { driveNow, practiceCar, practiceSpeed, resetPracticeCar } from './practiceCar.ts';

/**
 * The practice car as a test reads it (docs/VIRTUAL-CAR-TESTS.md, A1, A2, A4): what it heard on the wire,
 * an answer given in place of its own, and a drive it follows.
 */
const opened: WebSerialTransport[] = [];
afterEach(async () => {
    for (const t of opened) await t.close().catch(() => {});
    opened.length = 0;
    resetPracticeCar();
});

async function link() {
    const port = new PracticePort([0x32, 0x56]);
    const transport = new WebSerialTransport({ requestPort: async () => port as never });
    opened.push(transport);
    const l = new Ds2Link(transport, { address: Ds2Address.DME, timings: { responseTimeoutMs: 120, retryDelayMs: 1 } });
    await l.connect();
    return l;
}

describe('the practice car', () => {
    it('keeps every frame it heard, with its address', async () => {
        resetPracticeCar();
        const l = await link();
        await l.to(0x32).exchangeWithRetry(0x04, new Uint8Array([0x00])).catch(() => null);
        const heard = practiceCar.wire.map((f) => f.hex);
        expect(heard).toContain('32 05 04 00 33');
        expect(practiceCar.wire.find((f) => f.hex === '32 05 04 00 33')?.to).toBe(0x32);
    });

    it('refuses, stays silent or answers busy where a scenario says, and only there', async () => {
        resetPracticeCar();
        practiceCar.inject = [{ to: 0x32, ctrl: 0x04, kind: 'negative' }];
        const l = await link();
        const first = await l.to(0x32).exchangeWithRetry(0x04, new Uint8Array([0x00])).catch((e) => e);
        // The module refused once; the next ask is answered as the car would.
        expect(first instanceof Error ? String(first) : first.controlOrStatus).toSatisfy((v: unknown) => v === 0xa2 || /reject|refus/i.test(String(v)));
        const second = await l.to(0x32).exchangeWithRetry(0x04, new Uint8Array([0x00]));
        expect(second.controlOrStatus).toBe(0xa0);

        practiceCar.inject = [{ to: 0x32, ctrl: 0x04, kind: 'silent', times: 10 }];
        await expect(l.to(0x32).exchangeWithRetry(0x04, new Uint8Array([0x00]))).rejects.toBeTruthy();
    });

    it('follows a drive: speed, rpm, pedal, gear and the cams between its points', () => {
        resetPracticeCar();
        const t0 = Date.now();
        practiceCar.drive = {
            startedAt: t0,
            points: [
                { t: 0, gear: 3, kmh: 40, rpm: 3000, pedal: 100, exSoll: 20, exIst: 20 },
                { t: 4, gear: 3, kmh: 80, rpm: 6000, pedal: 100, exSoll: 30, exIst: 24 },
            ],
        };
        const mid = driveNow(t0 + 2000)!;
        expect(mid.rpm).toBeCloseTo(4500, 0);
        expect(mid.kmh).toBeCloseTo(60, 0);
        expect(mid.exSoll - mid.exIst).toBeCloseTo(3, 1);
        expect(mid.gear).toBe(3);
        expect(practiceSpeed()).toBeGreaterThanOrEqual(40);
        practiceCar.drive = null;
        expect(driveNow()).toBeNull();
    });
});

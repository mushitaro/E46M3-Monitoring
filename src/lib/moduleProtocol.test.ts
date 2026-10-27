import { describe, expect, it } from 'vitest';
import { moduleProtocol, noProtocol } from './moduleProtocol';
import type { TelegramTable } from './telegrams';
import { HAVE_SHIPPED_DATA, readShipped } from './testing/shipped';
import type { EcuIndex } from './ecuCatalog';

const table = (address: number, jobs: Record<string, string[]>): TelegramTable => ({
    module: 'x',
    sgbd: 'X',
    address,
    jobs: Object.fromEntries(
        Object.entries(jobs).map(([job, hexes]) => [
            job,
            hexes.map((hex) => ({ hex, cmd: parseInt(hex.split(' ')[2], 16), cmdName: '', occurrences: 1, confidence: 'shared' as const })),
        ]),
    ),
});

describe('a module is sent only what its own SGBD sends it', () => {
    it('takes the fault reads in the order the module’s FS_LESEN sends them', () => {
        const p = moduleProtocol('x', 0x56, table(0x56, { FS_LESEN: ['56 04 00 52', '56 05 04 01 56'] }));
        // `56 04 00 52` is an IDENT frame that the scrape also filed under FS_LESEN; it is not a
        // fault read and is not taken as one.
        expect(p.faults.map((f) => f.hex)).toEqual(['56 05 04 01 56']);
        expect(Array.from(p.faults[0].payload)).toEqual([0x01]);
    });

    it('refuses a frame addressed to another module, even under the right job name', () => {
        const p = moduleProtocol('x', 0x32, table(0x32, { IDENT: ['12 04 00 16'], FS_LESEN: ['12 05 04 00 13'] }));
        expect(p.ident).toBeNull();
        expect(p.faults).toEqual([]);
    });

    it('refuses a long frame filed under a short command’s job', () => {
        const p = moduleProtocol(
            'x',
            0x44,
            table(0x44, { FS_LESEN: ['44 05 04 00 45', '44 18 1a 00 92 1c 00 00 00 1f 40 18 1f 40 18 1e 40 19 1f 40 18 10 70 a8'] }),
        );
        expect(p.faults.map((f) => f.hex)).toEqual(['44 05 04 00 45']);
    });

    it('sends no heartbeat a module’s SGBD does not send, unless it was measured', () => {
        expect(moduleProtocol('smg2', 0x32, table(0x32, { DIAGNOSE_ENDE: ['32 04 9f a9'] })).keepAlive).toBeNull();
        expect(moduleProtocol('x', 0x5b, table(0x5b, { DIAGNOSE_AUFRECHT: ['5b 04 9e c1'] })).keepAlive?.hex).toBe('5b 04 9e c1');
        const dme = moduleProtocol('mss54', 0x12, table(0x12, {}));
        expect(dme.keepAlive?.hex).toBe('12 04 9e 88');
        expect(dme.keepAlive?.source).toMatch(/measured/);
    });

    it('knows nothing about a module with no table, and says so by leaving every frame out', () => {
        const p = noProtocol('cdc_46', 0x76);
        expect(p).toMatchObject({ ident: null, faults: [], clear: null, keepAlive: null, endSession: null, decoder: null });
    });

    it('decodes only the MSS54; every other module’s answer stays bytes', () => {
        expect(moduleProtocol('mss54', 0x12, null).decoder).toBe('mss54');
        expect(moduleProtocol('smg2', 0x32, null).decoder).toBeNull();
    });
});

describe.skipIf(!HAVE_SHIPPED_DATA)('against the shipped telegram tables', () => {
    const index = HAVE_SHIPPED_DATA ? readShipped<EcuIndex>('index.json') : null;
    const of = (id: string) => {
        const entry = index!.modules.find((m) => m.id === id)!;
        return moduleProtocol(id, entry.address, readShipped<TelegramTable>(`${id}.telegrams.json`));
    };

    it('gives the MSS54 exactly the frames the app has always built for it', () => {
        const p = of('mss54');
        expect(p.ident?.hex).toBe('12 04 00 16');
        expect(p.faults.map((f) => f.hex)).toEqual(['12 05 04 00 13', '12 05 04 01 12']);
        expect(p.clear?.hex).toBe('12 04 05 13');
        expect(p.endSession?.hex).toBe('12 04 9f 89');
    });

    it('reads SMG II and DSC at their own addresses, with their own argument bytes', () => {
        expect(of('smg2').faults.map((f) => f.hex)).toEqual(['32 05 04 00 33']);
        expect(of('dsc_e46').faults.map((f) => f.hex)).toEqual(['56 05 04 01 56']);
        expect(of('dsc_e46').ident?.hex).toBe('56 04 00 52');
        expect(of('smg2').keepAlive).toBeNull();
        expect(of('dsc_e46').keepAlive).toBeNull();
    });

    it('never builds a frame for any module that is addressed elsewhere or is not that command', () => {
        let frames = 0;
        for (const m of index!.modules) {
            if (!m.sidecars.includes(`${m.id}.telegrams.json`)) continue;
            const p = of(m.id);
            for (const f of [p.ident, p.clear, p.keepAlive, p.endSession, ...p.faults]) {
                if (!f) continue;
                frames++;
                const bytes = f.hex.split(' ').map((b) => parseInt(b, 16));
                expect(bytes[0], `${m.id} ${f.hex}`).toBe(m.address);
                expect(bytes[2], `${m.id} ${f.hex}`).toBe(f.control);
                expect(bytes.length, `${m.id} ${f.hex}`).toBeLessThanOrEqual(5);
            }
        }
        // A loop that found no tables would pass by checking nothing.
        expect(frames).toBeGreaterThan(100);
    });
});

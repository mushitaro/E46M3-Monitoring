import { describe, expect, it } from 'vitest';
import { CLUSTER_VIN_JOBS, CLUSTER_VIN_UNVERIFIED, clusterVinShort } from './clusterVin.ts';
import { moduleProtocol } from './moduleProtocol.ts';
import { clusterVinAnswer, PRACTICE_VIN_SHORT } from './practiceCar.ts';
import type { EcuIndex } from './ecuCatalog.ts';
import type { TelegramTable } from './telegrams.ts';
import { HAVE_SHIPPED_DATA, readShipped } from './testing/shipped.ts';

/**
 * The instrument cluster's VIN read (operator, 2026-11-10): where KOMBI46's and KOMBI46R's own SGBDs
 * read the answer — bytes 4..5 as characters, 6..8 as BCD, the first five digits — which EdiabasLib
 * returned as the same seven characters for the same simulated answer. Every VIN here is made up.
 */

const payload = (...b: number[]) => Uint8Array.from(b);

describe('the short VIN in the cluster’s answer', () => {
    it('reads two characters and five BCD digits, dropping the sixth nibble as the SGBD does', () => {
        // 80 0A A0 | 02 58 59 98 76 50 | 97: what EdiabasLib read as XY98765.
        expect(clusterVinShort(payload(0x02, 0x58, 0x59, 0x98, 0x76, 0x50))).toBe('XY98765');
        expect(clusterVinShort(payload(0x02, 0x4a, 0x52, 0x12, 0x34, 0x5f, 0xff, 0xff))).toBe('JR12345');
    });

    it('gives null rather than a guess when the bytes are not a short VIN', () => {
        expect(clusterVinShort(payload(0x02, 0x4a, 0x52, 0x12, 0x34))).toBeNull(); // too short
        expect(clusterVinShort(payload(0x02, 0x4a, 0x52, 0x1a, 0x34, 0x50))).toBeNull(); // a nibble that is no digit
        expect(clusterVinShort(payload(0x02, 0x49, 0x52, 0x12, 0x34, 0x50))).toBeNull(); // I is never in a VIN
        expect(clusterVinShort(payload(0x02, 0x6a, 0x72, 0x12, 0x34, 0x50))).toBeNull(); // lower case
        expect(clusterVinShort(payload(0x02, 0x00, 0x00, 0x00, 0x00, 0x00))).toBeNull(); // an empty field
    });

    it('reads back what the practice cluster answers', () => {
        expect(clusterVinShort(Uint8Array.from(clusterVinAnswer(PRACTICE_VIN_SHORT)))).toBe(PRACTICE_VIN_SHORT);
    });

    it('is marked not confirmed on a car until a real cluster has answered', () => {
        expect(CLUSTER_VIN_UNVERIFIED).toBe(true);
    });
});

describe('the frame, from the cluster’s own table only', () => {
    const table = (module: string, jobs: Record<string, string[]>): TelegramTable => ({
        module,
        sgbd: module.toUpperCase(),
        address: 0x80,
        jobs: Object.fromEntries(Object.entries(jobs).map(([j, hs]) => [j, hs.map((hex) => ({ hex, cmd: 2, cmdName: '', occurrences: 1, confidence: 'shared' as const }))])),
    });

    it('takes AIF block 2 from the job the SGBD was read for, by exact bytes', () => {
        const p = moduleProtocol('kombi46r', 0x80, table('kombi46r', { STATUS_AIF_FG_NR_LESEN: ['80 0a 00 4a 6f 62 52 65 73 89', '80 05 02 02 85'] }));
        expect(p.vin).toMatchObject({ hex: '80 05 02 02 85', control: 0x02, job: 'STATUS_AIF_FG_NR_LESEN' });
        expect(Array.from(p.vin!.payload)).toEqual([0x02]);
    });

    it('sends nothing the module’s table does not carry, nor another AIF block, nor to a module never read for it', () => {
        expect(moduleProtocol('kombi46', 0x80, table('kombi46', { FS_LESEN: ['80 05 02 02 85'] })).vin).toBeNull();
        expect(moduleProtocol('kombi46', 0x80, table('kombi46', { AIF_FG_NR_LESEN: ['80 05 02 01 86'] })).vin).toBeNull();
        expect(moduleProtocol('ike', 0x80, table('ike', { AIF_FG_NR_LESEN: ['80 05 02 02 85'] })).vin).toBeNull();
        expect(moduleProtocol('smg2', 0x32, table('smg2', { AIF_FG_NR_LESEN: ['32 05 02 02 37'] })).vin).toBeNull();
        expect(moduleProtocol('kombi46', 0x80, null).vin).toBeNull();
    });
});

describe.skipIf(!HAVE_SHIPPED_DATA)('the shipped tables', () => {
    it('give KOMBI46 and KOMBI46R the same frame, 80 05 02 02 85, and no other module a VIN read', () => {
        const index = readShipped<EcuIndex>('index.json');
        const withVin = index.modules
            .map((m) => moduleProtocol(m.id, m.address, readShipped<TelegramTable>(`${m.id}.telegrams.json`)))
            .filter((p) => p.vin)
            .map((p) => [p.moduleId, p.vin!.hex, p.vin!.job]);
        expect(withVin).toEqual([
            ['kombi46', '80 05 02 02 85', 'AIF_FG_NR_LESEN'],
            ['kombi46r', '80 05 02 02 85', 'STATUS_AIF_FG_NR_LESEN'],
        ]);
        expect(Object.keys(CLUSTER_VIN_JOBS).sort()).toEqual(['kombi46', 'kombi46r']);
    });
});

import { describe, expect, it } from 'vitest';
import { SPEED_SOURCES, usableSpeedSource } from './speedSources.ts';
import type { TelegramTable } from './telegrams.ts';
import { HAVE_SHIPPED_DATA, readShipped } from './testing/shipped.ts';

describe('where a car’s speed is read from', () => {
    it('is the MSS54’s block 19 on an M3, and nothing on any other car until a car confirms it', () => {
        expect(usableSpeedSource('mss54')?.frame).toBe('12 05 0b 13 0f');
        for (const id of Object.keys(SPEED_SOURCES).filter((k) => k !== 'mss54')) expect(usableSpeedSource(id), id).toBeNull();
        expect(usableSpeedSource(null)).toBeNull();
        expect(usableSpeedSource('gs20')).toBeNull();
    });

    it.skipIf(!HAVE_SHIPPED_DATA)('names only frames the module’s own telegram table carries for that job', () => {
        for (const sources of Object.values(SPEED_SOURCES)) {
            for (const s of sources) {
                if (s.job.startsWith('LIVE_')) continue;
                const table = readShipped<TelegramTable>(`${s.moduleId}.telegrams.json`);
                expect(table.jobs[s.job]?.map((t) => t.hex.toLowerCase()), `${s.moduleId}.${s.job}`).toContain(s.frame);
            }
        }
    });
});

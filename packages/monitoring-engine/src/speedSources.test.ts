import { describe, expect, it } from 'vitest';
import { SPEED_SOURCES, speedFromAnswer, speedSourcesFor, usableSpeedSource, type SpeedSource } from './speedSources.ts';
import type { EcuProfile } from './ecuCatalog.ts';
import { answerFrame, type SgbdResultsTable } from './sgbd/results.ts';
import type { TelegramTable } from './telegrams.ts';
import { HAVE_SHIPPED_DATA, readShipped } from './testing/shipped.ts';

describe('where a car’s speed is read from', () => {
    it('is the MSS54’s block 19 on an M3, and nothing on any other car until a car confirms it', () => {
        expect(usableSpeedSource('mss54')?.frame).toBe('12 05 0b 13 0f');
        for (const id of Object.keys(SPEED_SOURCES).filter((k) => k !== 'mss54')) expect(usableSpeedSource(id), id).toBeNull();
        expect(usableSpeedSource(null)).toBeNull();
        expect(usableSpeedSource('gs20')).toBeNull();
    });

    it.skipIf(!HAVE_SHIPPED_DATA)('names the verified frame from the interpreter or the module’s own telegram table', () => {
        for (const sources of Object.values(SPEED_SOURCES)) {
            for (const s of sources) {
                if (s.job.startsWith('LIVE_')) continue;
                const table = readShipped<TelegramTable>(`${s.moduleId}.telegrams.json`);
                const oracle = readShipped<{ jobs: Record<string, { cases: Array<{ args: string[]; sends: string[] }> }> }>('job-frames.oracle.json');
                const direct = oracle.jobs[s.moduleId + ':' + s.job]?.cases.find(c => !c.args.length)?.sends;
                expect(direct?.length === 1 ? direct : table.jobs[s.job]?.map((t) => t.hex.toLowerCase()), `${s.moduleId}.${s.job}`).toContain(s.frame);
            }
        }
    });
});

describe('which sources a car offers', () => {
    it('counts the cluster only where 0x80 answered as the early cluster, KOMBI46', () => {
        expect(speedSourcesFor('bms43ds0', 'kombi46').map((s) => s.moduleId)).toEqual(['bms43ds0', 'kombi46']);
        expect(speedSourcesFor('bms43ds0', 'kombi46r').map((s) => s.moduleId)).toEqual(['bms43ds0']);
        expect(speedSourcesFor('bms43ds0', null).map((s) => s.moduleId)).toEqual(['bms43ds0']);
        expect(speedSourcesFor(null, 'kombi46')).toEqual([]);
        expect(speedSourcesFor('mss54', 'kombi46r').map((s) => s.job)).toEqual(['LIVE_19']);
    });
});

describe.skipIf(!HAVE_SHIPPED_DATA)('the speed, read by the module’s own SGBD code', () => {
    const source = (dme: string, module: string): SpeedSource => SPEED_SOURCES[dme].find((s) => s.moduleId === module)!;
    const table = (m: string) => readShipped<SgbdResultsTable>(`${m}.results.json`);
    const answer = (address: number, data: number[]) => answerFrame(address, 0xa0, Uint8Array.from(data));

    it('KOMBI46: STATUS_ANALOG_LESEN reads data bytes 8–9, and zeros as 0 km/h', () => {
        const s = source('bms43ds0', 'kombi46');
        const t = table('kombi46');
        expect(speedFromAnswer(s, t, answer(0x80, new Array(12).fill(0)))).toBe(0);
        const low = speedFromAnswer(s, t, answer(0x80, [0, 0, 0, 0, 0, 0, 0, 0, 100, 0, 0, 0]));
        const high = speedFromAnswer(s, t, answer(0x80, [0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0]));
        expect(low).toBeGreaterThan(0);
        expect(high).toBeGreaterThan(low!);
        // Other bytes are other values, not the speed.
        expect(speedFromAnswer(s, t, answer(0x80, [9, 9, 9, 9, 9, 9, 9, 9, 0, 0, 9, 9]))).toBe(0);
    });

    it('KOMBI46R: no job of the later cluster returns a speed', () => {
        const profile = readShipped<EcuProfile>('kombi46r.jobs.json');
        for (const j of profile.jobs) expect((j.results ?? []).filter((r) => /GESCHWINDIGKEIT/.test(r.name)), j.id).toEqual([]);
    });

    it('BMS43DS0: STATUS_GESCHWINDIGKEIT reads data byte 6 as km/h, and zeros as 0', () => {
        const s = source('bms43ds0', 'bms43ds0');
        const t = table('bms43ds0');
        expect(speedFromAnswer(s, t, answer(0x12, new Array(8).fill(0)))).toBe(0);
        expect(speedFromAnswer(s, t, answer(0x12, [0, 0, 0, 0, 0, 0, 37, 0]))).toBe(37);
    });

    it('MS420DS0, BMS46DS0, BMS46DS1: their own job reads the speed now that an empty working string reads as zeros', () => {
        // They stopped before the value at `comp S1[0]` on an empty S4, which EdiabasLib reads as zero.
        // The source stays closed (below): which answer length the DME really gives is a car's to say —
        // one byte short, these jobs read the frame's checksum where the value is (their code checks no length).
        for (const [m, at] of [['ms420ds0', 2], ['bms46ds0', 8], ['bms46ds1', 8]] as const) {
            const s = source(m, m);
            const data = new Array(16).fill(0);
            expect(speedFromAnswer(s, table(m), answer(0x12, data)), `${m} 0`).toBe(0);
            data[at] = 37;
            expect(speedFromAnswer(s, table(m), answer(0x12, data)), `${m} 37`).toBe(37);
        }
    });

    it('reads nothing with another module’s code, or none', () => {
        const s = source('bms43ds0', 'bms43ds0');
        expect(speedFromAnswer(s, table('kombi46'), answer(0x12, new Array(8).fill(0)))).toBeNull();
        expect(speedFromAnswer(s, null, answer(0x12, new Array(8).fill(0)))).toBeNull();
    });

    it('no source is open on a car that is not an M3', () => {
        for (const [dme, sources] of Object.entries(SPEED_SOURCES)) if (dme !== 'mss54') for (const s of sources) expect(s.usable, `${dme} ${s.moduleId}`).toBe(false);
    });
});


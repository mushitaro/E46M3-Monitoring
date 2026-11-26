import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { practiceBus, practiceKwpAnswer, setPracticeAnswers, type EcuIndex, type EcuProfile, type JobFramesOracle, type SgbdResultsTable, type TelegramTable } from '@tsunagi/monitoring-engine';
import { runCoverage } from './runCoverage';

/**
 * Every job that runs, runs in PRACTICE first (owner, 2026-11-15; completion criteria, 2026-11-18; since
 * 2026-11-26 the build does it, src/lib/practiceEveryItem.test.ts): the practice car answers every frame of
 * it, and of its stop, positively — what EdiabasLib's simulation answered, for a frame it was run with. A
 * frame PRACTICE refuses is a job the build could not practise, and the build would not ship.
 */
const DATA = path.resolve(import.meta.dirname, '..', '..', 'public', 'ecu-data');
const HAVE = existsSync(path.join(DATA, 'job-frames.oracle.json'));
const read = <T,>(f: string) => JSON.parse(readFileSync(path.join(DATA, f), 'utf-8')) as T;
const bytes = (hex: string) => Uint8Array.from(hex.split(' '), (h) => parseInt(h, 16));

describe.skipIf(!HAVE)('PRACTICE answers every frame of every job that runs, and of its stop', () => {
    it('positively', { timeout: 60_000 }, () => {
        const index = read<EcuIndex>('index.json');
        const ids = index.modules.map((m) => m.id);
        const opt = <T,>(f: string): T | null => (existsSync(path.join(DATA, f)) ? read<T>(f) : null);
        const oracle = read<JobFramesOracle>('job-frames.oracle.json');
        const items = runCoverage({
            index,
            profiles: new Map(ids.map((id) => [id, read<EcuProfile>(`${id}.jobs.json`)])),
            telegrams: new Map(ids.flatMap((id) => { const t = opt<TelegramTable>(`${id}.telegrams.json`); return t ? [[id, t] as const] : []; })),
            results: new Map(ids.map((id) => [id, opt<SgbdResultsTable>(`${id}.results.json`)])),
            oracle,
        }).filter((i) => i.status === 'runs');
        setPracticeAnswers(oracle);
        const addresses = [...new Set(index.modules.map((m) => m.address))];
        const bus = new Map(practiceBus(addresses).map((e) => [e.address, e]));
        const refused: string[] = [];
        for (const item of items) {
            for (const hex of [...(item.frames ?? []), ...(item.stopFrames ?? [])]) {
                const b = bytes(hex);
                if (b[0] === 0xb8) {
                    const a = practiceKwpAnswer(b);
                    if (!a || a.length < 2 || a[1][4] !== ((b[4] + 0x40) & 0xff)) refused.push(`${item.module}.${item.job}: ${hex}`);
                    continue;
                }
                const ecu = bus.get(b[0]);
                const r = ecu?.respond?.({ address: b[0], length: b.length, controlOrStatus: b[2], payload: b.slice(3, b.length - 1), checksum: b[b.length - 1] } as never);
                const status = r && 'status' in r ? r.status : 0xa0;
                if (!ecu || status !== 0xa0) refused.push(`${item.module}.${item.job}: ${hex} → ${status?.toString(16)}`);
            }
        }
        expect(items.length).toBeGreaterThan(700);
        expect(refused).toEqual([]);
    });
});

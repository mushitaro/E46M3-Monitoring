import { describe, expect, it } from 'vitest';
import type { ChannelId } from '@tsunagi/ds2-mss54';
import { episodes, type JournalEvent } from '@tsunagi/monitoring-engine';
import { GEAR_CHANNEL, PART_S, captureWindows, channelsOf, gearAt, nearestSample, segmentStats, type DatalogSegment } from './datalogRun';
import { momentOf } from './datalogQuery';

const seg = (from: number, channels: string[], blocks: number, why: DatalogSegment['why'] = 'channels'): DatalogSegment => ({ from, at: 0, channels: channels as ChannelId[], blocks, why, part: 1 });

/** 10 Hz for 4 s with 8 channels' worth, then 40 Hz for 2 s: a change of channels in one run. */
const samples = [
    ...Array.from({ length: 40 }, (_, i) => ({ time: i * 0.1, values: { '3:n': 3000 + i * 50, [GEAR_CHANNEL]: i % 10 === 0 ? 3 : undefined } as Record<string, number | undefined> })),
    ...Array.from({ length: 80 }, (_, i) => ({ time: 4 + i * 0.025, values: { '35:n': 4000 + i, '35:avan1_ist': 84, [GEAR_CHANNEL]: i % 40 === 0 ? 3 : undefined } as Record<string, number | undefined> })),
];

describe('a recording in segments', () => {
    it('gives each segment its own rate, and keeps every channel the run recorded', () => {
        const segments = [seg(0, ['3:n', '3:toel'], 2, 'start'), seg(4, ['35:n', '35:avan1_ist'], 1)];
        const stats = segmentStats(segments, samples);
        expect(stats.map((s) => s.samples)).toEqual([40, 80]);
        expect(stats[0].rateHz).toBeCloseTo(10, 0);
        expect(stats[1].rateHz).toBeCloseTo(40, 0);
        expect(channelsOf(segments)).toEqual(['3:n', '3:toel', '35:n', '35:avan1_ist']);
    });

    it('cuts parts at the journal’s ten minutes', () => {
        expect(PART_S).toBe(600);
    });

    it('gives a moment its gear from the last read at most 1.5 s before, and none when older', () => {
        expect(gearAt(samples, 5)).toEqual({ value: 3, readS: 0.5 });
        const sparse = [{ time: 0, values: { [GEAR_CHANNEL]: 2 } }, { time: 3, values: {} }];
        expect(gearAt(sparse, 1)).toBeNull();
    });

    it('catches a condition on the engine speed whichever block read it, the gear as of then', () => {
        const w = captureWindows(samples, [{ channel: '35:n', op: '>=', value: 3800 }, { channel: GEAR_CHANNEL, op: '==', value: 3 }], 1, 1);
        // 3:n reaches 3800 at 1.6 s (block 3), and block 35 carries on: one stretch.
        expect(w).toHaveLength(1);
        expect(w[0].hit).toBeCloseTo(1.6, 5);
    });

    it('finds the sample nearest a moment, and a moment of the recording with its cursor', () => {
        expect(samples[nearestSample(samples, 4.03)!].time).toBeCloseTo(4.025, 5);
        const m = momentOf(samples, 4.5, 2, null)!;
        expect(m.cursor.t).toBeCloseTo(4.5, 1);
        expect(m.cursor.gear?.value).toBe(3);
        expect(momentOf(samples, 60, 2, null)).toBeNull();
    });
});

describe('the journal and a long recording', () => {
    it('starts an episode at each ten-minute part after the first', () => {
        const capture = (part: number) => ({ channels: ['3:n'], samples: 10, csv: '', part });
        const events: JournalEvent[] = [
            { t: 1_000, kind: 'connect', ecu: 'mss54', mock: true },
            { t: 2_000, kind: 'datalog', datalog: capture(1) },
            { t: 602_000, kind: 'datalog', datalog: capture(2) },
        ];
        expect(episodes(events).map((e) => e.events.length)).toEqual([2, 1]);
    });
});

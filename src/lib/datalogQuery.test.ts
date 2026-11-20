import { describe, expect, it } from 'vitest';
import type { ChannelId } from '@tsunagi/ds2-mss54';
import { channelsForJob, datalogSummary, findChannels, selectionCost, unknownChannels } from './datalogQuery';

describe('channels by name', () => {
    it('finds the VANOS actual and target, and the oil temperature', () => {
        const vanos = findChannels('evan1').map((c) => c.channel);
        expect(vanos).toEqual(expect.arrayContaining(['35:evan1_ist', '35:evan1_soll']));
        expect(findChannels('toel').map((c) => c.channel)).toContain('3:toel');
    });

    it('turns a catalogue read job into the live channel that carries the same SGBD row', () => {
        expect(channelsForJob('STATUS_EVANOS1_IST').map((c) => c.channel)).toContain('35:evan1_ist');
        expect(channelsForJob('STATUS_NOTHING_LIKE_IT')).toEqual([]);
    });

    it('says which names are not live channels, and what a selection costs', () => {
        expect(unknownChannels(['3:n', 'STATUS_EVANOS1_IST'])).toEqual(['STATUS_EVANOS1_IST']);
        expect(selectionCost(['3:n', '3:toel'] as ChannelId[])).toEqual({ channels: 2, blocks: 1 });
    });
});

describe('a recording summed up', () => {
    const samples = Array.from({ length: 10 }, (_, i) => ({ time: i, values: { '3:n': 800 + i * 10, '3:toel': i < 5 ? null : 90 } }));

    it('gives count, mean, min and max per channel, and leaves out what was not read', () => {
        const s = datalogSummary(['3:n', '3:toel'] as ChannelId[], samples);
        expect(s.samples).toBe(10);
        expect(s.stats[0]).toMatchObject({ channel: '3:n', n: 10, mean: 845, min: 800, max: 890 });
        expect(s.stats[1]).toMatchObject({ channel: '3:toel', n: 5, mean: 90 });
    });

    it('takes the last seconds and thins the trace', () => {
        const s = datalogSummary(['3:n'] as ChannelId[], samples, { seconds: 3, max: 2 });
        expect(s.samples).toBe(4);
        expect(s.trace).toHaveLength(2);
        expect(s.trace[1]).toEqual({ t: 9, '3:n': 890 });
    });
});

describe('thinning keeps the peaks of every channel', () => {
    it('keeps the moment a target and its actual are furthest apart, not only the engine speed’s extremes', () => {
        // A pull: speed rises steadily, the exhaust cam falls 6° behind its target for one sample only.
        const samples = Array.from({ length: 600 }, (_, i) => ({
            time: i / 80,
            values: { '35:n': 3000 + i * 5, '35:avan1_soll': 20, '35:avan1_ist': i === 333 ? 14 : 20 },
        }));
        const s = datalogSummary(['35:n', '35:avan1_soll', '35:avan1_ist'] as ChannelId[], samples, { max: 60 });
        expect(s.trace.length).toBeLessThanOrEqual(60);
        const worst = Math.max(...s.trace.map((x) => { const r = x as Record<string, number>; return r['35:avan1_soll'] - r['35:avan1_ist']; }));
        expect(worst).toBe(6);
        expect(s.trace[s.trace.length - 1].t).toBeCloseTo(599 / 80);
    });
});

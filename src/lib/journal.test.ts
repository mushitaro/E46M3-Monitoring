import { describe, expect, it } from 'vitest';
import { IDLE_MS, KEEP_MS, episodes, expiresAt, prunable, toSession, type JournalEvent } from './journal';

const MIN = 60_000;
const ident = { hex: '77 83', length: 2 };
const fault = (code: number) => ({ number: 1, errorCode: code, frequencyCounter: 1 }) as never;
const log = (samples: number) => ({ channels: ['rpm'], samples, csv: 'rpm\n1' });

/** A morning: one connection with a read and a recording, a walk away, then a second connection. */
const day: JournalEvent[] = [
    { t: 0, kind: 'connect', ecu: 'mss54', mock: false },
    { t: 1 * MIN, kind: 'ident', ident },
    { t: 2 * MIN, kind: 'faults', faults: [fault(0x2a)] },
    { t: 3 * MIN, kind: 'datalog', datalog: log(120) },
    // nothing for 20 minutes, same link
    { t: 23 * MIN, kind: 'faults', faults: [] },
    { t: 24 * MIN, kind: 'disconnect', lost: false },
    { t: 30 * MIN, kind: 'connect', ecu: 'smg2', mock: false },
    { t: 31 * MIN, kind: 'faults', faults: [fault(0x10)] },
];

describe('episodes', () => {
    it('breaks at a connect, after a disconnect, and after ten idle minutes', () => {
        const eps = episodes(day);
        expect(eps.map((e) => e.start)).toEqual([0, 23 * MIN, 30 * MIN]);
        expect(eps.map((e) => e.ecu)).toEqual(['mss54', null, 'smg2']);
    });

    it('counts what each holds', () => {
        const [first] = episodes(day);
        expect(first.counts).toEqual({ faultReads: 1, samples: 120, adaptations: 0, runs: 0, failures: 0 });
        expect(first.end).toBe(3 * MIN);
    });

    it('does not break at exactly ten minutes', () => {
        const eps = episodes([
            { t: 0, kind: 'faults', faults: [] },
            { t: IDLE_MS, kind: 'faults', faults: [] },
        ]);
        expect(eps).toHaveLength(1);
    });

    it('leaves out a connection with nothing read in it', () => {
        const eps = episodes([
            { t: 0, kind: 'connect', ecu: 'mss54', mock: false },
            { t: MIN, kind: 'disconnect', lost: true },
        ]);
        expect(eps).toEqual([]);
    });

    it('joins an episode to the one before when the owner asked', () => {
        const eps = episodes(day, new Set([23 * MIN]));
        expect(eps.map((e) => e.start)).toEqual([0, 30 * MIN]);
        expect(eps[0].counts.faultReads).toBe(2);
    });

    it('sorts events that arrive out of order', () => {
        const eps = episodes([...day].reverse());
        expect(eps.map((e) => e.start)).toEqual([0, 23 * MIN, 30 * MIN]);
    });
});

describe('seven days', () => {
    it('expires an episode a week after it ended', () => {
        const [first] = episodes(day);
        expect(expiresAt(first)).toBe(3 * MIN + KEEP_MS);
    });

    it('prunes up to the oldest episode still inside its week, never half of one', () => {
        // On day 7 + 10 minutes the first episode (ended at 3 min) has expired; the second (23 min) has not.
        expect(prunable(day, KEEP_MS + 10 * MIN)).toBe(23 * MIN);
        // A month later everything may go.
        expect(prunable(day, 30 * 24 * 60 * MIN)).toBe(30 * 24 * 60 * MIN);
    });
});

describe('toSession', () => {
    it('keeps the newest identity and fault read, every recording and every failure', () => {
        const note = { at: 4 * MIN, job: 'Read', error: 'timeout', errorKind: 'timeout', excerpt: [] };
        const [ep] = episodes([...day.slice(0, 4), { t: 3.5 * MIN, kind: 'datalog', datalog: log(40) }, { t: 4 * MIN, kind: 'failure', note }]);
        const s = toSession(ep, { id: 'x', syncedAt: null }, 99, 'mss54', null);
        expect(s.ident).toEqual(ident);
        expect(s.faults).toHaveLength(1);
        expect(s.datalog?.samples).toBe(40);
        expect(s.datalogs.map((d) => d.samples)).toEqual([120, 40]);
        expect(s.failures).toEqual([note]);
        expect(s.ecu).toBe('mss54');
        expect(s.createdAt).toBe(0);
        expect(s.updatedAt).toBe(99);
    });

    it('keeps the bytes of a module it cannot decode, and counts the read', () => {
        const reads = [{ request: '32 04 04 32', response: '00', source: 'FS_LESEN' }];
        const [ep] = episodes([
            { t: 0, kind: 'connect', ecu: 'smg2', mock: true },
            { t: 1, kind: 'rawFaults', reads },
        ]);
        expect(ep.counts.faultReads).toBe(1);
        const s = toSession(ep, { id: 'x', syncedAt: null }, 2, 'mss54', null);
        expect(s.rawFaults).toEqual(reads);
        expect(s.ecu).toBe('smg2');
        expect(s.label).toContain('SMG2');
    });

    it('says the faults were not read rather than that there were none', () => {
        const [ep] = episodes([{ t: 0, kind: 'ident', ident }]);
        expect(toSession(ep, { id: 'x', syncedAt: null }, 1, 'dsc', null).faults).toBeNull();
    });
});

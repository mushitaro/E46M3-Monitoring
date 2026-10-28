import { describe, expect, it } from 'vitest';
import type { NotebookEntry } from '../notebook/rules';
import type { StoredRun } from '../probe/runStore';
import { TAIL_MS, delegatedRecords, runsToSend, toSend } from './investigations';

/** Which records the tab brings level with the account, and what of each it sends. */

const T0 = 1_800_000_000_000;
const D = 86_400_000;
const e = (id: string, sessionId: string, at: number, by: NotebookEntry['by'], body: NotebookEntry['body']): NotebookEntry => ({ id, sessionId, at, by, body });
const mandate = (id: string, record: string, at: number, days: number) => e(id, record, at, 'driver', { kind: 'mandate', words: '調べて', modules: [], until: at + days * D });
const note = (id: string, record: string, at: number) => e(id, record, at, 'driver', { kind: 'note', run: null, t: null, text: 'ここ', via: 'voice' });

describe('the records a round covers', () => {
    it('are those with a mandate that stands or ended within the week, and nothing older', () => {
        const entries = [mandate('m-0000001', 'rec-live0001', T0, 7), mandate('m-0000002', 'rec-tail0001', T0 - 10 * D, 7), mandate('m-0000003', 'rec-old00001', T0 - 40 * D, 7), note('n-0000001', 'rec-none0001', T0)];
        expect(delegatedRecords(entries, T0 + D)).toEqual(['rec-live0001', 'rec-tail0001']);
        expect(delegatedRecords(entries, T0 + 7 * D + TAIL_MS)).toEqual([]);
    });
});

describe('what of a record is sent', () => {
    const m = mandate('m-0000001', 'rec-00000001', T0, 7);
    const before = note('n-0000001', 'rec-00000001', T0 - 1);
    const during = note('n-0000002', 'rec-00000001', T0 + 1);
    const desk = e('desk-000001', 'rec-00000001', T0 + 2, 'desk', { kind: 'read', text: 'x', sure: 'low' });

    it('is what the account lacks, written while delegated, and never the desk’s own', () => {
        expect(toSend([before, m, during, desk], []).map((x) => x.id)).toEqual(['m-0000001', 'n-0000002']);
        expect(toSend([before, m, during, desk], [m, desk]).map((x) => x.id)).toEqual(['n-0000002']);
    });

    it('is a finished run the account lacks, started while delegated', () => {
        const run = (id: string, startedAt: number): StoredRun =>
            ({ id, sessionId: 'rec-00000001', n: 1, planId: 'p', planV: 1, startedAt, endedAt: startedAt + 1000, end: 'done', samples: [], exchanges: [], captures: [], steps: [], judges: [] }) as StoredRun;
        const runs = [run('run-aaaaaaa1', T0 + 10), run('run-aaaaaaa2', T0 - 10), run('run-aaaaaaa3', T0 + 20)];
        expect(runsToSend([m], runs, new Set(['run-aaaaaaa3'])).map((r) => r.id)).toEqual(['run-aaaaaaa1']);
    });
});

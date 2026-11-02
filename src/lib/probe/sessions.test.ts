import { describe, expect, it } from 'vitest';
import { addProblem, mergeEntries, type NotebookEntry } from '../notebook/rules';
import { describeSession, lineage, nextSession, probeSessions } from './sessions';

const DAY = 86_400_000;
const T0 = 1_800_000_000_000;
let seq = 0;
const id = () => `id-${String(++seq).padStart(6, '0')}`;

function record(sessionId: string, at: number, extra: Record<string, unknown> = {}): NotebookEntry[] {
    const m: NotebookEntry = { id: id(), sessionId, at, by: 'driver', body: { kind: 'mandate', words: '毎週の点検', modules: ['mss54'], until: at + 7 * DAY, mode: 'predictive', ...extra } };
    const p: NotebookEntry = {
        id: id(),
        sessionId,
        at: at + 1,
        by: 'chat',
        body: { kind: 'plan', v: 1, mandate: m.id, purpose: '定点', steps: [{ n: 1, do: 's', kind: 'sample', channels: ['3:n'] }] },
    };
    return [m, p];
}

describe('NEXT', () => {
    it('refuses before the session has data, and says why', () => {
        const r = record('rec-a0000001', T0);
        expect(nextSession(r, 'rec-a0000001', 0, { now: T0 + DAY, newId: id, by: 'owner' })).toEqual({ ok: false, reason: 'no-data' });
        expect(nextSession([r[0]], 'rec-a0000001', 1, { now: T0 + DAY, newId: id, by: 'owner' })).toEqual({ ok: false, reason: 'no-plan' });
    });

    it('carries the mandate and the form into a new record the rules accept', () => {
        const r = record('rec-a0000001', T0);
        const n = nextSession(r, 'rec-a0000001', 2, { now: T0 + 9 * DAY, newId: id, by: 'owner' });
        if (!n.ok) throw new Error(n.reason);
        const [m, p] = n.entries;
        expect(m).toMatchObject({ by: 'owner', body: { words: '毎週の点検', modules: ['mss54'], mode: 'predictive', follows: 'rec-a0000001', until: T0 + 16 * DAY } });
        expect(p).toMatchObject({ by: 'chat', body: { kind: 'plan', v: 1, mandate: m.id } });
        // Through the same rules as every writer: the copied form acts under the new mandate.
        let held: NotebookEntry[] = [];
        for (const e of n.entries) {
            expect(addProblem(e, held)).toBeNull();
            held = mergeEntries(held, [e]);
        }
    });
});

describe('the sessions STARTUP lists', () => {
    it('newest first, with the series NEXT linked, and an empty session at the head', () => {
        const a = record('rec-a0000001', T0);
        const n = nextSession(a, 'rec-a0000001', 1, { now: T0 + DAY, newId: id, by: 'owner' });
        if (!n.ok) throw new Error(n.reason);
        const all = [...a, ...n.entries];
        const list = probeSessions(all, new Map([['rec-a0000001', 1]]), T0 + DAY, { id: 'rec-fresh0001', at: T0 + 2 * DAY });
        expect(list.map((s) => s.id)).toEqual(['rec-fresh0001', n.record, 'rec-a0000001']);
        expect(list[0]).toMatchObject({ words: null, v: null, runs: 0 });
        expect(list[1]).toMatchObject({ follows: 'rec-a0000001', v: 1, standing: true });
        expect(lineage(all, n.record)).toEqual(['rec-a0000001', n.record]);
    });

    it('says a session whose mandate ran out is not standing', () => {
        const a = record('rec-a0000001', T0);
        expect(describeSession('rec-a0000001', a, 0, T0 + 30 * DAY).standing).toBe(false);
    });
});

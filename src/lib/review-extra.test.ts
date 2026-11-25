import { afterEach, expect, it, vi } from 'vitest';
import { appNow, learnServerTime, resetClock } from './clock';
import { delegatedRecords } from './sync/investigations';
import { judge } from './probe/criteria';
import { MONITORING_TOOLS } from './bridge/tools';
import { judgesProblem } from './probe/plan';
import type { NotebookEntry } from './notebook/rules';

afterEach(() => { vi.unstubAllGlobals(); resetClock(); });

it('R06 a newly delegated record remains eligible for sync after the first time anchor', () => {
    vi.stubGlobal('performance', { timeOrigin: Date.UTC(2007, 2, 17), now: () => 1000 });
    const at = appNow();
    const e: NotebookEntry = { id: 'mandate-0001', sessionId: 'record-00001', at, by: 'driver', body: { kind: 'mandate', words: 'Investigate this fault', modules: [], until: at + 7 * 86400000 } };
    expect(delegatedRecords([e], at)).toEqual(['record-00001']);
    learnServerTime(new Date(Date.UTC(2026, 10, 5)).toUTCString(), at, at);
    expect(delegatedRecords([e], appNow())).toEqual(['record-00001']);
});

it('R07 machine-readable judge schema declares the fields required by the validator', () => {
    const properties = MONITORING_TOOLS.monitoring_plan.inputSchema.properties as Record<string, { items: { required?: string[] } }>;
    const example = { id: 'j', channel: '3:n', stat: 'max', op: '<=', value: 9000, provenance: 'authored' };
    expect(judgesProblem([example])).toBeNull();
    expect(properties.judge.items.required).toEqual(expect.arrayContaining(Object.keys(example)));
});

it('R08 a long recording can compute a maximum without argument-stack overflow', () => {
    const samples = Array.from({ length: 200000 }, (_, i) => ({ t: i, values: { '3:n': 800 } }));
    const j = { id: 'j', channel: '3:n', stat: 'max', op: '<=', value: 9000, provenance: 'authored' } as const;
    expect(judge(j, samples)).toMatchObject({ n: 200000, value: 800, pass: true });
});

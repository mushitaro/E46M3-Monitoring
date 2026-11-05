import { afterEach, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';

afterEach(() => vi.unstubAllGlobals());

it('persists the first-anchor correction and original timestamp across a reload', async () => {
    vi.resetModules();
    vi.stubGlobal('indexedDB', new IDBFactory());
    vi.stubGlobal('performance', { timeOrigin: Date.UTC(2007, 2, 17), now: () => 1000 });
    const clock = await import('../clock');
    const store = await import('./store');
    const at = clock.appNow();
    await store.addEntries([{ id: 'mandate-0001', sessionId: 'record-00001', at, by: 'driver',
        body: { kind: 'mandate', words: 'Investigate', modules: [], until: at + 7 * 86400000 } }]);
    clock.learnServerTime(new Date(Date.UTC(2026, 10, 5)).toUTCString(), at, at);
    const entries = await store.listAllEntries();
    expect(entries[0].at).toBeGreaterThan(Date.UTC(2026, 0, 1));
    expect(entries[0].sourceAt).toBe(at);
    clock.resetClock();
    expect(await store.listAllEntries()).toEqual(entries);
});


it('does not revive a mandate from another page with an overlapping reset clock', async () => {
    vi.resetModules();
    vi.stubGlobal('performance', { timeOrigin: Date.UTC(2007, 2, 17), now: () => 1000 });
    const clock = await import('../clock');
    const { anchorEntry } = await import('./clock');
    const at = clock.appNow();
    clock.learnServerTime(new Date(Date.UTC(2026, 10, 5)).toUTCString(), at, at);
    const old = { id: 'mandate-0001', sessionId: 'record-00001', at, by: 'driver' as const, clockSessionId: 'another-page', body: { kind: 'mandate' as const, words: 'Investigate', modules: [], until: at + 86400000 } };
    expect(anchorEntry(old)).toEqual(old);
});

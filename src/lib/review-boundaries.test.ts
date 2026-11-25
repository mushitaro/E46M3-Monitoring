import { afterEach, expect, it, vi } from 'vitest';
import { BufferedByteTransport } from '../../packages/ds2-core/src/bufferedByteTransport';
import { appNow, learnServerTime, resetClock } from './clock';
import { episodes, prunable, type JournalEvent } from './journal';
import { useMonitoringFacade } from '../hooks/useMonitoringFacade';
import type { SavedSession } from './sync/session';

// Review probes intentionally assert the required contract. Failures are findings,
// not fixes and not part of the shipping baseline's existing test count.
const { priorSessions } = vi.hoisted(() => ({ priorSessions: [] as SavedSession[] }));
vi.mock('./sync/sessionStore', () => ({ listLocal: async () => priorSessions }));
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); resetClock(); priorSessions.length = 0; });

it('R01 byte timeout stays bounded when device clock moves backwards', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-05T00:00:00Z'));
    class TestTransport extends BufferedByteTransport { feed() { this.receive([1]); } }
    const t = new TestTransport();
    let state = 'pending';
    const p = t.readExact(1, 1000).then(() => { state = 'read'; }, () => { state = 'timeout'; });
    vi.setSystemTime(new Date('2007-03-17T00:00:00Z'));
    await vi.advanceTimersByTimeAsync(1001);
    const observed = state;
    t.feed(); await p;
    expect(observed, 'a wall-clock rollback must not extend a byte timeout by years').toBe('timeout');
});

it('R02 an additional Date header cannot move an anchored application clock backwards', () => {
    vi.stubGlobal('performance', { timeOrigin: Date.UTC(2007, 2, 17), now: () => 1000 });
    const before = appNow();
    const server = Date.UTC(2026, 10, 5);
    learnServerTime(new Date(server).toUTCString(), before, before);
    const first = appNow();
    learnServerTime(new Date(server - 120000).toUTCString(), first, first);
    expect(appNow()).toBeGreaterThanOrEqual(first);
});

it('R03 learning server time must not make just-recorded journal events immediately prunable', () => {
    vi.stubGlobal('performance', { timeOrigin: Date.UTC(2007, 2, 17), now: () => 1000 });
    const at = appNow();
    const events: JournalEvent[] = [{ t: at, kind: 'connect', ecu: 'mss54', mock: false }, { t: at + 1, kind: 'faults', faults: [] }];
    learnServerTime(new Date(Date.UTC(2026, 10, 5)).toUTCString(), at, at);
    const cut = prunable(events, appNow());
    expect(events.filter(e => e.t >= cut)).toHaveLength(2);
});

it('R04 a recording longer than the idle gap must retain vehicle and practice provenance', () => {
    const events: JournalEvent[] = [{ t: 1000, kind: 'connect', ecu: 'mss54', mock: true }, { t: 1001, kind: 'ident', ident: { hex: '00', length: 1 } }, { t: 1000 + 11 * 60000, kind: 'datalog', datalog: { channels: ['3:n'], samples: 2, csv: 't,n\n0,800\n660,900' } }];
    const recorded = episodes(events).find(e => e.counts.samples > 0)!;
    expect({ ecu: recorded.ecu, mock: recorded.mock }).toEqual({ ecu: 'mss54', mock: true });
});

it('R05 a failed SAVE must not report the latest unrelated old session as saved', async () => {
    priorSessions.push({ v: 1, id: 'old-record', label: 'previous drive', createdAt: 1, updatedAt: 1, syncedAt: 1, appBuild: 'old', ecu: 'mss54', mock: false, ident: null, faults: [], datalog: null, failures: [] });
    const facade = useMonitoringFacade({ link: {}, ecuId: 'mss54', datalog: {}, probe: { progress: null }, sessions: { save: async () => undefined } } as never);
    const r = await facade.save() as { saved: boolean };
    expect(r.saved).toBe(false);
});

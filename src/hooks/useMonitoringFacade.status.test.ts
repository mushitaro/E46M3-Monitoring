import { describe, expect, it } from 'vitest';
import { EMPTY_LEDGER } from '@tsunagi/monitoring-engine';
import { noProtocol } from '@tsunagi/monitoring-engine';
// A plain function of the screen's state (it calls no React hook), so it is called directly here.
import { useMonitoringFacade as monitoringFacade } from './useMonitoringFacade';

/**
 * monitoring_status says what the screen's module select says (operator, 2026-11-19). The app opens
 * with ALL MODULES chosen on DIAGNOSIS while the link's module is still the DME; the status used to
 * name the DME as `module`, and the assistant told the owner "MSS54 is selected" beside a screen
 * that said ALL MODULES.
 */
function status(over: { tab: string; allModules: boolean }) {
    const link = { mode: 'vehicle', state: 'disconnected', vehicleState: null, motion: 'unknown', fitment: new Map(), scanProgress: null, scan: null, error: null, faults: null, rawFaults: null, ident: null };
    const input = {
        link,
        ecuId: 'mss54',
        ecuIndex: null,
        catalog: null,
        target: noProtocol('mss54', 0x12),
        ledger: EMPTY_LEDGER,
        datalog: { current: () => [], isRunning: () => false, snapshot: () => ({ samples: [], segments: [] }) },
        sessions: {},
        probe: { progress: null, available: null },
        probeSessions: {},
        mode: 'manual',
        updateWaiting: false,
        defaultDevice: { headUnit: 'ナビ', phone: '電話', desktop: 'PC', tablet: 'タブレット' },
        ...over,
    };
    return monitoringFacade(input as unknown as Parameters<typeof monitoringFacade>[0]).status() as Record<string, unknown>;
}

describe('monitoring_status: the module is the screen’s selection', () => {
    it('ALL MODULES on DIAGNOSIS: no module is named as selected; the link’s module is said apart', () => {
        const s = status({ tab: 'diagnosis', allModules: true });
        expect(s).toMatchObject({ showing: 'all-modules', module: { id: null, name: 'ALL MODULES', all: true }, linkModule: { id: 'mss54' } });
        expect(JSON.stringify(s.module)).not.toMatch(/mss54/i);
    });

    it('a module chosen: that module, in both places', () => {
        const s = status({ tab: 'diagnosis', allModules: false });
        expect(s).toMatchObject({ showing: 'module', module: { id: 'mss54' }, linkModule: { id: 'mss54' } });
        expect((s.module as { all?: boolean }).all).toBeUndefined();
    });
});

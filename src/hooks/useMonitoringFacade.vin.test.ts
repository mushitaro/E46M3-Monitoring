import { describe, expect, it } from 'vitest';
import { EMPTY_LEDGER } from '@tsunagi/monitoring-engine';
import { noProtocol } from '@tsunagi/monitoring-engine';
import { PRACTICE_VIN_SHORT, clusterVinAnswer } from '@tsunagi/monitoring-engine';
import type { ScanRun } from '@tsunagi/monitoring-engine';
// A plain function of the screen's state (it calls no React hook), so it is called directly here.
import { useMonitoringFacade as monitoringFacade } from './useMonitoringFacade';

/**
 * The VIN never reaches the assistant (Matrix's privacy promise, and D5's): the cluster's VIN read in
 * a scan (lib/probe/scan `vin`) is for the store to match the car by, and for nothing else. The
 * facade is a plain function of the screen's state, so its answers are called here on a state that
 * holds a VIN in every place a scan can put one — made up, like every VIN in a test.
 */

const hex = (b: number[]) => b.map((x) => x.toString(16).padStart(2, '0')).join(' ');
const CLUSTER_ANSWER = hex(clusterVinAnswer(PRACTICE_VIN_SHORT)); // 02 4a 52 12 34 50

const scan: ScanRun = {
    startedAt: Date.UTC(2026, 10, 11, 8, 0, 0),
    endedAt: Date.UTC(2026, 10, 11, 8, 1, 0),
    end: 'done',
    results: [
        {
            address: '0x80',
            modules: ['kombi46', 'kombi46r'],
            outcome: 'answered',
            exchanges: [
                { request: '80 04 00 84', response: '09 99 99 99 01 00 60 00 12 03 00 00 00' },
                { request: '80 05 04 01 80', response: '00' },
            ],
            variant: { sgbd: 'KOMBI46R', moduleId: 'kombi46r', basis: 'identified' },
        },
    ],
    vin: { address: '0x80', moduleId: 'kombi46r', job: 'STATUS_AIF_FG_NR_LESEN', outcome: 'answered', vinShort: PRACTICE_VIN_SHORT },
};

function facade() {
    const link = {
        mode: 'practice',
        state: 'connected',
        vehicleState: null,
        motion: 'parked',
        fitment: new Map([[0x80, { address: 0x80, answer: '80 11 a0 09 99 99 99 01 00 60 00 12 03 00 00 00 00', sgbd: 'KOMBI46R', moduleId: 'kombi46r' }]]),
        scanProgress: null,
        scan,
        error: null,
        faults: null,
        rawFaults: null,
        ident: null,
    };
    const input = {
        link,
        ecuId: 'kombi46r',
        ecuIndex: null,
        catalog: null,
        target: noProtocol('kombi46r', 0x80),
        ledger: EMPTY_LEDGER,
        datalog: { current: () => [], snapshot: () => ({ samples: [] }) },
        sessions: {},
        probe: { progress: null, available: null },
        probeSessions: {},
        mode: 'manual',
        tab: 'diagnosis',
        updateWaiting: false,
        defaultDevice: { headUnit: 'ナビ', phone: '電話', desktop: 'PC', tablet: 'タブレット' },
    };
    return monitoringFacade(input as unknown as Parameters<typeof monitoringFacade>[0]);
}

/** The VIN in every spelling an answer could carry it: the seven in words, the cluster's bytes, the frame that asks. */
function spells(answer: unknown): string[] {
    const text = JSON.stringify(answer).toLowerCase();
    const forms = [PRACTICE_VIN_SHORT, CLUSTER_ANSWER, CLUSTER_ANSWER.replace(/ /g, ''), '4a 52 12 34', '80 05 02 02 85', 'STATUS_AIF_FG_NR_LESEN'];
    return forms.filter((f) => text.includes(f.toLowerCase()));
}

describe('the assistant’s answers after a scan that read the cluster’s VIN', () => {
    it('monitoring_status: the scan and the variants, never the VIN or where it came from', async () => {
        const status = await facade().status();
        expect(spells(status)).toEqual([]);
        expect(status).toMatchObject({ scan: { running: false, end: 'done' }, variants: { '0x80': 'KOMBI46R' } });
        expect(JSON.stringify(status)).not.toMatch(/vin/i);
    });

    it('monitoring_faults / monitoring_scan’s result: every module, its variant and fault bytes — not the VIN read', async () => {
        const faults = await facade().faults(undefined, undefined);
        expect(spells(faults)).toEqual([]);
        const modules = (faults as { scan: { modules: Array<Record<string, unknown>> } }).scan.modules;
        expect(modules).toHaveLength(1);
        expect(modules[0]).toMatchObject({ address: '0x80', outcome: 'answered', variant: { sgbd: 'KOMBI46R', carried: true } });
        // The fault read's bytes go; the IDENT and the VIN read do not.
        expect(modules[0].raw).toEqual([{ request: '80 05 04 01 80', response: '00' }]);
        expect(JSON.stringify(faults)).not.toMatch(/vin/i);
    });
});

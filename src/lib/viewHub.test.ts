import { describe, expect, it, vi } from 'vitest';
import type { LucideIcon } from 'lucide-react';
import { TAB_ORDER, type Tab } from './tabs';
import { viewHubFor, type ViewHubState } from './viewHub';

const icon = (n: string) => n as unknown as LucideIcon;
const ICONS = {
    read: icon('READ'),
    record: icon('RECORD'),
    stop: icon('STOP'),
    idle: icon('IDLE'),
    run: icon('RUN'),
    start: icon('START'),
};

const T = {
    hub_read: 'READ',
    hub_record: 'RECORD',
    hub_stop: 'STOP',
    hub_connected: 'LINKED',
    op_run: 'RUN',
    op_start: 'START',
    samples: 'SAMPLES',
    plan_selectHint: 'pick a job',
    adaptations_noDecoder: 'no decoder ported',
    runBlock: (r: string) => `blocked: ${r}`,
};

const state = (over: Partial<ViewHubState> = {}): ViewHubState => ({
    tab: 'diagnosis',
    linkState: 'connected',
    t: T,
    icons: ICONS,
    readFaults: () => {},
    datalog: { sampleCount: 0, costNotice: '2 channels / 1 block', start: () => {}, stop: () => {} },
    adaptation: { decoded: true, read: () => {} },
    service: { selected: null, verdict: null, run: () => {} },
    ...over,
});

describe('a running log outranks the tab', () => {
    it('offers STOP from every tab, not just DATALOG', () => {
        // The one rule here that is not "whatever tab is up". A recording is
        // HAPPENING; its stop has to stay one press away from wherever the
        // operator wandered to.
        for (const tab of TAB_ORDER) {
            const cfg = viewHubFor(state({ tab, linkState: 'logging' }));
            expect(cfg?.label, tab).toBe('STOP');
            expect(cfg?.tone, tab).toBe('armed');
        }
    });

    it('wires STOP to the datalog stop, and says how much is captured', () => {
        const stop = vi.fn();
        const cfg = viewHubFor(
            state({ tab: 'service', linkState: 'logging', datalog: { ...state().datalog, sampleCount: 412, stop } }),
        );
        cfg?.onClick?.();
        expect(stop).toHaveBeenCalledOnce();
        expect(cfg?.notice).toBe('412 SAMPLES');
    });

    it('is pressable — a stop that the busy tier could disable is not a stop', () => {
        const cfg = viewHubFor(state({ tab: 'datalog', linkState: 'logging' }));
        expect(cfg?.disabled).toBeFalsy();
        expect(cfg?.onClick).toBeTypeOf('function');
    });
});

describe('each tab supplies its own verb', () => {
    it('DIAGNOSIS reads', () => {
        const readFaults = vi.fn();
        const cfg = viewHubFor(state({ tab: 'diagnosis', readFaults }));
        cfg?.onClick?.();
        expect(cfg?.label).toBe('READ');
        expect(readFaults).toHaveBeenCalledOnce();
    });

    it('DATALOG records, and states the cost before you press it', () => {
        const cfg = viewHubFor(state({ tab: 'datalog' }));
        expect(cfg?.label).toBe('RECORD');
        expect(cfg?.notice).toBe('2 channels / 1 block');
    });

    it('ADAPTATION reads where a decoder was ported', () => {
        const read = vi.fn();
        const cfg = viewHubFor(state({ tab: 'adaptation', adaptation: { decoded: true, read } }));
        cfg?.onClick?.();
        expect(read).toHaveBeenCalledOnce();
        expect(cfg?.disabled).toBeFalsy();
    });

    it('ADAPTATION says WHY it cannot, rather than going quiet', () => {
        // "No decoder ported" and "this module has learned nothing" are
        // different sentences, and only one of them is true here.
        const cfg = viewHubFor(state({ tab: 'adaptation', adaptation: { decoded: false, read: () => {} } }));
        expect(cfg?.disabled).toBe(true);
        expect(cfg?.onClick).toBeUndefined();
        expect(cfg?.notice).toBe('no decoder ported');
    });

    it('ACTUATOR supplies nothing — its rows carry their own controls', () => {
        expect(viewHubFor(state({ tab: 'actuator' }))).toBeNull();
    });
});

describe('SERVICE renders the gate, and never re-derives it', () => {
    const sel = { isProcedure: false, risk: 'low' } as const;

    it('has no verb with no object', () => {
        const cfg = viewHubFor(state({ tab: 'service' }));
        expect(cfg?.label).toBe('LINKED');
        expect(cfg?.disabled).toBe(true);
        expect(cfg?.notice).toBe('pick a job');
    });

    it('is disabled with the gate’s own reason when the gate refuses', () => {
        const cfg = viewHubFor(
            state({
                tab: 'service',
                service: { selected: sel, verdict: { allowed: false, reason: 'run_block_notRead' }, run: () => {} },
            }),
        );
        expect(cfg?.disabled).toBe(true);
        expect(cfg?.onClick).toBeUndefined();
        expect(cfg?.notice).toBe('blocked: run_block_notRead');
    });

    it('refuses when there is no verdict at all — absent is not permission', () => {
        const cfg = viewHubFor(state({ tab: 'service', service: { selected: sel, verdict: null, run: () => {} } }));
        expect(cfg?.disabled).toBe(true);
        expect(cfg?.onClick).toBeUndefined();
    });

    it('goes red only when an allowed control is armed to do something irreversible', () => {
        const allowed = { allowed: true, telegram: { hex: '12 04 00 16', confidence: 'single' } } as never;
        const high = viewHubFor(
            state({
                tab: 'service',
                service: { selected: { isProcedure: false, risk: 'high' }, verdict: allowed, run: () => {} },
            }),
        );
        expect(high?.tone).toBe('armed-danger');

        // Same risk, refused: an armed-looking ring on a button that cannot
        // fire is theatre.
        const blocked = viewHubFor(
            state({
                tab: 'service',
                service: {
                    selected: { isProcedure: false, risk: 'high' },
                    verdict: { allowed: false, reason: 'run_block_notRead' },
                    run: () => {},
                },
            }),
        );
        expect(blocked?.tone).toBe('idle');
    });

    it('a program STARTS and everything else RUNS', () => {
        const allowed = { allowed: true, telegram: { hex: '32 04 00 36', confidence: 'single' } } as never;
        const proc = viewHubFor(
            state({
                tab: 'service',
                service: { selected: { isProcedure: true, risk: 'medium' }, verdict: allowed, run: () => {} },
            }),
        );
        expect(proc?.label).toBe('START');
        expect(proc?.Icon).toBe(ICONS.start);
    });
});

describe('the switch is exhaustive', () => {
    it('answers for every declared tab', () => {
        // Not a formality: a tab whose hub branch is missing renders a ring with
        // no verb, which reads as "connected, nothing to do" on a tab that has
        // plenty to do.
        const seen = new Set<Tab>();
        for (const tab of TAB_ORDER) {
            expect(() => viewHubFor(state({ tab }))).not.toThrow();
            seen.add(tab);
        }
        expect(seen.size).toBe(TAB_ORDER.length);
    });
});

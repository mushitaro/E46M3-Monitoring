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
    probe: icon('PROBE'),
    next: icon('NEXT'),
    save: icon('SAVE'),
};

const T = {
    hub_read: 'READ',
    hub_record: 'RECORD',
    hub_stop: 'STOP',
    hub_connected: 'LINKED',
    op_run: 'RUN',
    op_start: 'START',
    samples: 'SAMPLES',
    hub_pickRow: 'pick a row',
    hub_actuatorRows: 'start a row',
    hub_noReadFrame: 'no frame for this module',
    hub_dmeOnly: 'no live-block layout',
    next_session: 'NEXT',
    probe_notRunnable: 'no plan may run',
    runBlock: (r: string) => `blocked: ${r}`,
};

const state = (over: Partial<ViewHubState> = {}): ViewHubState => ({
    tab: 'diagnosis',
    linkState: 'connected',
    t: T,
    icons: ICONS,
    readFaults: () => {},
    faultsAvailable: true,
    datalog: { decoded: true, sampleCount: 0, start: () => {}, stop: () => {} },
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

    it('a PROBE run stops through its own stop and reports its own line', () => {
        const stop = vi.fn();
        const datalogStop = vi.fn();
        const cfg = viewHubFor(
            state({
                tab: 'diagnosis',
                linkState: 'logging',
                probe: { line: 'PROBE v2 · 1/3 · 40 samples', stop },
                datalog: { ...state().datalog, stop: datalogStop },
            }),
        );
        cfg?.onClick?.();
        expect(stop).toHaveBeenCalledOnce();
        expect(datalogStop).not.toHaveBeenCalled();
        expect(cfg?.label).toBe('STOP');
        expect(cfg?.notice).toBe('PROBE v2 · 1/3 · 40 samples');
    });

    it('keeps STOP while PROBE waits between runs to begin again after the line dropped', () => {
        const stop = vi.fn();
        const cfg = viewHubFor(state({ tab: 'probe', linkState: 'connected', probe: { line: 'PROBE v1 · line dropped · resuming (1/3)', stop } }));
        cfg?.onClick?.();
        expect(stop).toHaveBeenCalledOnce();
        expect(cfg?.label).toBe('STOP');
        expect(cfg?.notice).toBe('PROBE v1 · line dropped · resuming (1/3)');
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

    it('DIAGNOSIS with ALL MODULES reads every module, and counts the scan on the notice line', () => {
        const readFaults = vi.fn();
        const run = vi.fn();
        const cfg = viewHubFor(state({ tab: 'diagnosis', readFaults, faultsAvailable: false, scan: { run, line: 'Scanning 3 / 37' } }));
        cfg?.onClick?.();
        expect(cfg).toMatchObject({ label: 'READ', tone: 'ready', notice: 'Scanning 3 / 37' });
        expect(run).toHaveBeenCalledOnce();
        expect(readFaults).not.toHaveBeenCalled();
    });

    it('DATALOG records; the cost is MAIN\'s, and the line says what the last STOP left', () => {
        const cfg = viewHubFor(state({ tab: 'datalog' }));
        expect(cfg?.label).toBe('RECORD');
        expect(cfg?.notice).toBeUndefined();
        const after = viewHubFor(state({ tab: 'datalog', datalog: { ...state().datalog, stoppedLine: 'stopped · 0:58 · 4006' } }));
        expect(after?.notice).toBe('stopped · 0:58 · 4006');
    });

    it('ADAPTATION reads where a decoder was ported', () => {
        const read = vi.fn();
        const cfg = viewHubFor(state({ tab: 'adaptation', adaptation: { decoded: true, read } }));
        cfg?.onClick?.();
        expect(read).toHaveBeenCalledOnce();
        expect(cfg?.disabled).toBeFalsy();
    });

    it('ADAPTATION cannot read where no decoder was ported, and does not repeat MAIN\'s sentence', () => {
        const cfg = viewHubFor(state({ tab: 'adaptation', adaptation: { decoded: false, read: () => {} } }));
        expect(cfg?.disabled).toBe(true);
        expect(cfg?.onClick).toBeUndefined();
        expect(cfg?.notice).toBeUndefined();
    });

    it('ACTUATOR shows its verb, not a dead LINKED ring; its rows start what they drive', () => {
        const cfg = viewHubFor(state({ tab: 'actuator' }));
        expect(cfg).toMatchObject({ label: 'RUN', disabled: true, notice: 'start a row' });
    });

    it('MEMORY saves, and keeps the ring without a link', () => {
        const save = vi.fn();
        const cfg = viewHubFor(state({ tab: 'memory', linkState: 'disconnected', memory: { label: 'SAVE', disabled: false, save } }));
        expect(cfg).toMatchObject({ label: 'SAVE', tone: 'ready', offline: true });
        cfg?.onClick?.();
        expect(save).toHaveBeenCalledOnce();
        const none = viewHubFor(state({ tab: 'memory', memory: { label: 'NOTHING YET', disabled: true, save } }));
        expect(none).toMatchObject({ disabled: true, onClick: undefined });
    });
});

describe('SERVICE renders the gate, and never re-derives it', () => {
    const sel = { isProcedure: false, risk: 'low' } as const;

    it('shows its verb waiting for an object, not a dead LINKED ring', () => {
        const cfg = viewHubFor(state({ tab: 'service' }));
        expect(cfg?.label).toBe('RUN');
        expect(cfg?.disabled).toBe(true);
        expect(cfg?.notice).toBe('pick a row');
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

describe('a module is offered only what its own SGBD lets the app send it', () => {
    it('does not offer READ on a module with no IDENT or fault-read frame, and says why', () => {
        const readFaults = vi.fn();
        const cfg = viewHubFor(state({ tab: 'diagnosis', faultsAvailable: false, readFaults }));
        expect(cfg).toMatchObject({ disabled: true, tone: 'idle', notice: 'no frame for this module' });
        cfg?.onClick?.();
        expect(readFaults).not.toHaveBeenCalled();
    });

    it('does not offer RECORD on a module whose live blocks it cannot decode', () => {
        const start = vi.fn();
        const cfg = viewHubFor(state({ tab: 'datalog', datalog: { ...state().datalog, decoded: false, start } }));
        expect(cfg).toMatchObject({ disabled: true, notice: 'no live-block layout' });
        cfg?.onClick?.();
        expect(start).not.toHaveBeenCalled();
    });
});

describe('PROBE', () => {
    it('runs the session on the screen from the board, and says why not when it may not', () => {
        const run = vi.fn();
        const ok = viewHubFor(state({ tab: 'probe', probeRun: { runnable: true, run } }));
        expect(ok).toMatchObject({ label: 'START', tone: 'ready' });
        ok?.onClick?.();
        expect(run).toHaveBeenCalled();
        const no = viewHubFor(state({ tab: 'probe', probeRun: { runnable: false, run } }));
        expect(no).toMatchObject({ disabled: true, notice: 'no plan may run' });
    });

    it('STARTUP\'s ring is NEXT, without a link too, and says why it cannot go yet', () => {
        const next = vi.fn();
        const ok = viewHubFor(state({ tab: 'startup', linkState: 'disconnected', startup: { next, blocked: null } }));
        expect(ok).toMatchObject({ label: 'NEXT', tone: 'ready', offline: true });
        ok?.onClick?.();
        expect(next).toHaveBeenCalledOnce();
        const no = viewHubFor(state({ tab: 'startup', startup: { next, blocked: 'no session' } }));
        expect(no).toMatchObject({ disabled: true, notice: 'no session' });
    });

    it('a board with no session still shows START, disabled, with the reason', () => {
        expect(viewHubFor(state({ tab: 'probe' }))).toMatchObject({ label: 'START', disabled: true, notice: 'no plan may run' });
    });
});

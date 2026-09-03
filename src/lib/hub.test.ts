import { describe, expect, it, vi } from 'vitest';
import type { LucideIcon } from 'lucide-react';
import { hubConfigFor, hubNoticeFor, type HubState } from './hub';
import type { HubConfig } from '@/components/Hub';

// Stand-ins. The point of injecting the icons is that this file needs no React
// and no lucide bundle to check the decision.
const PLUG = 'PLUG' as unknown as LucideIcon;
const LOADER = 'LOADER' as unknown as LucideIcon;
const IDLE = 'IDLE' as unknown as LucideIcon;
const VIEW_ICON = 'VIEW' as unknown as LucideIcon;

const T = {
    hub_connect: 'CONNECT',
    hub_connecting: 'OPENING',
    hub_busy: 'BUSY',
    hub_connected: 'LINKED',
    mode_practice: 'PRACTICE',
};

const state = (over: Partial<HubState> = {}): HubState => ({
    linkState: 'connected',
    practiceArmed: false,
    fromView: null,
    connect: () => {},
    t: T,
    icons: { plug: PLUG, loader: LOADER, idle: IDLE },
    ...over,
});

const viewCfg: HubConfig = {
    label: 'READ',
    Icon: VIEW_ICON,
    tone: 'ready',
    onClick: () => {},
    notice: 'reads ident and faults',
};

describe('tier 1 — the link answers before any view does', () => {
    it('offers CONNECT when there is no link', () => {
        const c = hubConfigFor(state({ linkState: 'disconnected', fromView: viewCfg }));
        expect(c.label).toBe('CONNECT');
        expect(c.Icon).toBe(PLUG);
        expect(c.disabled).toBeFalsy();
    });

    it('says which link CONNECT opens, and passes the choice through', () => {
        const connect = vi.fn();
        const armed = hubConfigFor(state({ linkState: 'disconnected', practiceArmed: true, connect }));
        expect(armed.notice).toBe('PRACTICE');
        expect(armed.tone).toBe('ready');
        armed.onClick!();
        expect(connect).toHaveBeenCalledWith('practice');

        const real = hubConfigFor(state({ linkState: 'disconnected', connect }));
        expect(real.notice).toBeUndefined();
        real.onClick!();
        expect(connect).toHaveBeenCalledWith('vehicle');
    });

    it('spins the LOADER glyph while connecting, never the state’s own', () => {
        // A plug or a bolt has an obvious "up". Rotated end over end it reads as
        // a broken icon, at the moment the operator most needs to trust the tool.
        const c = hubConfigFor(state({ linkState: 'connecting' }));
        expect(c.Icon).toBe(LOADER);
        expect(c.spin).toBe(true);
        expect(c.disabled).toBe(true);
    });
});

describe('busy keeps the view’s verb, without keeping a copy of it', () => {
    it('wears the view’s label and is not pressable', () => {
        const c = hubConfigFor(state({ linkState: 'busy', fromView: viewCfg }));
        expect(c.label).toBe('READ');
        expect(c.Icon).toBe(VIEW_ICON);
        expect(c.tone).toBe('busy');
        expect(c.disabled).toBe(true);
    });

    it('drops the view’s handler, so a disabled hub cannot fire it', () => {
        // The predecessor spread the cached config and set `disabled`, leaving
        // onClick attached. Disabled is a DOM attribute; a handler still on the
        // element is one bug away from running.
        const onClick = vi.fn();
        const c = hubConfigFor(state({ linkState: 'busy', fromView: { ...viewCfg, onClick } }));
        expect(c.onClick).toBeUndefined();
    });

    it('falls back to a generic spinner when the view offers nothing', () => {
        const c = hubConfigFor(state({ linkState: 'busy', fromView: null }));
        expect(c.label).toBe('BUSY');
        expect(c.Icon).toBe(LOADER);
        expect(c.spin).toBe(true);
    });
});

describe('tier 2 and tier 3', () => {
    it('hands the view’s config straight through when the link is free', () => {
        expect(hubConfigFor(state({ fromView: viewCfg }))).toBe(viewCfg);
    });

    it('says LINKED, disabled, when the view has nothing to offer', () => {
        const c = hubConfigFor(state({ fromView: null }));
        expect(c.label).toBe('LINKED');
        expect(c.disabled).toBe(true);
        expect(c.onClick).toBeUndefined();
    });

    it('never returns a config without a label or a tone', () => {
        const states: HubState['linkState'][] = [
            'disconnected',
            'connecting',
            'connected',
            'busy',
            'logging',
        ];
        for (const linkState of states) {
            for (const fromView of [null, viewCfg]) {
                const c = hubConfigFor(state({ linkState, fromView }));
                expect(c.label).toBeTruthy();
                expect(c.tone).toBeTruthy();
            }
        }
    });
});

describe('the notice line picks one text, in a fixed order', () => {
    it('a link error outranks everything', () => {
        expect(
            hubNoticeFor({
                linkError: 'no reply',
                catalogError: 'catalogue',
                busyLabel: 'reading',
                viewNotice: 'hint',
            }),
        ).toEqual({ text: 'no reply', tone: 'error' });
    });

    it('then the catalogue, then what is in flight, then the view', () => {
        expect(hubNoticeFor({ catalogError: 'c', busyLabel: 'b', viewNotice: 'v' })).toEqual({
            text: 'c',
            tone: 'warn',
        });
        expect(hubNoticeFor({ busyLabel: 'b', viewNotice: 'v' })).toEqual({ text: 'b', tone: 'info' });
        expect(hubNoticeFor({ viewNotice: 'v' })).toEqual({ text: 'v', tone: 'info' });
    });

    it('returns a tone even with nothing to say, so the row keeps its height', () => {
        expect(hubNoticeFor({})).toEqual({ text: undefined, tone: 'info' });
    });
});

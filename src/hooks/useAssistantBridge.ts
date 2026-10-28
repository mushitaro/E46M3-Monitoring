'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { BridgeClient, type BridgeStatus, type Hello } from '@/lib/bridge/bridgeClient';
import { loadGuide, type HelloGuide } from '@/lib/bridge/guide';
import { bridgeHandlers, type TabFacade } from '@/lib/bridge/handlers';
import { helloTools } from '@/lib/bridge/tools';

/**
 * ASSISTANT — whether the owner's assistant can reach this tab, and how that is going.
 *
 * Ported from TUNER (src/hooks/useAssistantBridge.ts there), with the same keys, so the switch and
 * the device name behave the same in both apps. What MONITORING adds is the hello's catalog: the
 * tools (lib/bridge/tools) and the guide (public/guide), read once per socket.
 *
 * Off until the owner switches it on, on this device. Remembered per device (localStorage), because
 * the device this exists for is a head unit that cold-boots with every key cycle: an owner who
 * turned it on there should not have to find the switch again before each drive.
 *
 * `allowed` is the WORKS build with its first-run notice confirmed — the same two conditions every
 * send in this build waits on (`canSync` in lib/sync/cloud). Not allowed means not even read: the
 * production build writes and reads no key its privacy policy does not name.
 *
 * The facade is the page's, rebuilt every render; the client reads the newest one when a call
 * arrives, so the socket is never reopened because the page re-rendered.
 */
export const ASSISTANT_KEY = 'assistant-bridge:v1';
/** The name the owner gives this device ("ナビ"), so the assistant — and another device's tab — can
 *  say which device answers. Per device, like the switch. */
export const DEVICE_KEY = 'assistant-bridge:device';
/** A random id this device keeps, so the relay can tell this device's own stale socket from another
 *  device's and replace it at once (2026-10-28). Says nothing about the device or its owner. */
export const DEVICE_ID_KEY = 'assistant-bridge:id';
/** Set once on the head unit: the launcher opened this build, which the relay gives the bridge to. */
export const NAV_KEY = 'assistant-bridge:nav';
/** What the launcher (E46M3-Launcher, a Trusted Web Activity) leaves as the referrer of the first page. */
export const LAUNCHER_REFERRER = 'android-app://app.tsunagi.e46m3.launcher';
const MAX_DEVICE_NAME = 24;

/** This page's answers when storage refuses, so the switch and the name still work for the session. */
let memoryOn: boolean | null = null;
let memoryDevice: string | null | undefined;
const listeners = new Set<() => void>();
const subscribe = (cb: () => void) => {
    listeners.add(cb);
    return () => {
        listeners.delete(cb);
    };
};
const notify = () => listeners.forEach((cb) => cb());

const readOn = (): boolean => {
    if (memoryOn !== null) return memoryOn;
    try {
        return localStorage.getItem(ASSISTANT_KEY) === 'on';
    } catch {
        return false;
    }
};

export function readDeviceName(): string | null {
    if (memoryDevice !== undefined) return memoryDevice;
    try {
        return localStorage.getItem(DEVICE_KEY)?.trim().slice(0, MAX_DEVICE_NAME) || null;
    } catch {
        return null;
    }
}

export type DeviceKind = 'nav' | 'phone' | 'pc';

const tryGet = (key: string): string | null => {
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
};
const trySet = (key: string, value: string) => {
    try {
        localStorage.setItem(key, value);
    } catch {
        /* this page keeps it in memory instead */
    }
};

let memoryId: string | null = null;

/** This device's id: made once, kept per device, 22 URL-safe characters. */
export function deviceId(): string {
    const kept = tryGet(DEVICE_ID_KEY) ?? memoryId;
    if (kept && /^[A-Za-z0-9_-]{16,64}$/.test(kept)) return kept;
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    const id = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    memoryId = id;
    trySet(DEVICE_ID_KEY, id);
    return id;
}

/** Whether this is the head unit: remembered from the first page the launcher opened. */
export function isHeadUnit(): boolean {
    if (tryGet(NAV_KEY) === '1') return true;
    if (typeof document !== 'undefined' && document.referrer.startsWith(LAUNCHER_REFERRER)) {
        trySet(NAV_KEY, '1');
        return true;
    }
    return false;
}

/** The head unit, a phone or a computer — for the name a device answers as when it has none. */
export function deviceKind(): DeviceKind {
    if (isHeadUnit()) return 'nav';
    const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
    return coarse ? 'phone' : 'pc';
}

/** The name this device answers as: the owner's, or the default for its kind. */
export function deviceLabel(defaults: Record<DeviceKind, string>): string {
    return readDeviceName() ?? defaults[deviceKind()];
}

export function useAssistantBridge(input: {
    allowed: boolean;
    facade: TabFacade;
    hello: Pick<Hello, 'build' | 'variant'>;
    /** The names a device answers as when the owner has given it none (i18n). */
    defaultDevice: Record<DeviceKind, string>;
}) {
    const { allowed, facade, hello } = input;
    // Stores rather than state set from an effect: read only while allowed, never during the
    // prerender (the server snapshot is "off"), and every mount agrees.
    const on = useSyncExternalStore(subscribe, useCallback(() => allowed && readOn(), [allowed]), () => false);
    const device = useSyncExternalStore(subscribe, useCallback(() => (allowed ? readDeviceName() : null), [allowed]), () => null);
    const [status, setStatus] = useState<BridgeStatus>({ state: 'off', detail: null, calls: 0 });
    const clientRef = useRef<BridgeClient | null>(null);
    const facadeRef = useRef(facade);
    const helloRef = useRef(hello);
    const defaultsRef = useRef(input.defaultDevice);
    useEffect(() => {
        facadeRef.current = facade;
        helloRef.current = hello;
        defaultsRef.current = input.defaultDevice;
    });

    // The launcher's referrer is on the first page it opens and on no later one: look while it is there.
    useEffect(() => {
        if (allowed) isHeadUnit();
    }, [allowed]);

    const setOn = useCallback(
        (next: boolean) => {
            if (!allowed) return;
            try {
                if (next) localStorage.setItem(ASSISTANT_KEY, 'on');
                else localStorage.removeItem(ASSISTANT_KEY);
                memoryOn = null;
            } catch {
                memoryOn = next;
            }
            notify();
        },
        [allowed],
    );

    useEffect(() => {
        if (!allowed || !on) return;
        let guide: Promise<HelloGuide> | null = null;
        const client = new BridgeClient({
            ticketUrl: '/api/bridge/ticket',
            handlers: () => bridgeHandlers(facadeRef.current),
            hello: async () => {
                // Read again on a later socket if it failed; once it has loaded, the same text.
                guide ??= loadGuide().catch((e: unknown) => {
                    guide = null;
                    throw e;
                });
                return { ...helloRef.current, tools: helloTools(), guide: await guide, device: deviceLabel(defaultsRef.current) };
            },
            device: () => ({ id: deviceId(), nav: isHeadUnit() }),
            onStatus: setStatus,
        });
        clientRef.current = client;
        client.start();
        return () => {
            client.stop();
            clientRef.current = null;
        };
    }, [allowed, on]);

    const takeover = useCallback(() => clientRef.current?.takeover(), []);
    // Saved as typed; the next hello carries it (a held or live tab says hello again on its next
    // socket, which a switch-here or the next reconnect opens).
    const setDevice = useCallback(
        (name: string) => {
            if (!allowed) return;
            const clean = name.trim().slice(0, MAX_DEVICE_NAME);
            try {
                if (clean) localStorage.setItem(DEVICE_KEY, clean);
                else localStorage.removeItem(DEVICE_KEY);
                memoryDevice = undefined;
            } catch {
                memoryDevice = clean || null;
            }
            notify();
        },
        [allowed],
    );

    return { allowed, on, setOn, takeover, device, setDevice, status: on ? status : ({ state: 'off', detail: null, calls: 0 } as BridgeStatus) };
}

export type AssistantBridge = ReturnType<typeof useAssistantBridge>;

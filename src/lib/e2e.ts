'use client';

import { useEffect, useRef } from 'react';
import { bridgeHandlers, type TabFacade } from './bridge/handlers';
import { appNow, learnServerTime, resetClock } from '@tsunagi/monitoring-engine';
import { practiceCar, resetPracticeCar, type PracticeCar } from '@tsunagi/monitoring-engine';

/**
 * The end-to-end test build's door (tools/e2e): only a build made with
 * `NEXT_PUBLIC_MONITORING_E2E=1` carries it, and `npm run deploy` never makes one —
 * verify-export fails a deploy build that does.
 *
 * It lets the scenario runner do two things a person and an assistant do, from the page itself:
 *   - call the assistant's tools, through the same handlers the relay calls (lib/bridge/handlers),
 *     so a scenario is the assistant operating the real screen;
 *   - set the practice car (lib/practiceCar) — a fault in a module, a drive at some speed — before
 *     or during a scenario, behind the real transport and link.
 * Nothing here sends to a car: the only link a test build opens is PRACTICE's.
 */
export const E2E = process.env.NEXT_PUBLIC_MONITORING_E2E === '1';

export interface E2EDoor {
    tool(name: string, args?: Record<string, unknown>): Promise<unknown>;
    car: {
        get(): PracticeCar;
        set(patch: Partial<PracticeCar>): PracticeCar;
        reset(): void;
    };
    /** The page's clock (lib/clock): as if it had not heard the server yet, then as if it just had. */
    clock: {
        forget(): void;
        /** Hear the server say it is `iso`; returns the step taken. */
        hear(iso: string): number;
        now(): number;
    };
}

declare global {
    interface Window {
        __monitoringE2E?: E2EDoor;
    }
}

/** Installs the door on a test build; does nothing on any other. The facade is read when a call arrives. */
export function useE2EDoor(facade: TabFacade): void {
    const latest = useRef(facade);
    useEffect(() => {
        latest.current = facade;
    });
    useEffect(() => {
        if (!E2E) return;
        window.__monitoringE2E = {
            tool: async (name, args = {}) => {
                const handler = (bridgeHandlers(latest.current) as Record<string, (a: Record<string, unknown>) => Promise<unknown>>)[name];
                if (!handler) throw new Error(`No tool named ${name}.`);
                return handler(args);
            },
            car: {
                get: () => structuredClone(practiceCar),
                set: (patch) => structuredClone(Object.assign(practiceCar, patch)),
                reset: resetPracticeCar,
            },
            clock: {
                forget: resetClock,
                hear: (iso) => {
                    const now = appNow();
                    return learnServerTime(new Date(iso).toUTCString(), now, now);
                },
                now: appNow,
            },
        };
        return () => {
            delete window.__monitoringE2E;
        };
    }, []);
}

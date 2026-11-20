/**
 * The link's refusal just before sending (engine link/notSent), said with what was measured then:
 * one function for the assistant's sentence and one for the screen's, from the same shape, so the two
 * cannot tell different stories (U2, U3; IJ F06). The screen's goes through the i18n table.
 *
 * Pure, so vitest (node) holds it.
 */
import type { NotSent } from '@tsunagi/monitoring-engine';

const v1 = (v: number | null | undefined) => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(1) : null);

/** The assistant's sentence (it answers in English and speaks the owner's language). */
export function notSentSentence(ns: NotSent): string {
    const m = ns.measured;
    const minV = m.minVoltageV ?? 12;
    switch (ns.reason) {
        case 'moving':
            return `Not sent: the car is moving (${m.speedKmh ?? '?'} km/h, measured just before sending). It runs only parked: ask again once the car has stopped.`;
        case 'voltage':
            return v1(m.voltageV)
                ? `Not sent: the battery reads ${v1(m.voltageV)} V, under ${minV} V. It runs at ${minV} V or more (engine running or a charger on).`
                : `Not sent: the battery voltage could not be read. It runs at ${minV} V or more.`;
        case 'engine':
            return m.engineWanted === 'off'
                ? `Not sent: its SGBD asks for the engine stopped, and it reads ${m.rpm ?? '?'} rpm. Stop the engine, then ask again.`
                : `Not sent: its SGBD asks for the engine running, and it reads ${m.rpm ?? '?'} rpm. Start the engine, then ask again.`;
        case 'link':
            return `Not sent: the car's state (standstill, battery) could not be measured over the line. Check the connection and ask again.`;
        case 'permission':
            return `Not sent: the gate's permit does not cover these bytes (${ns.message}).`;
    }
}

/** The words the screen uses, from the i18n table (ja / en). */
export interface NotSentWords {
    notSent_moving: (kmh: string) => string;
    notSent_voltage: (v: string, min: string) => string;
    notSent_voltageUnread: (min: string) => string;
    notSent_engineOff: (rpm: string) => string;
    notSent_engineOn: (rpm: string) => string;
    notSent_link: string;
    notSent_permission: string;
}

/** The screen's line for a refusal at the wire. */
export function notSentLine(ns: NotSent, t: NotSentWords): string {
    const m = ns.measured;
    const min = String(m.minVoltageV ?? 12);
    switch (ns.reason) {
        case 'moving':
            return t.notSent_moving(m.speedKmh === null || m.speedKmh === undefined ? '—' : String(m.speedKmh));
        case 'voltage':
            return v1(m.voltageV) ? t.notSent_voltage(v1(m.voltageV)!, min) : t.notSent_voltageUnread(min);
        case 'engine':
            return m.engineWanted === 'off' ? t.notSent_engineOff(String(m.rpm ?? '—')) : t.notSent_engineOn(String(m.rpm ?? '—'));
        case 'link':
            return t.notSent_link;
        case 'permission':
            return t.notSent_permission;
    }
}

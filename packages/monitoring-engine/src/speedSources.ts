/**
 * Where each car's road speed could be read from, for the stationary check before a read that may go
 * only parked (link/session.ts `preflight`).
 *
 * On an M3 it is the MSS54's live block 19 (`v`, `v_asc`), read on cars since TUNER. On an E46 that is
 * not an M3 the DME is another SGBD, and its own SGBD names a speed job; the early cluster (KOMBI46) has
 * one too. The later cluster (KOMBI46R) has none: no job of its SGBD returns a speed, so on a car whose
 * 0x80 IDENT chose KOMBI46R the cluster is not a source (`speedSourcesFor`).
 *
 * Which bytes of the answer are the speed is the module's own SGBD's to say: `speedFromAnswer` runs the
 * job's own code (sgbd/results) on the answer and takes the result the job names, only when the job read
 * the answer to its end, using the same payload boundary as recorded telemetry.
 * EdiabasLib independently decoded the speed and idle-adaptation practice responses of
 * MS420DS0, MS430DS0 and both BMS46 variants. These sources remain closed on cars until
 * the stationary and moving readings have been confirmed on the fitted hardware.
 *
 * To open one: confirm on a car that the job's own reading gives the speed (and 0 standing still), then
 * set `usable` with the evidence in `provenance`. That change is a person's (autonomy:human).
 */

import { decodeRead, telemetryValues, type SgbdResultsTable } from './sgbd/results.ts';

export interface SpeedSource {
    /** The module whose own SGBD sends the frame. */
    moduleId: string;
    /** The SGBD's job that answers with the speed among its results. */
    job: string;
    /** The frame its telegram table carries for the job (checksum included). */
    frame: string;
    /** The result the SGBD names for the speed. */
    result: string;
    /** May the preflight use it? Only once a car has confirmed the bytes. */
    usable: boolean;
    provenance: string;
}

/** The early cluster's speed. KOMBI46R, the later cluster, has no speed among any job's results. */
const KOMBI46_SPEED: SpeedSource = {
    moduleId: 'kombi46',
    job: 'STATUS_ANALOG_LESEN',
    frame: '80 05 0b 0a 84',
    result: 'STAT_GESCHWINDIGKEIT_WERT',
    usable: false,
    provenance: 'named by KOMBI46; its own job reads data bytes 8–9 (sgbd/vm, 2026-11-15), no car yet',
};

/** By the DME the car's 0x12 IDENT chose (lib/variants). */
export const SPEED_SOURCES: Readonly<Record<string, readonly SpeedSource[]>> = {
    mss54: [
        { moduleId: 'mss54', job: 'LIVE_19', frame: '12 05 0b 13 0f', result: '19:v', usable: true, provenance: 'MSS54 live block 19, read on cars (TUNER; MONITORING preflight since 2026-10-27)' },
    ],
    // MS42 and MS43 (M52TU, M54): the DME's own speed job, or the early cluster's (KOMBI46 STATUS_ANALOG_LESEN).
    ms420ds0: [
        { moduleId: 'ms420ds0', job: 'STATUS_GESCHWINDIGKEIT', frame: '12 05 0b 03 1f', result: 'STAT_GESCHWINDIGKEIT_WERT', usable: false, provenance: 'EdiabasLib speed response verified in simulation; physical validation pending' },
        KOMBI46_SPEED,
    ],
    ms430ds0: [
        { moduleId: 'ms430ds0', job: 'STATUS_GESCHWINDIGKEIT', frame: '12 0b 70 00 00 00 00 7d 18 1d 11', result: 'STAT_GESCHWINDIGKEIT_WERT', usable: false, provenance: 'catalogue candidate; practice uses the independent interpreter request, physical validation pending' },
        KOMBI46_SPEED,
    ],
    // M43 (BMS43, BMS46): the DME's own speed job, or the early cluster's.
    bms43ds0: [
        { moduleId: 'bms43ds0', job: 'STATUS_GESCHWINDIGKEIT', frame: '12 05 0b 03 1f', result: 'STATUS_GESCHWINDIGKEIT_WERT', usable: false, provenance: 'named by BMS43DS0; its own job reads data byte 6 as km/h (sgbd/vm, 2026-11-15), no car yet' },
        KOMBI46_SPEED,
    ],
    bms46ds0: [
        { moduleId: 'bms46ds0', job: 'STATUS_GESCHWINDIGKEIT', frame: '12 05 0b 03 1f', result: 'STAT_GESCHWINDIGKEIT_WERT', usable: false, provenance: 'EdiabasLib speed response verified in simulation; physical validation pending' },
        KOMBI46_SPEED,
    ],
    bms46ds1: [
        { moduleId: 'bms46ds1', job: 'STATUS_GESCHWINDIGKEIT', frame: '12 05 0b 03 1f', result: 'STAT_GESCHWINDIGKEIT_WERT', usable: false, provenance: 'EdiabasLib speed response verified in simulation; physical validation pending' },
        KOMBI46_SPEED,
    ],
};

/** The source the preflight may read for this DME, or null: then the car cannot be shown to be stationary. */
export function usableSpeedSource(dmeModuleId: string | null): SpeedSource | null {
    return (dmeModuleId ? SPEED_SOURCES[dmeModuleId] : undefined)?.find((s) => s.usable) ?? null;
}

/**
 * The sources a car offers, by the DME its 0x12 IDENT chose and the cluster its 0x80 IDENT chose: a
 * cluster source counts only where that cluster's SGBD is the one at 0x80.
 */
export function speedSourcesFor(dmeModuleId: string | null, clusterModuleId: string | null): SpeedSource[] {
    const all = (dmeModuleId ? SPEED_SOURCES[dmeModuleId] : undefined) ?? [];
    return all.filter((s) => !s.frame.startsWith('80 ') || s.moduleId === clusterModuleId);
}

/**
 * The speed in an answer to a source's frame, read by the module's own job (sgbd/results): the result
 * the source names, when the job read the answer to its end and called it OKAY. Null otherwise —
 * no code for the job, a stop in its code, another status, or no such number among its results.
 */
export function speedFromAnswer(source: SpeedSource, table: SgbdResultsTable | null, answer: Uint8Array): number | null {
    if (!table || table.module !== source.moduleId) return null;
    const read = decodeRead(table, source.job, source.frame, answer);
    if (!read || read.stopped || read.status !== 'OKAY') return null;
    const v = telemetryValues(table, source.job, source.frame, answer).find(x => x.name === source.result && x.unit?.toLowerCase() === 'km/h')?.value;
    return typeof v === 'number' && v >= 0 ? v : null;
}

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
 * the answer to its end. Run that way (2026-11-15, on answers built here, not yet a car's):
 *  - KOMBI46 STATUS_ANALOG_LESEN reads the speed from data bytes 8–9; zeros read 0 km/h.
 *  - BMS43DS0 STATUS_GESCHWINDIGKEIT reads it from data byte 6, km/h as the byte; zeros read 0.
 *  - MS420DS0, BMS46DS0, BMS46DS1: their job stops in its own code (a compare on an empty string, where
 *    EDIABAS's behaviour is not yet measured in sgbd/vm), so nothing is read from them yet.
 *  - MS430DS0: its job uses an instruction (0x6a) sgbd/vm does not run, before it sends.
 *
 * **None of them is used** (plan Phase 4-5: closed until a car confirms it). The consequence is
 * deliberate: on those cars the preflight reads nothing it trusts, says `unknown`, and every parked-only
 * read and the fault clear stay unsent. The IDENT and each module's own fault read do not wait on the
 * speed (runGate `fault-read`, operator 2026-11-04), so an intake check still works.
 *
 * To open one: confirm on a car that the job's own reading gives the speed (and 0 standing still), then
 * set `usable` with the evidence in `provenance`. That change is a person's (autonomy:human).
 */

import { decodeRead, type SgbdResultsTable } from './sgbd/results.ts';

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
        { moduleId: 'ms420ds0', job: 'STATUS_GESCHWINDIGKEIT', frame: '12 05 0b 03 1f', result: 'STAT_GESCHWINDIGKEIT_WERT', usable: false, provenance: 'named by MS420DS0; its own job stops before the value (sgbd/vm), no car yet' },
        KOMBI46_SPEED,
    ],
    ms430ds0: [
        { moduleId: 'ms430ds0', job: 'STATUS_GESCHWINDIGKEIT', frame: '12 0b 70 00 00 00 00 7d 18 1d 11', result: 'STAT_GESCHWINDIGKEIT_WERT', usable: false, provenance: 'named by MS430DS0 (a 0x70 frame its telegram table carries more than one of); its own job does not run in sgbd/vm yet, no car yet' },
        KOMBI46_SPEED,
    ],
    // M43 (BMS43, BMS46): the DME's own speed job, or the early cluster's.
    bms43ds0: [
        { moduleId: 'bms43ds0', job: 'STATUS_GESCHWINDIGKEIT', frame: '12 05 0b 03 1f', result: 'STATUS_GESCHWINDIGKEIT_WERT', usable: false, provenance: 'named by BMS43DS0; its own job reads data byte 6 as km/h (sgbd/vm, 2026-11-15), no car yet' },
        KOMBI46_SPEED,
    ],
    bms46ds0: [
        { moduleId: 'bms46ds0', job: 'STATUS_GESCHWINDIGKEIT', frame: '12 05 0b 03 1f', result: 'STAT_GESCHWINDIGKEIT_WERT', usable: false, provenance: 'named by BMS46DS0; its own job stops before the value (sgbd/vm), no car yet' },
        KOMBI46_SPEED,
    ],
    bms46ds1: [
        { moduleId: 'bms46ds1', job: 'STATUS_GESCHWINDIGKEIT', frame: '12 05 0b 03 1f', result: 'STAT_GESCHWINDIGKEIT_WERT', usable: false, provenance: 'named by BMS46DS1; its own job stops before the value (sgbd/vm), no car yet' },
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
    const v = read.values.find((x) => x.name === source.result)?.value;
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * Where each car's road speed could be read from, for the stationary check before a read that may go
 * only parked (link/session.ts `preflight`).
 *
 * On an M3 it is the MSS54's live block 19 (`v`, `v_asc`), read on cars since TUNER. On an E46 that is
 * not an M3 the DME is another SGBD, and its own SGBD names a speed job; the cluster has one too. Which
 * bytes of those answers are the speed has not been established, and no such car has answered yet —
 * so they are listed here, and **none of them is used** (plan Phase 4-5: closed until a car confirms it).
 * The consequence is deliberate: on those cars the preflight reads nothing it trusts, says `unknown`, and
 * every parked-only read and the fault clear stay unsent. The IDENT and each module's own fault read do
 * not wait on the speed (runGate `fault-read`, operator 2026-11-04), so an intake check still works.
 *
 * To open one: confirm on a car which bytes are the speed (and that 0 reads 0 standing still), then set
 * `usable` with the evidence in `provenance`. That change is a person's (autonomy:human).
 */

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

/** By the DME the car's 0x12 IDENT chose (lib/variants). */
export const SPEED_SOURCES: Readonly<Record<string, readonly SpeedSource[]>> = {
    mss54: [
        { moduleId: 'mss54', job: 'LIVE_19', frame: '12 05 0b 13 0f', result: '19:v', usable: true, provenance: 'MSS54 live block 19, read on cars (TUNER; MONITORING preflight since 2026-10-27)' },
    ],
    // MS42 and MS43 (M52TU, M54): the DME's own speed job, or the cluster's (KOMBI46 STATUS_ANALOG_LESEN).
    ms420ds0: [
        { moduleId: 'ms420ds0', job: 'STATUS_GESCHWINDIGKEIT', frame: '12 05 0b 03 1f', result: 'STAT_GESCHWINDIGKEIT_WERT', usable: false, provenance: 'named by MS420DS0; bytes not established, no car yet' },
        { moduleId: 'kombi46', job: 'STATUS_ANALOG_LESEN', frame: '80 05 0b 0a 84', result: 'STAT_GESCHWINDIGKEIT_WERT', usable: false, provenance: 'named by KOMBI46; bytes not established, no car yet' },
    ],
    ms430ds0: [
        { moduleId: 'ms430ds0', job: 'STATUS_GESCHWINDIGKEIT', frame: '12 0b 70 00 00 00 00 7d 18 1d 11', result: 'STAT_GESCHWINDIGKEIT_WERT', usable: false, provenance: 'named by MS430DS0 (a 0x70 frame its telegram table carries more than one of); bytes not established, no car yet' },
        { moduleId: 'kombi46', job: 'STATUS_ANALOG_LESEN', frame: '80 05 0b 0a 84', result: 'STAT_GESCHWINDIGKEIT_WERT', usable: false, provenance: 'named by KOMBI46; bytes not established, no car yet' },
    ],
    // M43 (BMS43, BMS46): the cluster.
    bms43ds0: [{ moduleId: 'kombi46', job: 'STATUS_ANALOG_LESEN', frame: '80 05 0b 0a 84', result: 'STAT_GESCHWINDIGKEIT_WERT', usable: false, provenance: 'named by KOMBI46; bytes not established, no car yet' }],
    bms46ds0: [{ moduleId: 'kombi46', job: 'STATUS_ANALOG_LESEN', frame: '80 05 0b 0a 84', result: 'STAT_GESCHWINDIGKEIT_WERT', usable: false, provenance: 'named by KOMBI46; bytes not established, no car yet' }],
    bms46ds1: [{ moduleId: 'kombi46', job: 'STATUS_ANALOG_LESEN', frame: '80 05 0b 0a 84', result: 'STAT_GESCHWINDIGKEIT_WERT', usable: false, provenance: 'named by KOMBI46; bytes not established, no car yet' }],
};

/** The source the preflight may read for this DME, or null: then the car cannot be shown to be stationary. */
export function usableSpeedSource(dmeModuleId: string | null): SpeedSource | null {
    return (dmeModuleId ? SPEED_SOURCES[dmeModuleId] : undefined)?.find((s) => s.usable) ?? null;
}

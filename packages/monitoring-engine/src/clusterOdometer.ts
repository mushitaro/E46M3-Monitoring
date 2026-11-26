/**
 * The odometer as the E46 instrument cluster keeps it, for the store's intake: read from KOMBI itself
 * so a person does not type the mileage (operator, 2026-11-26, after the real-car read of that day
 * left it empty: the scan had no such read).
 *
 * ## What the cluster's own SGBD sends, and where it reads the answer
 *
 * KOMBI46 `AIF_GWSZ_LESEN` and KOMBI46R `STATUS_AIF_GWSZ_LESEN` ("Gesamtwegstreckenzaehler aus
 * Anwenderinfofeld auslesen") both send `80 05 02 01` (+ the XOR checksum `86`): user-information
 * field (AIF), block 1 — the VIN's read (./clusterVin) is block 2 of the same field.
 *
 * Run by EdiabasLib against simulated answers (tools/SgbdDump `--exec KOMBI46 AIF_GWSZ_LESEN`,
 * 2026-11-26): with status OKAY (0xA0) the result STAT_GWSZ_WERT is frame bytes 4..6 read as six BCD
 * digits, in km (STAT_GWSZ_EINH `km`); byte 3 (the block) does not enter it. `12 34 56` gave 123456,
 * `01 23 45` gave 12345, `99 99 99` gave 999999. Any other status is ERROR_ECU_PARAMETER.
 *
 * In the payload (after address, length and status) that is bytes 1..3.
 *
 * Unlike the SGBD, this does not read past a short answer (EdiabasLib made 120000 of a one-byte
 * one) and does not take a byte that is not two decimal digits: either gives null, never a guess.
 *
 * ## Not yet confirmed on a car
 *
 * Until a real cluster has answered this read and the number matched its display, the read is
 * marked so (`CLUSTER_ODOMETER_UNVERIFIED`).
 */

/** Each cluster SGBD's own job carrying the frame. */
export const CLUSTER_ODOMETER_JOBS: Readonly<Record<string, readonly string[]>> = {
    kombi46: ['AIF_GWSZ_LESEN'],
    kombi46r: ['STATUS_AIF_GWSZ_LESEN'],
};

/** The control byte and argument of that frame: AIF, block 1. */
export const CLUSTER_ODOMETER_CONTROL = 0x02;
export const CLUSTER_ODOMETER_BLOCK = 0x01;

/** True until a real cluster has answered this read and the number matched its display. */
export const CLUSTER_ODOMETER_UNVERIFIED = true;

/** The odometer in km from a positive answer's payload, where the SGBD reads it; null when it is not there. */
export function clusterOdometerKm(payload: Uint8Array): number | null {
    if (payload.length < 4) return null;
    let km = 0;
    for (const b of [payload[1], payload[2], payload[3]]) {
        const hi = b >> 4;
        const lo = b & 0x0f;
        if (hi > 9 || lo > 9) return null;
        km = km * 100 + hi * 10 + lo;
    }
    return km;
}

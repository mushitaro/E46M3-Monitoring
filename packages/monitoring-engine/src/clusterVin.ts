/**
 * The VIN as the E46 instrument cluster keeps it, for the store to match the car by: the operator
 * chose, on 2026-11-10, that the engine read it from KOMBI itself, so a person types nothing. A DS2
 * E46 says its VIN nowhere else this app reads (not in IDENT, not in a fault read). The scan keeps
 * what it read on its run (lib/probe/scan `vin`); the intake report (`e46.intake-check.v1`'s
 * `vinShort`) is built from that by whoever writes the report.
 *
 * ## What the cluster's own SGBD sends, and where it reads the answer
 *
 * Read from the SGBDs' bytecode (EdiabasLib's Tools/BESTDIS on KOMBI46.prg and KOMBI46R.prg) and
 * then run by EdiabasLib against a simulated answer, which returned the same seven characters:
 *
 *   - KOMBI46 `AIF_FG_NR_LESEN`, KOMBI46R `STATUS_AIF_FG_NR_LESEN` and `C_FG_LESEN` all send
 *     `80 05 02 02` (+ the XOR checksum `85`): user-information field (AIF), block 2.
 *   - The answer's status (byte 2) must be OKAY (0xA0). The VIN is then bytes 4..5 as two characters
 *     and bytes 6..8 as BCD, of which the first five digits are kept: the VIN's LAST SEVEN, as BMW
 *     writes the short VIN (two letters, five digits). Neither SGBD has a job that answers with the
 *     whole seventeen, so a report built from it carries `vinShort` and leaves `vin` null.
 *
 * In the payload (after address, length and status) that is bytes 1..2 and 3..5.
 *
 * ## Not yet confirmed on a car
 *
 * The bytes and their reading are the SGBD's; no real cluster has answered this app yet. Until one
 * has, the read is marked so (`CLUSTER_VIN_UNVERIFIED`), and the scan's line in the comms log says
 * it is not confirmed on a car.
 */

/** Each cluster SGBD's own job(s) carrying the frame, in the order looked for. Only these two were read. */
export const CLUSTER_VIN_JOBS: Readonly<Record<string, readonly string[]>> = {
    kombi46: ['AIF_FG_NR_LESEN'],
    kombi46r: ['STATUS_AIF_FG_NR_LESEN', 'C_FG_LESEN'],
};

/** The control byte and argument of that frame: AIF, block 2. */
export const CLUSTER_VIN_CONTROL = 0x02;
export const CLUSTER_VIN_BLOCK = 0x02;

/** True until a real cluster has answered this read and the seven characters matched the car. */
export const CLUSTER_VIN_UNVERIFIED = true;

const SHORT_VIN = /^[A-HJ-NPR-Z]{2}[0-9]{5}$/;

/**
 * The VIN's last seven from a positive answer's payload, read where the SGBD reads them; null when
 * the payload is too short or the characters are not a short VIN (no I, O or Q; five decimal digits).
 * Not guessed: a byte that is not what the SGBD would make into a short VIN gives null.
 */
export function clusterVinShort(payload: Uint8Array): string | null {
    if (payload.length < 6) return null;
    const letters = String.fromCharCode(payload[1], payload[2]);
    const digits = [payload[3], payload[4], payload[5]]
        .map((b) => b.toString(16).toUpperCase().padStart(2, '0'))
        .join('')
        .slice(0, 5);
    const short = letters + digits;
    return SHORT_VIN.test(short) ? short : null;
}

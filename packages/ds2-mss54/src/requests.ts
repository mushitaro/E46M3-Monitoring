/**
 * MSS54 request shapes, grounded in the telegrams statically extracted from
 * MSS54DS0.prg (tools/extract_telegrams.py).
 *
 * Only requests whose extracted form is unambiguous enough to trust as a
 * STARTING POINT live here, and even those are unverified on a vehicle. The
 * extractor grades every telegram; most are "shared", meaning several jobs emit
 * the same literal because the real request is assembled from arguments at run
 * time. Those are not reproduced here — guessing at an argument layout is how
 * you send a plausible wrong command.
 */

import { Ds2Control } from '@tsunagi/ds2-core';

/**
 * Identification. Extracted as `12 04 00 16` from the IDENT job: control 0x00,
 * no payload.
 *
 * The response layout is NOT known — the old app got its ZB/HW/SW/date fields
 * from EdiabasLib's IDENT job results, which is exactly the sort of thing the
 * SGBD does for you. Read it raw, show the bytes, and decode once a car has
 * shown what comes back.
 */
export const IDENT_REQUEST = { control: 0x00, payload: new Uint8Array(0) } as const;

/**
 * Error memory is a two-step read, and both steps are control 0x04
 * distinguished by their argument byte — extracted from FS_LESEN as
 * `12 05 04 00 13` and `12 05 04 01 12`.
 *
 * That matches the reference parser exactly: a 5-byte quicktest payload, then
 * entry records. Reading the quicktest first is worth it — it says whether
 * there is anything to fetch before pulling records.
 */
export const ERROR_MEMORY_QUICKTEST = {
    control: Ds2Control.READ_ERROR_MEMORY,
    payload: new Uint8Array([0x00]),
} as const;

export const ERROR_MEMORY_ENTRIES = {
    control: Ds2Control.READ_ERROR_MEMORY,
    payload: new Uint8Array([0x01]),
} as const;

/**
 * Shadow (secondary) error memory, control 0x14. The extractor did not produce
 * an unambiguous telegram for it, so the argument byte below mirrors the
 * primary memory's. Marked here rather than hidden: it is an inference.
 */
export const SHADOW_MEMORY_ENTRIES = {
    control: Ds2Control.READ_SHADOW_ERROR_MEMORY,
    payload: new Uint8Array([0x01]),
} as const;

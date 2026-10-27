/**
 * The shipped ECU data, for tests — and whether it is here at all.
 *
 * `public/ecu-data/` is BMW-derived and lives in the private data repository, so a clone of this
 * public repository does not have it (`docs/PRESERVED.md`). The tests that read it used to throw
 * ENOENT on such a clone — twelve files, 57 failures — which made a fresh clone and CI red for a
 * reason that says nothing about the code. They skip instead, and say why, through this one guard.
 *
 * A skip is not a pass. CI fetches the data and runs them (`.github/workflows/ci.yml`); what the
 * guard removes is only the failure that means "the data is not on this machine".
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const SHIPPED_DATA = path.resolve(import.meta.dirname, '..', '..', '..', 'public', 'ecu-data');

/** True when the private data has been placed (`E46M3-Monitoring-data/ecu-data` → `public/ecu-data`). */
export const HAVE_SHIPPED_DATA = existsSync(path.join(SHIPPED_DATA, 'index.json'));

export function readShipped<T>(file: string): T {
    return JSON.parse(readFileSync(path.join(SHIPPED_DATA, file), 'utf-8')) as T;
}

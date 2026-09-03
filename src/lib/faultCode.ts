/**
 * Normalise a fault / freeze-frame code for lookup.
 *
 * NOT `toUpperCase()`. The table writes `0x2A` and `formatErrorCode` produces
 * `0x2A`, but `"0x2A".toUpperCase()` is `"0X2A"` — the `x` uppercases too — so a
 * map keyed that way misses every single code while looking perfectly correct.
 * That is precisely how the freeze frames kept rendering as raw bytes with a
 * decode table sitting right there.
 *
 * It is a module rather than a helper beside its one caller because the trap is
 * not about fault codes: it is about `0x`-prefixed hex anywhere, and the next
 * person to key a map on one should find this already written.
 */
export function normCode(s: string): string {
    return s.trim().toLowerCase();
}

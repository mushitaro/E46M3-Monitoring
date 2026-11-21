/**
 * A duration in the reader's units. The SGBD writes them its own way — `10 sek`, `3,0 min`, a comma
 * for the decimal point — and the screen says 「10 秒」「3 分」 (UX-12). The number is the one the
 * procedure table already carries in seconds (`durMaxSec`), so nothing is parsed from the German.
 */
export function formatDuration(sec: number, units: { dur_sec: (n: number) => string; dur_min: (n: number) => string }): string {
    const s = Math.max(0, Math.round(sec));
    if (s < 60) return units.dur_sec(s);
    const m = Math.floor(s / 60);
    const rest = s % 60;
    return rest === 0 ? units.dur_min(m) : `${units.dur_min(m)} ${units.dur_sec(rest)}`;
}

/** A procedure's longest run as the SGBD states it, or null where it states none (the 60 s is the app's default, not the SGBD's). */
export function procedureMaxSec(p: { durMax: string; durMaxSec: number | null }): number | null {
    return p.durMax && p.durMaxSec !== null ? p.durMaxSec : null;
}

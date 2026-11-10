/**
 * The comms log and a datalog run as text — the exact text the app's files hold.
 *
 * Moved from the app's `src/lib/download.ts`, which re-exports both and keeps the part that hands a
 * file to the person (a DOM `<a download>`), because the saved session (`./sync/session.ts`) is made
 * of this text and must not reach into a screen to write it.
 */
import type { ChannelId } from '@tsunagi/ds2-mss54';
import type { CommsLogLine, LiveSample } from './link/types';

/**
 * One comms-log line as text. Shared with the saved sessions and the error records
 * (`sync/session.ts`), so an excerpt read from either looks exactly like the file.
 */
export function logLine(l: CommsLogLine): string {
    return `${new Date(l.t).toISOString()} ${l.kind.toUpperCase().padEnd(5)} ${l.text}`;
}

/**
 * A datalog run as CSV text — the file EXPORT CSV downloads and the text a saved session keeps.
 * One function, so the saved copy and the downloaded one cannot disagree about a column.
 *
 * Headings are channel ids — `3:n`, `35:n` — so a run that read both blocks has two distinct
 * columns instead of one column called `n` holding the last block read.
 */
export function datalogCsv(channels: readonly ChannelId[], samples: readonly LiveSample[]): string {
    return [
        ['time_s', ...channels].join(','),
        ...samples.map((s) => [s.time.toFixed(3), ...channels.map((k) => s.values[k] ?? '')].join(',')),
    ].join('\r\n');
}

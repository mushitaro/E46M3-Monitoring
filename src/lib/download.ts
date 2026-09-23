/**
 * Handing a file to the operator, and stamping it with when it was taken.
 *
 * Three call sites want this — the comms log, the datalog CSV, and whatever
 * comes next — and they were sharing it by living in the same 1,880-line file.
 * That is not sharing; it is proximity. Here it is a module, and the shell no
 * longer has to be the place a `<a download>` gets built.
 *
 * `stamp()` is LOCAL time on purpose. The filename is read by the person who
 * was standing at the car, and they know what time it was there; an ISO instant
 * in the name would be correct and unreadable. The log's own lines carry the
 * ISO timestamps, so the instant is not lost — it is just not in the filename.
 */
import type { ChannelId } from '@tsunagi/ds2-mss54';
import type { CommsLogLine, LiveSample } from '@/hooks/useDs2Link';

export function download(content: string, type: string, filename: string) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

export function stamp() {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/**
 * One comms-log line as text. Shared with the saved sessions and the error records
 * (`lib/sync/session.ts`), so an excerpt read from either looks exactly like the file.
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

export function exportCommsLog(log: CommsLogLine[]) {
    download(log.map(logLine).join('\r\n'), 'text/plain', `e46m3-comms-${stamp()}.txt`);
}

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
import type { CommsLogLine } from '@/hooks/useDs2Link';

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

export function exportCommsLog(log: CommsLogLine[]) {
    const text = log
        .map((l) => `${new Date(l.t).toISOString()} ${l.kind.toUpperCase().padEnd(5)} ${l.text}`)
        .join('\r\n');
    download(text, 'text/plain', `e46m3-comms-${stamp()}.txt`);
}

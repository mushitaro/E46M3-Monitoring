'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { ErrorMemoryEntry } from '@tsunagi/ds2-mss54';
import type { LinkMode, LinkState } from '@/hooks/useDs2Link';
import { KEEP_MS, episodes, expired, rebaseMeta, unfound, type Episode, type JournalEvent } from '@/lib/journal';
import type { FailureNote, SavedSession } from '@/lib/sync/session';
import { appendEvent, deleteEvents, getMeta, listEvents, putMeta, rebaseEvents, type JournalMeta } from '@/lib/sync/journalStore';
import { appNow, isAnchored, onAnchor } from '@/lib/clock';

/**
 * What the page holds of the journal: the events and the owner's joins and keeps, outside React so
 * the watchers below can add to it from an effect without setting state there. One per hook.
 */
function createJournalCache() {
    let state: { events: JournalEvent[]; meta: JournalMeta } = { events: [], meta: { joins: [], kept: {} } };
    const listeners = new Set<() => void>();
    const emit = () => listeners.forEach((l) => l());
    return {
        snapshot: () => state,
        subscribe: (l: () => void) => {
            listeners.add(l);
            return () => listeners.delete(l);
        },
        replace: (next: typeof state) => {
            state = next;
            emit();
        },
        add: (e: JournalEvent) => {
            state = { ...state, events: [...state.events, e] };
            emit();
        },
        setMeta: (meta: JournalMeta) => {
            state = { ...state, meta };
            emit();
        },
    };
}

/** Store keys of the events this page recorded before it heard the server's time, and the step it took then. */
const pageLoose: number[] = [];
const anchorStep: { value: number | null } = { value: null };

/** The clock MEMORY reads, a minute at a time: enough to move an episode out of "in progress" and
 *  to count its days down, without reading the clock during render. */
const minuteClock = (() => {
    let now = 0;
    const listeners = new Set<() => void>();
    let timer: ReturnType<typeof setInterval> | null = null;
    return {
        snapshot: () => now,
        subscribe: (l: () => void) => {
            listeners.add(l);
            if (!timer) {
                now = appNow();
                timer = setInterval(() => {
                    now = appNow();
                    listeners.forEach((x) => x());
                }, 60_000);
            }
            return () => {
                listeners.delete(l);
                if (listeners.size === 0 && timer) {
                    clearInterval(timer);
                    timer = null;
                }
            };
        },
    };
})();

/**
 * MEMORY's journal, recorded from the shell (lib/journal.ts says what it is and why).
 *
 * It watches what the screen already holds — the link's state, its identity read, fault read,
 * learned values and last procedure, the recording, the failures — and appends one event each time
 * one of them changes. Nothing is read from the car for it. While PROBE runs (`paused`), nothing is
 * recorded: a handed-over investigation keeps its own record (privacy policy §10).
 *
 * WORKS only (`enabled`), like every store under lib/sync.
 */
export function useJournal(input: {
    enabled: boolean;
    paused: boolean;
    link: {
        state: LinkState;
        mode: LinkMode;
        error: string | null;
        ident: { hex: string; length: number } | null;
        faults: ErrorMemoryEntry[] | null;
        rawFaults: Array<{ request: string; response: string; source: string }> | null;
        adaptations: unknown;
        lastRun: unknown;
    };
    ecuId: string;
    datalog: { samples: readonly unknown[]; capture: () => SavedSession['datalog'] };
    failures: readonly FailureNote[];
}) {
    const { enabled, paused, link, ecuId, datalog, failures } = input;
    const [cache] = useState(createJournalCache);
    const { events, meta } = useSyncExternalStore(cache.subscribe, cache.snapshot, cache.snapshot);
    const now = useSyncExternalStore(minuteClock.subscribe, minuteClock.snapshot, () => 0);
    const record = enabled && !paused;

    const refresh = useCallback(async () => {
        if (!enabled) return;
        try {
            const [all, fetched] = await Promise.all([listEvents(), getMeta()]);
            let m = fetched;
            // Undated episodes are counted from when a page that knows the time first finds them.
            const fresh = isAnchored() ? unfound(all, new Set(m.joins), m.found ?? {}) : [];
            if (fresh.length > 0) {
                m = { ...m, found: { ...(m.found ?? {}), ...Object.fromEntries(fresh.map((t) => [String(t), appNow()])) } };
                await putMeta(m);
            }
            const gone = expired(all, appNow(), new Set(m.joins), m.found ?? {});
            const seqs = gone.flatMap((e) => (typeof e.seq === 'number' ? [e.seq] : []));
            if (seqs.length > 0) await deleteEvents(seqs);
            const goneSet = new Set(gone);
            cache.replace({ events: all.filter((e) => !goneSet.has(e)), meta: m });
        } catch {
            // The lists stay as they were; MEMORY says nothing it cannot read.
        }
    }, [enabled, cache]);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    const append = useCallback(
        (e: JournalEvent) => {
            if (!record) return;
            // Before the page has heard the server's time, the time is the device's and may be years
            // off (lib/clock): marked, and put right when the server answers.
            const stamped: JournalEvent = isAnchored() ? e : { ...e, loose: true };
            cache.add(stamped);
            void appendEvent(stamped).then((seq) => {
                if (seq === null || !stamped.loose) return;
                // Written after the server answered (the write was slower than the answer): put right now.
                if (isAnchored() && anchorStep.value !== null) void rebaseEvents([seq], anchorStep.value).then(() => refresh());
                else pageLoose.push(seq);
            });
        },
        [record, cache, refresh],
    );

    // The server's time, first heard: this page's loose events move by the step, and the owner's
    // joins and keeps (named by an episode's first time) move with them.
    useEffect(() => {
        if (!enabled) return;
        return onAnchor((step) => {
            anchorStep.value = step;
            const seqs = pageLoose.splice(0);
            void (async () => {
                try {
                    const moved = await rebaseEvents(seqs, step);
                    if (moved.size > 0 && step !== 0) await putMeta(rebaseMeta(await getMeta(), moved));
                } catch {
                    // Left loose: undated, so kept rather than deleted (lib/journal `undated`).
                }
                await refresh();
            })();
        });
    }, [enabled, refresh]);

    // The link coming and going, and a recording ending.
    const prevState = useRef(link.state);
    useEffect(() => {
        const was = prevState.current;
        prevState.current = link.state;
        if (was === link.state) return;
        const t = appNow();
        if (was === 'connecting' && link.state === 'connected') append({ t, kind: 'connect', ecu: ecuId, mock: link.mode === 'practice' });
        if (was === 'logging' && link.state !== 'logging' && datalog.samples.length > 0) {
            const captured = datalog.capture();
            if (captured) append({ t, kind: 'datalog', datalog: captured });
        }
        if (was !== 'disconnected' && was !== 'connecting' && link.state === 'disconnected') append({ t: t + 1, kind: 'disconnect', lost: link.error !== null });
    }, [link.state, link.mode, link.error, ecuId, datalog, append]);

    // A module switch under an open link (monitoring_module, the screen's OPEN) disconnects and
    // connects again faster than a render: the states in between never reach this hook. The module
    // changing is the boundary that survives, so it is recorded as one.
    const prevEcu = useRef(ecuId);
    useEffect(() => {
        const was = prevEcu.current;
        prevEcu.current = ecuId;
        if (was === ecuId || link.state === 'disconnected') return;
        const t = appNow();
        append({ t, kind: 'disconnect', lost: false });
        append({ t: t + 1, kind: 'connect', ecu: ecuId, mock: link.mode === 'practice' });
    }, [ecuId, link.state, link.mode, append]);

    // Each new read the screen shows. By reference: the link hands over a new object per read, and
    // the same object again on every render in between.
    const seen = useRef({ ident: link.ident, faults: link.faults, rawFaults: link.rawFaults, adaptations: link.adaptations, lastRun: link.lastRun });
    useEffect(() => {
        const s = seen.current;
        const t = appNow();
        if (link.ident && link.ident !== s.ident) append({ t, kind: 'ident', ident: link.ident });
        if (link.faults && link.faults !== s.faults) append({ t, kind: 'faults', faults: link.faults });
        if (link.rawFaults && link.rawFaults !== s.rawFaults) append({ t, kind: 'rawFaults', reads: link.rawFaults });
        if (link.adaptations && link.adaptations !== s.adaptations) append({ t, kind: 'adaptation', blocks: link.adaptations });
        if (link.lastRun && link.lastRun !== s.lastRun) {
            const job = (link.lastRun as { job?: { id?: string } | string }).job;
            append({ t, kind: 'run', job: typeof job === 'string' ? job : (job?.id ?? ''), result: link.lastRun });
        }
        seen.current = { ident: link.ident, faults: link.faults, rawFaults: link.rawFaults, adaptations: link.adaptations, lastRun: link.lastRun };
    }, [link.ident, link.faults, link.rawFaults, link.adaptations, link.lastRun, append]);

    // Failures, one event per new note.
    const seenFailures = useRef(failures.length);
    useEffect(() => {
        if (failures.length < seenFailures.current) seenFailures.current = 0;
        for (const note of failures.slice(seenFailures.current)) append({ t: note.at, kind: 'failure', note });
        seenFailures.current = failures.length;
    }, [failures, append]);

    const joins = useMemo(() => new Set(meta.joins), [meta.joins]);
    const all = useMemo(() => episodes(events, joins), [events, joins]);
    const last = all.length > 0 ? all[all.length - 1] : null;
    // The episode in progress: the last one, while the link is up. Once it is down the episode is
    // finished and joins the list of those not kept (SAVE still takes the newest of them).
    const current = last && link.state !== 'disconnected' ? last : null;
    const unkept = all.filter((ep) => ep !== current && !meta.kept[String(ep.start)]).reverse();

    const saveMeta = useCallback(
        async (next: JournalMeta) => {
            cache.setMeta(next);
            try {
                await putMeta(next);
            } catch {
                // Kept in memory for this page; the next refresh reads the store again.
            }
        },
        [cache],
    );

    /** The saved session an episode was kept as, and how far it had got then. */
    const keptAs = useCallback((ep: Episode) => parseKept(meta.kept[String(ep.start)] ?? null), [meta.kept]);
    const markKept = useCallback(
        (ep: Episode, id: string) => saveMeta({ ...meta, kept: { ...meta.kept, [String(ep.start)]: `${id}@${ep.end}` } }),
        [meta, saveMeta],
    );
    /** Joins an episode to the one before it. */
    const join = useCallback((ep: Episode) => saveMeta({ ...meta, joins: [...meta.joins, ep.start] }), [meta, saveMeta]);

    /** When an undated episode is deleted: seven days after a page with the right time found it; null until one has. */
    const undatedExpiry = useCallback((ep: Episode) => {
        const at = meta.found?.[String(ep.start)];
        return at === undefined ? null : at + KEEP_MS;
    }, [meta.found]);

    return { episodes: all, current, unkept, keptAs, markKept, join, refresh, now, undatedExpiry };
}

export type Journal = ReturnType<typeof useJournal>;

/** `kept` holds `id@end`: the saved session, and how far the episode had got when it was kept. */
export function parseKept(v: string | null): { id: string; at: number } | null {
    if (!v) return null;
    const i = v.lastIndexOf('@');
    return { id: v.slice(0, i), at: Number(v.slice(i + 1)) };
}

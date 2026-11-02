/**
 * PROBE boards on THIS device (lib/probe/board.ts says what a board is), and the page's one signal
 * that the PROBE side changed.
 *
 * A board is kept in `journalMeta` under `board:<session>`, beside MEMORY's own facts: it is the
 * screen's arrangement, read back when the session is opened again, and it is never sent. What it
 * shows is drawn from the session's record and runs, which are kept and sent as they always were.
 *
 * WORKS-only, like lib/sync.
 */
import { inTransaction, JOURNAL_META } from '../sync/db';
import { emptyBoard, type Board } from './board';

const key = (record: string) => `board:${record}`;

export function getBoard(record: string): Promise<Board> {
    return inTransaction<Board>(JOURNAL_META, 'readonly', (s, done) => {
        const req = s.get(key(record));
        req.onsuccess = () => {
            const b = req.result as (Board & { key: string }) | undefined;
            done(b ? { record, parts: b.parts ?? [], seq: b.seq ?? 0 } : emptyBoard(record));
        };
    });
}

export async function putBoard(b: Board): Promise<void> {
    await inTransaction<void>(JOURNAL_META, 'readwrite', (s, done) => {
        s.put({ key: key(b.record), ...b }).onsuccess = () => done(undefined);
    });
    probeChanged();
}

/**
 * Something on the PROBE side changed — an entry written, a run kept, a board rearranged — so the
 * views reading it read again. Within this page only; another tab reads when it is next opened.
 */
const listeners = new Set<() => void>();
let version = 0;
export const probeChanges = {
    subscribe: (l: () => void) => {
        listeners.add(l);
        return () => {
            listeners.delete(l);
        };
    },
    snapshot: () => version,
};
export function probeChanged(): void {
    version++;
    listeners.forEach((l) => l());
}

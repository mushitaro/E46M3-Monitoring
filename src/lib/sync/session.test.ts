import { describe, expect, it } from 'vitest';
import { channelId } from '@tsunagi/ds2-mss54';
import { datalogCsv } from '@/lib/download';
import { EXCERPT_LINES, excerpt, hasContent, isSavedSession, needsSync, parseCsv, type SavedSession } from './session';

const session = (over: Partial<SavedSession> = {}): SavedSession => ({
    v: 1,
    id: '00000000-0000-4000-8000-000000000000',
    label: '2026-09-23 12:00 MSS54',
    createdAt: 1,
    updatedAt: 2,
    syncedAt: null,
    appBuild: '1.abc',
    ecu: 'mss54',
    mock: true,
    ident: null,
    faults: null,
    datalog: null,
    failures: [],
    ...over,
});

describe('saved sessions', () => {
    it('SYNC sends what the account has not seen, and nothing else', () => {
        expect(needsSync({ syncedAt: null, updatedAt: 5 })).toBe(true);
        expect(needsSync({ syncedAt: 4, updatedAt: 5 })).toBe(true);
        expect(needsSync({ syncedAt: 5, updatedAt: 5 })).toBe(false);
    });

    // "Not read" and "read, nothing stored" are different facts, and only one of them is content.
    it('an unread fault memory is not content; an empty read is', () => {
        expect(hasContent({ ident: null, faults: null, samples: 0, failures: 0 })).toBe(false);
        expect(hasContent({ ident: null, faults: [], samples: 0, failures: 0 })).toBe(true);
        expect(hasContent({ ident: null, faults: null, samples: 0, failures: 1 })).toBe(true);
    });

    it('keeps the tail of the log, in the exported file’s format', () => {
        const log = Array.from({ length: 100 }, (_, i) => ({ t: i * 1000, kind: 'tx' as const, text: `line ${i}` }));
        const lines = excerpt(log);
        expect(lines).toHaveLength(EXCERPT_LINES);
        expect(lines[lines.length - 1]).toBe('1970-01-01T00:01:39.000Z TX    line 99');
    });

    it('a restore accepts a session and refuses anything else', () => {
        expect(isSavedSession(session())).toBe(true);
        expect(isSavedSession({ ...session(), v: 2 })).toBe(false);
        expect(isSavedSession({ ...session(), failures: undefined })).toBe(false);
        expect(isSavedSession(null)).toBe(false);
    });

    it('the viewer reads back exactly the CSV the export writes', () => {
        const ch = [channelId(3, 'n'), channelId(35, 'n')];
        const csv = datalogCsv(ch, [
            { time: 0, values: { [ch[0]]: 800, [ch[1]]: 801 } },
            { time: 0.2, values: { [ch[0]]: 850 } },
        ]);
        const { header, rows } = parseCsv(csv);
        expect(header).toEqual(['time_s', '3:n', '35:n']);
        expect(rows).toEqual([
            ['0.000', '800', '801'],
            ['0.200', '850', ''],
        ]);
    });
});

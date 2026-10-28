import { describe, expect, it } from 'vitest';
import { STRINGS } from '@/lib/i18n';
import { describeSave, describeSync, savePhase, syncPhase, toSend } from './status';

/**
 * What SAVE and SYNC say, decided once for the desk and the menu sheet (lib/sync/status). The words
 * are the catalog's, so the test reads them from there rather than restating them.
 */
const t = STRINGS.ja;
const idle = { busy: null, content: true, unsaved: true, pending: 0 };
const route = { online: true, gate: 'active' as const };

describe('SAVE', () => {
    it('says what it would do, and is pressable only when there is something unsaved', () => {
        expect(savePhase({ ...idle, content: false, unsaved: false })).toBe('nothing');
        expect(savePhase(idle)).toBe('ready');
        expect(savePhase({ ...idle, unsaved: false })).toBe('saved');
        expect(savePhase({ ...idle, busy: 'save' })).toBe('busy');
        expect(savePhase({ ...idle, busy: 'sync' })).toBe('busy');

        expect(describeSave('ready', t)).toMatchObject({ label: t.save, disabled: false, tone: 'ready' });
        expect(describeSave('saved', t)).toMatchObject({ label: t.save_done, disabled: true, tone: 'done' });
        expect(describeSave('nothing', t)).toMatchObject({ label: t.save_nothing, disabled: true });
    });

    it('keeps its label to the state’s word and its sentence to `title`', () => {
        for (const phase of ['nothing', 'ready', 'busy', 'saved'] as const) {
            const look = describeSave(phase, t);
            expect(look.label.split(' ').length, phase).toBeLessThanOrEqual(2);
            expect(look.title, phase).toBe(t.save_title[phase]);
        }
    });
});

describe('SYNC', () => {
    it('counts this connection if unsaved, and every saved session not yet sent', () => {
        expect(toSend({ ...idle, pending: 2 })).toBe(3);
        expect(toSend({ ...idle, unsaved: false, pending: 2 })).toBe(2);
        expect(toSend({ ...idle, content: false, unsaved: false })).toBe(0);
        expect(describeSync('ready', 3, t)).toMatchObject({ label: `${t.sync} 3`, disabled: false, tone: 'ready' });
        expect(describeSync('ready', 3, t).title).toBe(t.sync_title.ready(3));
    });

    it('says Synced when nothing is outstanding, whatever the route is doing', () => {
        const nothing = { ...idle, unsaved: false };
        expect(syncPhase({ ...nothing, ...route })).toBe('clean');
        expect(syncPhase({ ...nothing, online: false, gate: 'unknown' })).toBe('clean');
        expect(syncPhase({ ...nothing, online: true, gate: 'expired' })).toBe('clean');
    });

    it('names what stands in the way when there is something to send', () => {
        expect(syncPhase({ ...idle, ...route })).toBe('ready');
        expect(syncPhase({ ...idle, online: false, gate: 'active' })).toBe('offline');
        expect(syncPhase({ ...idle, online: true, gate: 'expired' })).toBe('signedOut');
        expect(syncPhase({ ...idle, online: true, gate: 'unknown' })).toBe('unreachable');
        expect(syncPhase({ ...idle, ...route, busy: 'sync' })).toBe('busy');
        // A press that asks again is the whole answer to an account m3 did not confirm.
        expect(describeSync('unreachable', 1, t).disabled).toBe(false);
        expect(describeSync('signedOut', 1, t).disabled).toBe(true);
    });
});

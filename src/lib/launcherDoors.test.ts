import { afterEach, describe, expect, it, vi } from 'vitest';

async function load(search: string) {
    vi.resetModules();
    vi.stubGlobal('location', { search });
    return import('./launcherDoors');
}

afterEach(() => vi.unstubAllGlobals());

describe('the launcher’s settings door', () => {
    it('is offered only when the launcher that opened the page says it has one', async () => {
        expect((await load('?from=manifold&doors=settings')).hasSettingsDoor()).toBe(true);
        expect((await load('?from=manifold')).hasSettingsDoor()).toBe(false);
        expect((await load('')).hasSettingsDoor()).toBe(false);
    });

    it('hands Chrome an intent for the launcher’s package, never for Settings itself', async () => {
        const m = await load('?doors=settings');
        expect(m.settingsDoorUrl('wifi')).toBe('intent://settings/wifi#Intent;scheme=manifold;package=app.tsunagi.e46m3.launcher;end');
        expect(m.settingsDoorUrl('datetime')).toContain('settings/datetime');
    });
});

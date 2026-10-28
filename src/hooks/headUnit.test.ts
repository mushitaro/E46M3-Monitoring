import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Telling the head unit: the launcher's `?from=manifold` (which survives m3's sign-in), else its
 * referrer; remembered on the device only when the assistant asks.
 */

function memoryStorage() {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
}

async function load(search: string, referrer = '') {
    vi.resetModules();
    const storage = memoryStorage();
    vi.stubGlobal('location', { search, href: `https://e46m3-monitoring-preview.pages.dev/${search}` });
    vi.stubGlobal('document', { referrer });
    vi.stubGlobal('localStorage', storage);
    return { mod: await import('./useAssistantBridge'), storage };
}

afterEach(() => vi.unstubAllGlobals());

describe('the head unit', () => {
    it('is known by the launcher’s query, after a sign-in took the referrer away', async () => {
        const { mod, storage } = await load('?from=manifold', 'https://m3.tsunagi.app/');
        expect(mod.OPENED_BY_LAUNCHER).toBe(true);
        expect(storage.m.size).toBe(0);
        expect(mod.isHeadUnit()).toBe(true);
        expect(storage.getItem(mod.NAV_KEY)).toBe('1');
    });

    it('is known by the launcher’s referrer when there is no query', async () => {
        const { mod } = await load('', 'android-app://app.tsunagi.e46m3.launcher/');
        expect(mod.isHeadUnit()).toBe(true);
    });

    it('stays known on a later page the launcher did not open', async () => {
        const first = await load('?from=manifold');
        first.mod.isHeadUnit();
        vi.resetModules();
        vi.stubGlobal('location', { search: '', href: 'https://e46m3-monitoring-preview.pages.dev/' });
        const later = await import('./useAssistantBridge');
        expect(later.OPENED_BY_LAUNCHER).toBe(false);
        expect(later.isHeadUnit()).toBe(true);
    });

    it('is not a phone opened from a link', async () => {
        const { mod, storage } = await load('', 'https://m3.tsunagi.app/');
        expect(mod.isHeadUnit()).toBe(false);
        expect(storage.m.size).toBe(0);
    });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { CHROME } from './chrome';
import { en } from './en';
import { ja } from './ja';
import { STRINGS, langFor } from './index';

describe('the chrome / prose boundary', () => {
    it('leaves nothing in the catalogs that is the same in both languages', () => {
        // The rule, stated as a property: if a string is identical in ja and en
        // it is not prose, it is an instrument token, and it belongs in
        // chrome.ts as ONE value. This was true of 29 keys that had been kept in
        // step by hand; the test is what stops the thirtieth being written twice.
        const j = ja as unknown as Record<string, unknown>;
        const e = en as unknown as Record<string, unknown>;
        const shared = Object.keys(j).filter((k) => typeof j[k] !== 'function' && j[k] === e[k]);
        expect(shared, 'move these to chrome.ts').toEqual([]);
    });

    it('declares the same keys in both catalogs', () => {
        expect(Object.keys(ja)).toEqual(Object.keys(en));
    });

    it('has no chrome key shadowed by a catalog', () => {
        // The spread in index.ts puts CHROME first, so a catalog key of the same
        // name would WIN silently. `Localised` does not declare them, which
        // makes that a compile error — this asserts the runtime agrees.
        const chromeKeys = new Set(Object.keys(CHROME));
        expect(Object.keys(ja).filter((k) => chromeKeys.has(k))).toEqual([]);
        expect(Object.keys(en).filter((k) => chromeKeys.has(k))).toEqual([]);
    });

    it('serves one object to both languages', () => {
        for (const k of Object.keys(CHROME) as (keyof typeof CHROME)[]) {
            expect(STRINGS.ja[k], k).toBe(STRINGS.en[k]);
        }
    });

    it('resolves to a catalog with every key', () => {
        const total = Object.keys(CHROME).length + Object.keys(ja).length;
        expect(Object.keys(STRINGS.ja).length).toBe(total);
        expect(Object.keys(STRINGS.en).length).toBe(total);
        // A floor, not a count. The exact number is a snapshot that every new
        // string would have to edit — which is how a check stops being read and
        // starts being updated. What is worth catching is a catalog that
        // SHRANK: a bad merge, or a spread that silently dropped one side.
        expect(total).toBeGreaterThanOrEqual(225);
    });
});

describe('the language', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    /** A browser tab, as far as the module's import-time resolution can tell. */
    async function boot(language: string, storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>) {
        vi.stubGlobal('window', {});
        vi.stubGlobal('navigator', { language });
        vi.stubGlobal('localStorage', storage);
        vi.resetModules();
        return import('./index');
    }

    it("is the browser's: ja for any Japanese locale, en for every other", () => {
        expect(langFor('ja-JP')).toBe('ja');
        expect(langFor('ja')).toBe('ja');
        expect(langFor('JA-jp')).toBe('ja');
        expect(langFor('en-US')).toBe('en');
        expect(langFor('en-GB')).toBe('en');
        expect(langFor('de-DE')).toBe('en');
        // A browser that names no language is a reader we know nothing about,
        // which is never a reason to answer in the author's language.
        expect(langFor('')).toBe('en');
        expect(langFor(undefined)).toBe('en');
    });

    it('deletes what the retired ja | en switch stored, and follows the browser over it', async () => {
        // The trap in taking a switch away (tsunagi-m-ux §13): a resolver that
        // still read this would hold anyone who ever pressed EN in English,
        // with no control left on screen to change it.
        const kept = new Map([['e46m3.lang', 'en']]);
        const i18n = await boot('ja-JP', {
            getItem: (k) => kept.get(k) ?? null,
            setItem: (k, v) => void kept.set(k, v),
            removeItem: (k) => void kept.delete(k),
        });
        expect(i18n.getLang()).toBe('ja');
        expect(kept.has('e46m3.lang')).toBe(false);
    });

    it('still resolves when storage refuses every touch', async () => {
        const no = () => {
            throw new DOMException('The operation is insecure.', 'SecurityError');
        };
        const i18n = await boot('en-US', { getItem: no, setItem: no, removeItem: no });
        expect(i18n.getLang()).toBe('en');
    });
});

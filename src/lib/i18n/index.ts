'use client';

/**
 * One language rule, resolved in one module.
 *
 * Safety-relevant copy is written in the reader's language — never JP and EN
 * concatenated into one string. The old PWA had a catalog but never called
 * setLang and shipped ~327 hardcoded Japanese literals outside it, so the
 * advertised toggle did not exist. Everything user-visible goes through `t`
 * here so that cannot recur.
 *
 * The catalog was one 1,276-line file. It is four now, and the split is not
 * filing: `chrome.ts` holds the 29 tokens that are English in both languages as
 * ONE value, and `catalog.ts` types the other 196 without declaring them — so a
 * second, drifting spelling of DISCONNECT is a compile error rather than
 * something you find in a screenshot. What is left here is the store.
 */

import { useSyncExternalStore } from 'react';
import { CHROME } from './chrome';
import { en } from './en';
import { ja } from './ja';
import type { Catalog } from './catalog';

export type { Catalog, Localised } from './catalog';
export type { Chrome } from './chrome';

export type Lang = 'ja' | 'en';

const STORAGE_KEY = 'e46m3.lang';

/**
 * Both catalogues, exported so a test can assert that every value the DATA ships
 * has a label here. The maps inside are keyed by `string`, so the compiler
 * cannot: ten `system` tokens arrived with the body/comfort/AV modules and 533
 * jobs rendered a raw English token in the Japanese UI. See shippedData.test.ts.
 *
 * The chrome is spread into both rather than written into both. That is the
 * whole mechanism — there is one object, so the two languages cannot disagree
 * about it, and no test is needed to say so.
 */
export const STRINGS: Record<Lang, Catalog> = {
    ja: { ...CHROME, ...ja },
    en: { ...CHROME, ...en },
};

/** The name the app has always used for `t`'s type. */
export type Strings = Catalog;

let current: Lang = 'ja';
const listeners = new Set<() => void>();

/**
 * An explicit choice wins; otherwise the browser decides.
 *
 * Falling back to 'ja' unconditionally handed a first-time English-speaking user
 * a fully Japanese instrument — tabs, hub verbs, and the UNVERIFIED safety
 * banner — with only a 20px `ja | en` pair in the header corner to escape it.
 * A safety notice nobody can read is not a safety notice.
 */
function fromNavigator(): Lang {
    if (typeof navigator === 'undefined') return 'ja';
    return navigator.language?.toLowerCase().startsWith('ja') ? 'ja' : 'en';
}

function read(): Lang {
    try {
        const v = localStorage.getItem(STORAGE_KEY);
        if (v === 'en' || v === 'ja') return v;
    } catch {
        // Private mode. Fall through — the language is not a safety property,
        // only the copy it selects is.
    }
    return fromNavigator();
}

if (typeof window !== 'undefined') current = read();

export function getLang(): Lang {
    return current;
}

export function setLang(lang: Lang): void {
    if (lang === current) return;
    current = lang;
    try {
        localStorage.setItem(STORAGE_KEY, lang);
    } catch {
        /* the switch still applies for this session */
    }
    if (typeof document !== 'undefined') document.documentElement.lang = lang;
    listeners.forEach((l) => l());
}

function subscribe(l: () => void): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
}

/** Re-renders on a language change. Server snapshot is the default language. */
export function useLang(): { lang: Lang; t: Strings; setLang: (l: Lang) => void } {
    const lang = useSyncExternalStore(
        subscribe,
        () => current,
        () => 'ja' as Lang,
    );
    return { lang, t: STRINGS[lang], setLang };
}

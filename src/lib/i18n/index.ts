'use client';

/**
 * One language rule, resolved in one module.
 *
 * Safety-relevant copy is written in the reader's language — never JP and EN
 * concatenated into one string. The old PWA had a catalog but never switched
 * it and shipped ~327 hardcoded Japanese literals outside it, so its advertised
 * toggle did not exist. Everything user-visible goes through `t` here so that
 * cannot recur.
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

/**
 * Where the header's ja | en switch kept the reader's choice. The switch is gone
 * — the browser already has the answer (tsunagi-m-ux §13), and a 360px phone's
 * header has no 59px to spend on overriding it — and nothing reads this.
 *
 * It is DELETED at boot rather than just ignored, because of who has it: anyone
 * who ever pressed JA or EN. Left in place, the next change to this resolver
 * that reaches for storage again would pin those readers to a language with no
 * control left on screen to take them out of it.
 */
const RETIRED_KEY = 'e46m3.lang';

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

/**
 * The browser decides: `ja` for any Japanese locale, `en` for everything else.
 *
 * Falling back to 'ja' unconditionally handed a first-time English-speaking user
 * a fully Japanese instrument — tabs, hub verbs, and the UNVERIFIED safety
 * banner. A safety notice nobody can read is not a safety notice, so a browser
 * that names no language at all gets `en`, never the author's language.
 *
 * Exported for its test.
 */
export function langFor(language: string | undefined): Lang {
    return language?.toLowerCase().startsWith('ja') ? 'ja' : 'en';
}

/**
 * Resolved once, at import, in the browser. The prerender has no reader and
 * answers `ja` — the static `<html lang="ja">` — so the server HTML and the
 * first client render agree; `useLang` moves to the resolved value after
 * hydration, and page.tsx writes it to `<html lang>`.
 */
let current: Lang = 'ja';
if (typeof window !== 'undefined') {
    current = langFor(navigator.language);
    try {
        localStorage.removeItem(RETIRED_KEY);
    } catch {
        // Private mode: storage refused, so nothing was kept there either.
    }
}

export function getLang(): Lang {
    return current;
}

/** Nothing to subscribe to: the language is the browser's, read once, and the page has no switch. */
const subscribeNever = () => () => {};

/** The resolved language and its strings. Server snapshot: the prerender's `ja`. */
export function useLang(): { lang: Lang; t: Strings } {
    const lang = useSyncExternalStore(
        subscribeNever,
        () => current,
        () => 'ja' as Lang,
    );
    return { lang, t: STRINGS[lang] };
}

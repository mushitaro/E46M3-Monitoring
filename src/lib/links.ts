/**
 * Where this app links out to, declared once.
 *
 * Two destinations: MESH, from the CREDITS colophon, and the privacy policy's preview section, which says what the preview
 * build stores and sends (its SYNC and its error records) and for how long. The header's PRIVACY
 * and the preview's first-run notice (DisclaimerDialog) both open it. Production has no such link
 * because it sends nothing — its promise is in THIRD-PARTY-NOTICES.md §1 and public/_headers.
 *
 * Every external link opens in a new tab with `noopener noreferrer`: a same-tab navigation away
 * from this page would drop the cable link and whatever has not been saved.
 */
/**
 * MESH — where the work continues and who carries it. Linked once, from the CREDITS colophon
 * (tsunagi-m-chrome §4). A plain <a>, opened in a new tab; nothing is prefetched, so the app still
 * makes no request of its own.
 */
export const MESH = {
    ja: 'https://m3.tsunagi.app/mesh',
    en: 'https://m3.tsunagi.app/en/mesh',
} as const;

export const PRIVACY_PREVIEW = {
    ja: 'https://m3.tsunagi.app/privacy-policy#preview',
    en: 'https://m3.tsunagi.app/en/privacy-policy#preview',
} as const;

/**
 * Where this app links out to, declared once.
 *
 * Only one destination so far: the privacy policy's preview section, which says what the preview
 * build stores and sends (its SYNC and its error records) and for how long. Production has no such
 * link because it sends nothing — its promise is in THIRD-PARTY-NOTICES.md §1 and public/_headers.
 *
 * Every external link opens in a new tab with `noopener noreferrer`: a same-tab navigation away
 * from this page would drop the cable link and whatever has not been saved.
 */
export const PRIVACY_PREVIEW = {
    ja: 'https://m3.tsunagi.app/privacy-policy#preview',
    en: 'https://m3.tsunagi.app/en/privacy-policy#preview',
} as const;

/**
 * Which features a build variant shows — the registry that keeps the preview's extras out of a
 * production build.
 *
 * Ported, minimally, from the CSL tuner (`E46M3CSL_TuningTool/src/lib/features.ts`). One compiled
 * output serves every variant: the preview is distinguished only by a `<meta name="app-variant">`
 * that `scripts/brand-preview.mjs` injects after the build, read at runtime by
 * `lib/build-variant.ts`. Nothing is branched at compile time, so production and preview cannot
 * drift apart in code — they differ by one word here and one meta tag there.
 *
 * ## Stages
 *
 *   - `stable`        — every variant. What a production build shows.
 *   - `experimental`  — preview only, awaiting promotion. Nothing here is experimental today; the
 *                       stage exists so that "not yet" is never spelled `preview-only`.
 *   - `preview-only`  — preview only, and NEVER promoted. A deliberate decision, not immaturity.
 *
 * ## Why `sessionSync` is preview-only
 *
 * Production is network-free: the app talks to the cable and to nothing else, and
 * THIRD-PARTY-NOTICES.md §1 and public/_headers say so in as many words. The preview is a different
 * promise, made to a different audience: the operator decided (2026-09-23) that owners holding
 * `owner_preview` get per-owner SYNC — sessions they choose to send, and error records the app
 * sends by itself — behind the owner gate, disclosed on m3's /preview-notice and in its privacy
 * policy (#preview). Promoting this stage would make the production sentence false, which is why
 * `features.test.ts` asserts the stage directly and not merely through the tab set.
 *
 * The whole SESSIONS surface is under it, the on-device store included: a production build has no
 * SESSIONS tab, writes nothing to IndexedDB and makes no request of its own.
 */
import type { Tab } from '@/lib/tabs';

export type FeatureStage = 'stable' | 'experimental' | 'preview-only';

export type FeatureName = 'instrument' | 'sessionSync';

/**
 * Every tab has exactly one owner here; the test says so. The ORDER of tabs is not stated — that is
 * `TAB_ORDER` in lib/tabs — this only answers "may this render in this variant".
 */
export const FEATURES: Record<FeatureName, { stage: FeatureStage; tabs: readonly Tab[] }> = {
    // The instrument itself: what production has always been.
    instrument: { stage: 'stable', tabs: ['diagnosis', 'datalog', 'adaptation', 'service', 'actuator'] },
    // Never promoted — see the header. Owns the SESSIONS tab, and every SYNC surface and the
    // automatic error records are gated on the same bit where they render or fire.
    sessionSync: { stage: 'preview-only', tabs: ['sessions'] },
};

/**
 * The dev server counts as preview. The meta tag is injected after the build, so `next dev` never
 * carries it, and a dev session without SESSIONS would be a dev session on the wrong app. Only the
 * SURFACES open in dev: the cloud half asks `isPreviewBuild()` (the meta tag itself), so `next dev`
 * still sends nothing. NODE_ENV is inlined by Next: 'production' in every exported build.
 */
export const DEV_VARIANT_IS_PREVIEW = process.env.NODE_ENV !== 'production';

/** Whether a feature may render in this variant. */
export function featureEnabled(name: FeatureName, isPreview: boolean): boolean {
    return FEATURES[name].stage === 'stable' || isPreview;
}

/** The tabs this variant may render, in no particular order — the order is lib/tabs'. */
export function enabledTabs(isPreview: boolean): ReadonlySet<Tab> {
    const out = new Set<Tab>();
    for (const name of Object.keys(FEATURES) as FeatureName[]) {
        if (featureEnabled(name, isPreview)) FEATURES[name].tabs.forEach((t) => out.add(t));
    }
    return out;
}

'use client';

import { useSyncExternalStore } from 'react';
import { DEV_VARIANT_IS_PREVIEW, featureEnabled, type FeatureName } from '@/lib/features';

/**
 * Which build this is, read from the `<meta name="app-variant">` that `scripts/brand-preview.mjs`
 * injects into the export. Ported, minimally, from the CSL tuner's `build-variant.ts`; the scope
 * switch and the badge that tool has are not ported (there is one non-production variant here).
 *
 * ## Why a hook and not a module constant
 *
 * `export const isPreview = document.querySelector(...)` evaluates to false during the static
 * prerender and to the truth on the client, so the hydrating render would disagree with the markup
 * it hydrates. `useSyncExternalStore` with a server snapshot of "production" is the API for
 * exactly this — the same reasoning `useTransportKind` in hooks/useDs2Link.ts records.
 *
 * Nothing to subscribe to: the tag cannot change while the document is alive.
 */
const subscribeNever = () => () => {};

const readTag = (): string =>
    document.querySelector('meta[name="app-variant"]')?.getAttribute('content') ?? '';

/**
 * `preview`, or empty for production. Empty rather than 'production' because nothing writes that
 * tag: production is the build nobody branded, and naming the absence would invent a value no code
 * path can produce.
 */
export function useBuildVariant(): string {
    return useSyncExternalStore(subscribeNever, readTag, () => '');
}

/** Whether the preview's surfaces render: the preview build, or the dev server (see features.ts). */
export function usePreviewSurfaces(): boolean {
    return useBuildVariant() === 'preview' || DEV_VARIANT_IS_PREVIEW;
}

/** The registry's answer for one feature, in this build. Prefer this over comparing strings. */
export function useFeatureEnabled(name: FeatureName): boolean {
    return featureEnabled(name, usePreviewSurfaces());
}

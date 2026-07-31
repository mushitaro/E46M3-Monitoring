/**
 * The single source of the app version.
 *
 * The old app had three of these that had drifted apart (a service-worker
 * cache key, the host's `/api/version`, and the disclaimer's own constant) and
 * displayed none of them, so a user reporting a bug could not say which build
 * they were on. Every surface that states a version — the header, the feedback
 * payload, the cache key — reads this.
 */
export const APP_VERSION = '0.1.0';

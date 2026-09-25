/**
 * The owner gate, in front of everything this origin serves.
 *
 * The preview is for people m3 says hold `owner_preview` — MILE purchasers and the owners whose
 * cars were worked on — and that includes the ECU tables under /ecu-data/, which are BMW-derived
 * and are the reason this app was ever behind a gate at all (THIRD-PARTY-NOTICES.md §3.3). The
 * gate itself is tsunagi-m3's canonical copy (`_owner-gate/`, checked by `npm run gate:verify`);
 * this file only says which app it is guarding.
 *
 * `publicPaths` is the manifest and the icons it and the documents name, because a browser fetches
 * those WITHOUT cookies when it installs the app. They are the BRANDED names — the preview build is
 * the only one deployed here, and scripts/brand-preview.mjs moves every reference to the -dev- set
 * — and scripts/verify-export.mjs fails a branded build that references an icon not listed here.
 */
import { createGate, type GateContext } from './_owner-gate/gate';

const gate = createGate({
    clientId: 'monitoring-preview',
    canonicalHost: 'e46m3-monitoring-preview.pages.dev',
    // The title of the gate's own pages: the build's name as its users see it, the manifest's
    // `name` (WORKS, operator 2026-09-25). clientId and canonicalHost are identifiers; they keep
    // `preview`.
    name: 'E46M3 /// MONITORING — WORKS',
    publicPaths: [
        '/manifest.webmanifest',
        '/icons/monitoring-dev-192.png',
        '/icons/monitoring-dev-512.png',
        '/icons/monitoring-dev-maskable-192.png',
        '/icons/monitoring-dev-maskable-512.png',
        '/icons/monitoring-dev-256.png',
        '/icons/monitoring-dev-32.png',
    ],
});

// Pages hands the middleware its full EventContext; the gate reads four members of it and says so
// in its own type, which is why this file needs no @cloudflare/workers-types.
export const onRequest = (context: GateContext) => gate(context);

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
//
// One thing is added around the canonical gate: a WebSocket upgrade it admits (the assistant
// bridge, functions/api/bridge/socket.ts) goes back to the browser as it came. The gate re-marks
// every response it passes by rebuilding it, and a 101 does not survive being rebuilt — so the gate
// is handed a stand-in to re-mark, and the real answer is returned instead. It is only ever the
// answer of a request the gate let through: refused, the gate never calls next().
export const onRequest = async (context: GateContext): Promise<Response> => {
    let upgrade: Response | null = null;
    const res = await gate({
        ...context,
        next: async () => {
            const r = await context.next();
            if (r.status !== 101) return r;
            upgrade = r;
            return new Response(null, { status: 204 });
        },
    });
    return upgrade ?? res;
};

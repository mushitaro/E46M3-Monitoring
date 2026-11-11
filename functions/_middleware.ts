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
 * The one entry that is neither is `/.well-known/assetlinks.json`, for the head unit's launcher —
 * see its comment below.
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
        // Read by Chrome, with no cookie, to decide whether TSUNAGI///Manifold (the head unit's
        // launcher, app.tsunagi.e46m3.launcher) may open this build as a full-screen Trusted Web
        // Activity — its M console's MONITORING key opens this origin (operator, 2026-10-28). A 401
        // here is not an error Chrome reports anywhere: it shows its toolbar and carries on. The
        // file names one package and one signing-certificate fingerprint, both already public (TUNER
        // serves the same bytes). Nothing under /ecu-data/ is opened by this entry: it is one exact
        // path, not a prefix. Measured 401 on 2026-10-28, before the file or this line existed.
        '/.well-known/assetlinks.json',
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

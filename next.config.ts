import type { NextConfig } from "next";
import path from "node:path";

// Static export: the app talks to the car directly over Web Serial, so there is
// no server side to this product at all. `out/` deploys to Cloudflare Pages
// as-is. Matching the CSL tuner's setup deliberately.
//
// This is also why the npm audit findings against `next` do not apply here:
// every one of them is about a server feature (Image Optimizer, Server
// Components, Server Actions, Middleware/Proxy, rewrites, PPR resume, RSC cache
// poisoning). A static export ships none of them — Cloudflare serves plain
// files. See THIRD-PARTY-NOTICES.md §5.
const nextConfig: NextConfig = {
  // Pin the workspace root. There is an unrelated package-lock.json in the home
  // directory, and Turbopack otherwise infers C:\Users\kazuh as the root and
  // warns on every build.
  turbopack: {
    root: path.resolve(__dirname),
  },
  output: 'export',
  // Always a literal, so the end-to-end door (src/lib/e2e.ts) folds away in every build but
  // `npm run build:e2e`'s, and verify-export can prove it did.
  env: {
    NEXT_PUBLIC_MONITORING_E2E: process.env.NEXT_PUBLIC_MONITORING_E2E === '1' ? '1' : '0',
  },
  images: {
    unoptimized: true,
  },
};

export default nextConfig;

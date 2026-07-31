import type { NextConfig } from "next";

// Static export: the app talks to the car directly over Web Serial, so there is
// no server component to this product at all. `out/` deploys to Cloudflare Pages
// as-is. Matching the CSL tuner's setup deliberately — see docs/ARCHITECTURE.md.
const nextConfig: NextConfig = {
  output: 'export',
  images: {
    unoptimized: true,
  },
};

export default nextConfig;

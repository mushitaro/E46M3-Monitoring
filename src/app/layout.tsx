import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { OfflineCache } from "@/components/OfflineCache";
import "./globals.css";

// Two families, split by meaning: Inter for UI chrome, JetBrains Mono for
// machine data (ECU IDs, RPM, DS2 telegrams, fault codes, timestamps). Both are
// exposed as CSS variables that globals.css maps onto Tailwind's --font-sans /
// --font-mono, so the font-sans / font-mono utilities actually resolve — a
// dangling var() there fails silently rather than erroring.
const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
});

export const metadata: Metadata = {
  title: "E46M3 /// MONITORING",
  description: "E46 M3 diagnostics over DS2 / K-line — MSS54, SMG II, DSC",
  manifest: "/manifest.webmanifest",
  // The launcher icons are CHOSEN from M ICON, not drawn here (tsunagi-m-release
  // §4): `monitoring`, written into public/icons/ by tsunagi-m3's
  // scripts/m-icons.mjs. This is the PRODUCTION set — black mark on white. A
  // preview build is branded after the compile: scripts/brand-preview.mjs moves
  // every one of these references to the -dev- set (white on black), so there is
  // one source of truth here and no compile-time branch.
  //
  // PNG only. Chrome's installability criteria and Android launchers want
  // 192/512 PNGs, and iOS Safari does not read SVG icons at all. The favicon is
  // the 32 from the same family, so a tab and a home screen show one mark.
  icons: {
    icon: [
      { url: "/icons/monitoring-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/monitoring-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/monitoring-512.png", sizes: "512x512", type: "image/png" },
    ],
    // The 256, as it is. M ICON is opaque, which is what iOS needs: it does not
    // honour transparency and would composite an alpha channel onto black.
    apple: [{ url: "/icons/monitoring-256.png", sizes: "256x256", type: "image/png" }],
  },
  // Installed to a home screen this is the app's own window, so it says so.
  // `black` rather than `black-translucent`: translucent puts the status bar ON
  // TOP of the layout, which is only correct for a design that pads by
  // env(safe-area-inset-*), and nothing here does.
  // No `title` on purpose: it falls back to the manifest's short_name, which keeps the
  // home-screen label in one place — and it is the one label brand-preview.mjs changes.
  appleWebApp: { capable: true, statusBarStyle: "black" },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  colorScheme: "dark",
  themeColor: "#000000",
  // `viewportFit: 'cover'` was set here and is deliberately gone. It tells the
  // browser to lay the page out edge to edge UNDER the notch and the gesture
  // bar, and it is only correct once something pads by env(safe-area-inset-*).
  // Nothing in this app does, so all it did was move content underneath the
  // hardware — on the device class this tool is built for. Restoring it is a UI
  // change with a padding pass attached, not a line on its own.
};

// `lang` is set to the default UI language here and corrected client-side once
// the real language is resolved (app/page.tsx). This is a static export, so
// every visitor is served this same attribute regardless of who they are —
// treat it as a prerender placeholder, not as the answer.
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body
        // `100svh`, not `100vh` and not `100dvh`. With the URL bar showing,
        // `vh` makes the body taller than the page by exactly that bar's height
        // and the whole document scrolls; `dvh` grows when the chrome retracts
        // and then loses its own bottom when it comes back. `svh` is the
        // smallest stable viewport, which is the one a fixed-height instrument
        // layout can be built against.
        className={`${inter.variable} ${jetbrainsMono.variable} ${inter.className} bg-slate-950 text-slate-100 min-h-[100svh]`}
      >
        {children}
        {/* Renders nothing. Mounted here so the registration effect runs once,
            on the client, after hydration — see components/OfflineCache.tsx. */}
        <OfflineCache />
      </body>
    </html>
  );
}

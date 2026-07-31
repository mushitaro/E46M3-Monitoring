import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
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
  title: "E46M3 /// DIAGNOSIS",
  description: "E46 M3 diagnostics over DS2 / K-line — MSS54, SMG II, DSC",
  manifest: "/manifest.webmanifest",
  // PNG first: Chrome's installability criteria and Android launchers want
  // 192/512 PNGs, and iOS Safari does not read SVG manifest icons at all. The
  // old app shipped a single 622-byte SVG and an apple-touch-icon pointing at
  // it, which iOS silently ignores.
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { url: "/icon.svg", type: "image/svg+xml" },
    ],
    apple: [{ url: "/icon-192.png", sizes: "192x192", type: "image/png" }],
  },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#000000",
  viewportFit: "cover",
};

// `lang` is set to the default UI language here and updated client-side when the
// user switches (the app is a static export, so there is no server-side locale
// negotiation). Safety-relevant copy is resolved through one language module —
// never concatenated JA+EN in a single string.
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body
        className={`${inter.variable} ${jetbrainsMono.variable} ${inter.className} bg-slate-950 text-slate-100 min-h-screen`}
      >
        {children}
      </body>
    </html>
  );
}

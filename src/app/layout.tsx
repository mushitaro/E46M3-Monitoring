import type { Metadata } from "next";
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
  icons: {
    icon: "/icon.svg",
  },
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

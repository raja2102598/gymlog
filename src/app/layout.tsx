import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { preconnect } from "react-dom";
import { SUPABASE_URL } from "@/lib/config";
import { THEME_SCRIPT } from "@/lib/theme";
import { BG } from "@/design/tokens.gen";
import { nunito } from "./fonts";
import "@/styles/tokens.css";
import "@/styles/base.css";
import "@/styles/shell.css";
import "@/styles/ds.css";
import "@/styles/home.css";
import "@/styles/train.css";
import "@/styles/health.css";
import "@/styles/progress.css";
import "@/styles/plan.css";
import "@/styles/settings.css";
import "@/styles/library.css";
import "@/styles/signin.css";

export const metadata: Metadata = {
  title: "Gym Log",
  description: "Daily tracker for your gym plan, cardio, steps and body weight.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icons/gymlog-mark.svg", type: "image/svg+xml" },
      { url: "/icons/icon-192.png", type: "image/png" },
    ],
    apple: "/icons/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: BG.dark },
    { media: "(prefers-color-scheme: light)", color: BG.light },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  // Opens the connection to the database while the page loads, so the first sync doesn't wait for it.
  if (SUPABASE_URL) preconnect(new URL(SUPABASE_URL).origin, { crossOrigin: "anonymous" });
  return (
    // The theme script sets data-theme on <html> before the first paint (a theme picked in Settings), which React
    // would otherwise report as a mismatch.
    <html lang="en" className={nunito.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}

import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { oswald, plexMono, plexSans } from "./fonts";
import "@/styles/tokens.css";
import "@/styles/base.css";
import "@/styles/today.css";
import "@/styles/dashboard.css";
import "@/styles/plan.css";

export const metadata: Metadata = {
  title: "Gym Log",
  description: "Daily tracker for a 5-day gym split, cardio, steps and body weight.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: { url: "/icons/icon-192.png", type: "image/png" },
    apple: "/icons/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#15171b" },
    { media: "(prefers-color-scheme: light)", color: "#eef0f2" },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${oswald.variable} ${plexSans.variable} ${plexMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}

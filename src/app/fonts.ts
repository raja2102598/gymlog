import localFont from "next/font/local";

// Served from this site (no font CDN), so they load offline from the app cache. SIL Open Font License:
// see src/fonts/OFL-*.txt. Oswald and IBM Plex Sans are variable fonts.
export const oswald = localFont({
  src: "../fonts/oswald-latin.woff2",
  weight: "500 600",
  display: "swap",
  variable: "--font-oswald",
});

export const plexSans = localFont({
  src: "../fonts/ibm-plex-sans-latin.woff2",
  weight: "400 700",
  display: "swap",
  variable: "--font-plex-sans",
  declarations: [{ prop: "font-stretch", value: "100%" }],
});

// Numbers only, so it isn't worth holding up the first paint for.
export const plexMono = localFont({
  src: [
    { path: "../fonts/ibm-plex-mono-500-latin.woff2", weight: "500" },
    { path: "../fonts/ibm-plex-mono-600-latin.woff2", weight: "600" },
  ],
  display: "swap",
  variable: "--font-plex-mono",
  preload: false,
});

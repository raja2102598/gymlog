import localFont from "next/font/local";

// Nunito, the one family (weights 600 to 900 carry the hierarchy). Served from this site rather than a font CDN, so it
// loads offline from the app cache. A variable font, SIL Open Font License: see src/fonts/OFL-nunito.txt. Its figures
// are tabular already; tokens.css asks for "tnum" as well, for any fallback font.
export const nunito = localFont({
  src: "../fonts/nunito-latin.woff2",
  weight: "600 900",
  display: "swap",
  variable: "--font-nunito",
});

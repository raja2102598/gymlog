// Draws the app icons and splash screens from the logo (the angled dumbbell of the design system's Logos,
// public/icons/gymlog-mark.svg) in the brand and background colours of src/design/tokens.json: the website's icons
// (public/icons) and the Android app's launcher icons and splash screens. Run `node scripts/build-icons.mjs` after the
// logo or those colours change; it keeps each file's size.
import fs from "node:fs";
import { chromium } from "playwright-core";

const tokens = JSON.parse(fs.readFileSync(new URL("../src/design/tokens.json", import.meta.url), "utf8"));
const color = (name, theme = "dark") => tokens.color.tokens.find((t) => t.name === name).value[theme];
const BRAND = color("brand"), ON = color("on-brand"), BG = color("bg");

/** The dumbbell alone, in `fill`, as SVG shapes in a 100×100 box. */
const glyph = (fill) =>
  `<g transform="rotate(-45 50 50)" fill="${fill}"><rect x="24" y="46" width="52" height="8" rx="4"/><rect x="22" y="30" width="12" height="40" rx="6"/><rect x="66" y="30" width="12" height="40" rx="6"/><rect x="13" y="38" width="8" height="24" rx="4"/><rect x="79" y="38" width="8" height="24" rx="4"/></g>`;
/** The mark: the dumbbell on a brand square with a 24% corner, the square `inset` in from the edge (0 to 1 of the side). */
const mark = (inset = 0, radius = 24) => {
  const s = 100 * (1 - 2 * inset), o = 100 * inset;
  return `<rect x="${o}" y="${o}" width="${s}" height="${s}" rx="${(radius * s) / 100}" fill="${BRAND}"/><g transform="translate(${o} ${o}) scale(${s / 100})">${glyph(ON)}</g>`;
};
const svg = (w, h, body, vb = "0 0 100 100") => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${vb}" preserveAspectRatio="xMidYMid meet">${body}</svg>`;

const size = (file) => {
  const d = fs.readFileSync(file);
  return [d.readUInt32BE(16), d.readUInt32BE(20)];
};

const jobs = [
  // The website: the mark as it is, iOS's full-bleed square (it rounds the corners itself), and a maskable icon whose
  // dumbbell stays inside the middle 60%.
  ["public/icons/icon-192.png", () => svg(192, 192, mark())],
  ["public/icons/icon-512.png", () => svg(512, 512, mark())],
  ["public/icons/apple-touch-icon.png", () => svg(180, 180, mark(0, 0))],
  ["public/icons/icon-maskable-512.png", () => svg(512, 512, `<rect width="100" height="100" fill="${BRAND}"/><g transform="translate(20 20) scale(0.6)">${glyph(ON)}</g>`)],
];
for (const d of ["mdpi", "hdpi", "xhdpi", "xxhdpi", "xxxhdpi"]) {
  const dir = `android/app/src/main/res/mipmap-${d}`;
  jobs.push([`${dir}/ic_launcher.png`, (w, h) => svg(w, h, mark(0.04))]);
  jobs.push([`${dir}/ic_launcher_round.png`, (w, h) => svg(w, h, `<circle cx="50" cy="50" r="48" fill="${BRAND}"/><g transform="translate(18 18) scale(0.64)">${glyph(ON)}</g>`)]);
  // Adaptive icon: the foreground on transparent, inside the 72dp safe zone of 108dp (its background is the colour).
  jobs.push([`${dir}/ic_launcher_foreground.png`, (w, h) => svg(w, h, `<g transform="translate(29 29) scale(0.42)">${glyph(ON)}</g>`)]);
}
for (const d of ["drawable", ...["hdpi", "mdpi", "xhdpi", "xxhdpi", "xxxhdpi"].flatMap((x) => [`drawable-land-${x}`, `drawable-port-${x}`])]) {
  // Splash: the mark at a quarter of the short side, centred on the dark background.
  jobs.push([
    `android/app/src/main/res/${d}/splash.png`,
    (w, h) => {
      const m = Math.min(w, h) * 0.25;
      return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="${BG}"/><svg x="${(w - m) / 2}" y="${(h - m) / 2}" width="${m}" height="${m}" viewBox="0 0 100 100">${mark()}</svg></svg>`;
    },
  ]);
}

const browser = await chromium.launch();
const page = await browser.newPage();
for (const [file, draw] of jobs) {
  const [w, h] = size(file);
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(`<html><body style="margin:0;background:transparent">${draw(w, h)}</body></html>`);
  await page.screenshot({ path: file, omitBackground: true, clip: { x: 0, y: 0, width: w, height: h } });
  console.log("drew", file, `${w}×${h}`);
}
await browser.close();

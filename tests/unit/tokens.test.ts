import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error: a plain .mjs script, with no types
import { generate } from "../../scripts/build-tokens.mjs";
import tokens from "../../src/design/tokens.json";

type Theme = "dark" | "light";
const color = new Map(tokens.color.tokens.map((t) => [t.name, t.value as Record<Theme, string>]));
const hex = (name: string, theme: Theme) => {
  const v = color.get(name)?.[theme];
  if (!v) throw new Error(`no token ${name}`);
  return v;
};
/** WCAG 2 contrast ratio of two #rrggbb colours. */
function contrast(a: string, b: string): number {
  const lum = (h: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe("design tokens", () => {
  it("generates tokens.css, its public copy and tokens.gen.ts from tokens.json (run `npm run tokens`)", () => {
    const { css, ts } = generate();
    expect(fs.readFileSync("src/styles/tokens.css", "utf8")).toBe(css);
    expect(fs.readFileSync("public/tokens.css", "utf8")).toBe(css);
    expect(fs.readFileSync("src/design/tokens.gen.ts", "utf8")).toBe(ts);
  });

  it("gives every colour a value in both themes, dark first", () => {
    expect(tokens.color.themes.map((t) => t.id)).toEqual(["dark", "light"]);
    for (const t of tokens.color.tokens) for (const th of ["dark", "light"] as const) expect((t.value as Record<Theme, string>)[th], `${t.name} ${th}`).toMatch(/^#[0-9A-F]{6}([0-9A-F]{2})?$/);
  });

  // Text and the ground it sits on, as the screens use them. 4.5:1 in both themes.
  const TEXT: [string, string][] = [
    ["ink", "bg"],
    ["ink", "surface"],
    ["ink", "surface-sunken"],
    ["ink", "surface-selected"],
    ["ink-muted", "bg"],
    ["ink-muted", "surface"],
    ["ink-muted", "surface-sunken"],
    ["ink-muted", "brand-row"],
    ["brand-text", "bg"],
    ["brand-text", "surface"],
    ["brand-text", "brand-row"],
    ["brand-text", "brand-tint"],
    ["on-brand", "brand"],
    ["brand-tint-ink", "brand-tint"],
    ["brand-tint-ink", "brand-partial"],
    ["warn-ink", "warn-bg"],
    ["on-warn", "warn"],
    ["info-ink", "info-bg"],
    ["success", "success-bg"],
    ["success", "surface"],
    ["danger", "surface"],
    ["steps-text", "surface"],
    ["sleep", "surface"],
    ["heart", "surface"],
    ["energy-text", "surface"],
    ["body", "surface"],
    ["water", "surface"],
  ];
  it.each(["dark", "light"] as const)("keeps text at 4.5:1 or better in the %s theme", (th) => {
    for (const [fg, bg] of TEXT) expect(contrast(hex(fg, th), hex(bg, th)), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
  });
  it.each(["dark", "light"] as const)("keeps icons and field edges at 3:1 or better in the %s theme", (th) => {
    for (const [fg, bg] of [["ink-subtle", "surface"], ["water", "water-tint"], ["body", "body-tint"], ["steps", "surface"]] as const)
      expect(contrast(hex(fg, th), hex(bg, th)), `${fg} on ${bg}`).toBeGreaterThanOrEqual(3);
  });

  it("has no colour values anywhere else in the source", () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, d.name);
        if (d.isDirectory()) walk(p);
        else if (/\.(tsx?|css|js|mjs)$/.test(d.name) && !/tokens\.(css|gen\.ts)$/.test(d.name)) {
          const text = fs.readFileSync(p, "utf8");
          for (const m of text.matchAll(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b|\brgba?\(|\bhsla?\(/g)) hits.push(`${p}: ${m[0]}`);
        }
      }
    };
    walk("src");
    expect(hits).toEqual([]);
  });

  it("uses Nunito only", () => {
    const css = fs.readdirSync("src/styles").map((f) => fs.readFileSync(`src/styles/${f}`, "utf8")).join("\n");
    expect(css).not.toMatch(/Oswald|Plex|text-transform:\s*uppercase/i);
    expect(fs.readFileSync("src/app/fonts.ts", "utf8")).toMatch(/nunito-latin\.woff2/);
  });
});

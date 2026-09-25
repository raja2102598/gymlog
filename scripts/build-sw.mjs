// Writes out/sw.js, the offline copy of the site that `next build` just exported to out/: the service
// worker in src/service-worker.js, with the list of files to keep (SHELL) and a VERSION that is a hash of
// all of them. Every build that changes any file changes VERSION, so there's nothing to bump by hand.
import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const OUT = path.resolve("out");
// Not kept: the service worker itself, the 404 page, React Server Component payloads (only used when
// moving between pages, and this app has one) and source maps. index.html is kept as "/". Nor are the exercise
// library's pictures and steps (public/exercises, over a thousand small files): each is kept the first time it's
// shown, so a first visit doesn't download them all.
const skip = (f) => f === "sw.js" || f === "404.html" || f.startsWith("_not-found") || f.startsWith("404/") || f.startsWith("exercises/") || f.endsWith(".txt") || f.endsWith(".map");

async function files(dir, base = "") {
  const out = [];
  for (const d of await readdir(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${d.name}` : d.name;
    if (d.isDirectory()) out.push(...(await files(path.join(dir, d.name), rel)));
    else out.push(rel);
  }
  return out;
}

const html = await readFile(path.join(OUT, "index.html"), "utf8").catch(() => {
  throw new Error("out/index.html is missing: run `next build` first");
});
// Polyfills for browsers without JavaScript modules: the phones this app runs on never load them.
const legacy = new Set([...html.matchAll(/<script src="\/([^"]+)" noModule=""/g)].map((m) => m[1]));
const all = (await files(OUT)).filter((f) => !skip(f) && !legacy.has(f)).sort();
const hash = createHash("sha256");
for (const f of all) hash.update(f).update("\0").update(await readFile(path.join(OUT, f))).update("\0");
const version = "gymlog-" + hash.digest("hex").slice(0, 12);
const shell = all.map((f) => (f === "index.html" ? "/" : "/" + f));

const worker = await readFile(path.resolve("src/service-worker.js"), "utf8");
await writeFile(path.join(OUT, "sw.js"), `const VERSION = ${JSON.stringify(version)};\nconst SHELL = ${JSON.stringify(shell, null, 1)};\n\n${worker}`);
console.log(`out/sw.js: ${version}, ${shell.length} files`);

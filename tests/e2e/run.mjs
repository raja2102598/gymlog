// Runs the end-to-end tests against the built site: `npm run build`, then `npm run test:e2e`.
// Pass suite names to run only those, e.g. `npm run test:e2e -- today dashboard`.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";
import { serve } from "../../scripts/serve.mjs";
import { checker } from "./harness.mjs";

const SUITES = ["today", "dashboard", "layout", "pace", "offline"];
const only = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const OUT = path.resolve("out");
if (!fs.existsSync(path.join(OUT, "sw.js"))) {
  console.error("No build in out/: run `npm run build` first.");
  process.exit(2);
}

// The site, and a throwaway copy of it that the update test "deploys" to.
const copyDir = fs.mkdtempSync(path.join(os.tmpdir(), "gymlog-e2e-"));
fs.cpSync(OUT, copyDir, { recursive: true });
const servers = [await serve(OUT, 4173), await serve(copyDir, 4174)];
const base = "http://127.0.0.1:4173/", copy = { url: "http://127.0.0.1:4174/", dir: copyDir };

// No proxy for the local servers, whatever the environment says.
const browser = await chromium.launch({ proxy: undefined });
const all = [];
let crashed = false;
for (const name of SUITES.filter((s) => !only.length || only.includes(s))) {
  console.log(`\n# ${name}`);
  const { check, results } = checker(name);
  try {
    const { default: suite } = await import(`./${name}.e2e.mjs`);
    await suite({ browser, base, copy, check });
  } catch (e) {
    crashed = true;
    console.error(`CRASHED in ${name}:`, e);
  }
  all.push(...results);
}
await browser.close();
for (const s of servers) s.close();
fs.rmSync(copyDir, { recursive: true, force: true });

const failed = all.filter((r) => !r.ok);
console.log(`\n${all.length - failed.length}/${all.length} checks passed${crashed ? ", and a suite crashed" : ""}`);
for (const f of failed) console.log(`  FAIL [${f.suite}] ${f.name}${f.detail ? "  — " + f.detail : ""}`);
process.exit(failed.length || crashed ? 1 : 0);

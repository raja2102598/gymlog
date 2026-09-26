// Runs the end-to-end tests against the built site: `npm run build`, then `npm run test:e2e`. Suites run in
// parallel, each in its own worker with its own pair of servers, sharing one Chromium. Pass suite names to
// run only those (`npm run test:e2e -- today dashboard`), or `--changed` to pick suites from what changed.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";
import { serve } from "../../scripts/serve.mjs";
import { checker } from "./harness.mjs";

const E2E_DIR = path.resolve("tests/e2e");
const OUT = path.resolve("out");
const TIMINGS_CACHE = path.resolve("node_modules/.cache/e2e-timings.json");

// ---------- command line ----------

const argv = process.argv.slice(2);
let workersArg = null, changed = false, changedRef = null;
const names = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--workers") workersArg = Number(argv[++i]);
  else if (a.startsWith("--workers=")) workersArg = Number(a.slice("--workers=".length));
  else if (a === "--changed") {
    changed = true;
    if (argv[i + 1] && !argv[i + 1].startsWith("-")) changedRef = argv[++i]; // an explicit ref, if given
  } else if (!a.startsWith("-")) names.push(a);
}

// ---------- discover suites from tests/e2e/*.e2e.mjs ----------

const suiteFiles = fs.readdirSync(E2E_DIR).filter((f) => f.endsWith(".e2e.mjs")).sort();
const suites = await Promise.all(
  suiteFiles.map(async (file) => {
    const name = file.replace(/\.e2e\.mjs$/, "");
    const rel = `tests/e2e/${file}`;
    const size = fs.statSync(path.join(E2E_DIR, file)).size;
    try {
      const mod = await import(`./${file}`);
      return { name, file: rel, size, covers: mod.covers ?? [], run: mod.default };
    } catch (e) {
      // A suite that won't even import still gets a slot, and is reported as a crash when it's its turn to run,
      // instead of taking every other suite down with it.
      return { name, file: rel, size, covers: [], run: () => { throw e; } };
    }
  }),
);

// ---------- choose which suites to run ----------

// A changed file broad enough that it must run every suite: shared build/config, or under src/, public/ or
// tests/e2e/ itself (a suite's own file or something it `covers` is filtered out before this is checked).
const ALWAYS_ALL = new Set(["scripts/serve.mjs", "scripts/build-sw.mjs", "package.json", "package-lock.json"]);
const isNextConfig = (f) => /^next\.config\.(js|mjs|cjs|ts|mts|cts)$/.test(f);
const isBroad = (f) => ALWAYS_ALL.has(f) || isNextConfig(f) || ["src/", "public/", "tests/e2e/"].some((d) => f.startsWith(d));

let selected = suites;
if (changed) {
  let ref, files;
  try {
    ({ ref, files } = changedFiles(changedRef));
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }
  console.log(`--changed: comparing against ${ref}`);
  const reasons = pickChanged(files, suites);
  if (reasons.size === 0) {
    console.log("No browser suites affected");
    process.exit(0);
  }
  for (const s of suites) {
    if (!reasons.has(s.name)) continue;
    console.log(`${s.name}: ${reasons.get(s.name).map((r) => `${r.file} (${r.why})`).join(", ")}`);
  }
  selected = suites.filter((s) => reasons.has(s.name));
} else if (names.length) {
  const unknown = names.filter((n) => !suites.some((s) => s.name === n));
  if (unknown.length) {
    console.error(`No such suite${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}. Known: ${suites.map((s) => s.name).join(", ")}.`);
    process.exit(2);
  }
  selected = suites.filter((s) => names.includes(s.name));
}

if (!fs.existsSync(path.join(OUT, "sw.js"))) {
  console.error("No build in out/: run `npm run build` first.");
  process.exit(2);
}
warnIfStale();

// ---------- run them: a worker pool sharing one Chromium, longest suites first ----------

const timings = loadTimings();
// Unknown suites (no cached time yet) sort before known ones, biggest file first: a safe guess that also
// matches "file size" exactly when nothing at all is cached yet.
const weight = (s) => timings[s.name] ?? 1e9 + s.size;
const queue = [...selected].sort((a, b) => weight(b) - weight(a));

const workerCount = queue.length ? Math.max(1, Math.min(resolveWorkers(), queue.length)) : 0;
const browser = workerCount ? await chromium.launch({ proxy: undefined }) : null; // no proxy for local servers

const allResults = [];
let crashedCount = 0;
const newTimings = {};
let nextIndex = 0;

async function runSuite(suite, base, copy) {
  const lines = [];
  const { check, results } = checker(suite.name, (line) => lines.push(line));
  const t0 = Date.now();
  let crashed = false;
  try {
    await suite.run({ browser, base, copy, check });
  } catch (e) {
    crashed = true;
    crashedCount++;
    lines.push(`CRASHED in ${suite.name}: ${e?.stack ?? e}`);
  }
  const seconds = (Date.now() - t0) / 1000;
  if (!crashed) newTimings[suite.name] = Math.round(seconds * 10) / 10;
  allResults.push(...results);
  // One block per suite, printed whole once it finishes, so parallel suites' output can't interleave.
  console.log(`\n# ${suite.name} (${seconds.toFixed(1)} s)\n${lines.join("\n")}`);
}

async function worker() {
  const servers = await startServers();
  try {
    for (;;) {
      const suite = queue[nextIndex++]; // synchronous: safe to share across concurrent workers
      if (!suite) return;
      await runSuite(suite, servers.base, servers.copy);
    }
  } finally {
    await servers.close();
  }
}

const totalStart = Date.now();
if (workerCount) await Promise.all(Array.from({ length: workerCount }, worker));
if (browser) await browser.close();
saveTimings(newTimings);

const totalSeconds = (Date.now() - totalStart) / 1000;
const failed = allResults.filter((r) => !r.ok);
const crashNote = crashedCount ? `, and ${crashedCount === 1 ? "a suite" : `${crashedCount} suites`} crashed` : "";
console.log(`\n${allResults.length - failed.length}/${allResults.length} checks passed${crashNote} in ${totalSeconds.toFixed(1)} s (${workerCount || 0} worker${workerCount === 1 ? "" : "s"})`);
for (const f of failed) console.log(`  FAIL [${f.suite}] ${f.name}${f.detail ? "  — " + f.detail : ""}`);
process.exit(failed.length || crashedCount ? 1 : 0);

// ---------- helpers ----------

/** The worker count: --workers, else E2E_WORKERS, else a default from the machine's own core count. */
function resolveWorkers() {
  const n = workersArg || Number(process.env.E2E_WORKERS) || defaultWorkers();
  return Math.max(1, Math.floor(n) || 1);
}

// One worker per CPU: on a 4-core machine, measured against this suite, that finished consistently faster
// than holding a core back for the OS (about 29 s vs. 43 s for 3 workers, 91 s for 1 — see the RAJ-61 PR for
// the full table). Each worker is mostly idle Node waiting on the browser, so the OS's own overhead doesn't
// need a reserved core the way a CPU-bound worker pool would. availableParallelism() falls back to 1 on a
// machine that can't report it, hence the outer max(1, ...).
function defaultWorkers() {
  return Math.max(1, os.availableParallelism());
}

/** Each worker's own pair of servers: the site (out/), and a throwaway copy that offline.e2e.mjs "deploys" a
 *  new build to. Ephemeral ports (serve(dir, 0)), read back from the server, so parallel workers and other
 *  worktrees never collide. */
async function startServers() {
  const copyDir = fs.mkdtempSync(path.join(os.tmpdir(), "gymlog-e2e-"));
  fs.cpSync(OUT, copyDir, { recursive: true });
  const [site, copy] = await Promise.all([serve(OUT, 0), serve(copyDir, 0)]);
  return {
    base: `http://127.0.0.1:${site.address().port}/`,
    copy: { url: `http://127.0.0.1:${copy.address().port}/`, dir: copyDir },
    close: async () => {
      await Promise.all([site, copy].map((s) => new Promise((resolve) => s.close(resolve))));
      fs.rmSync(copyDir, { recursive: true, force: true });
    },
  };
}

function loadTimings() {
  try {
    return JSON.parse(fs.readFileSync(TIMINGS_CACHE, "utf8"));
  } catch {
    return {};
  }
}

/** Merges this run's timings into the cache, keeping suites that weren't run this time. */
function saveTimings(updates) {
  const merged = { ...loadTimings(), ...updates };
  fs.mkdirSync(path.dirname(TIMINGS_CACHE), { recursive: true });
  fs.writeFileSync(TIMINGS_CACHE, JSON.stringify(merged, null, 1) + "\n");
}

function newestMtime(dir) {
  let latest = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    latest = Math.max(latest, entry.isDirectory() ? newestMtime(p) : fs.statSync(p).mtimeMs);
  }
  return latest;
}

/** A one-line nudge when out/ predates the source it was built from — easy to miss once builds are cached
 *  between runs. */
function warnIfStale() {
  const swTime = fs.statSync(path.join(OUT, "sw.js")).mtimeMs;
  const newest = Math.max(newestMtime("src"), fs.existsSync("public") ? newestMtime("public") : 0);
  if (newest > swTime) console.warn("out/ is older than src/ or public/: run `npm run build` to test the current code.");
}

function git(args) {
  const r = spawnSync("git", args, { encoding: "utf8" });
  return { ok: r.status === 0, lines: (r.stdout ?? "").split("\n").map((s) => s.trim()).filter(Boolean) };
}

/** origin/main, falling back to plain main (e.g. no remote configured), or whatever ref was asked for. */
function resolveRef(explicit) {
  if (explicit) return explicit;
  for (const candidate of ["origin/main", "main"]) if (git(["rev-parse", "--verify", "--quiet", candidate]).ok) return candidate;
  throw new Error("--changed: can't find origin/main or main to diff against. Pass a ref: --changed <ref>.");
}

/** Every file that differs from ref: committed on this branch since it diverged, plus whatever's uncommitted
 *  or untracked in the working tree right now. */
function changedFiles(explicitRef) {
  const ref = resolveRef(explicitRef);
  const committed = git(["diff", "--name-only", `${ref}...HEAD`]);
  if (!committed.ok) throw new Error(`--changed: \`git diff --name-only ${ref}...HEAD\` failed. Is ${ref} fetched?`);
  const uncommitted = git(["diff", "--name-only", "HEAD"]);
  const untracked = git(["ls-files", "--others", "--exclude-standard"]);
  return { ref, files: [...new Set([...committed.lines, ...uncommitted.lines, ...untracked.lines])] };
}

function globToRegExp(glob) {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped.replace(/\*\*/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\u0000/g, ".*")}$`);
}

/** Which suites a set of changed files selects, and why: a suite's own file, a file in its `covers`, or a
 *  changed file broad enough (src/, public/, tests/e2e/, or shared build/config files) that every suite runs.
 *  A file in `covers` runs only the suites that list it, so it belongs there only when every suite that renders
 *  it lists it too: the Health tab's files (health and navigation open it), or a metric's or a
 *  lift's page and their charts. The app shell renders Today, the sign-in and plan-picker screens and the bars in
 *  every suite, on show or not, so their files and whatever they import stay unlisted and run every suite, as do
 *  Settings' and Progress's, which most suites open. */
function pickChanged(files, allSuites) {
  const reasons = new Map();
  const add = (name, file, why) => {
    if (!reasons.has(name)) reasons.set(name, []);
    reasons.get(name).push({ file, why });
  };
  for (const file of files) {
    const own = allSuites.find((s) => s.file === file);
    if (own) {
      add(own.name, file, "its own suite file");
      continue;
    }
    const covering = allSuites.filter((s) => s.covers.some((pat) => (pat.includes("*") ? globToRegExp(pat).test(file) : pat === file)));
    if (covering.length) {
      for (const s of covering) add(s.name, file, "covers it");
      continue;
    }
    if (isBroad(file)) for (const s of allSuites) add(s.name, file, "shared code, runs every suite");
    // Anything else (docs/, android/, .github/, a root *.md, …) selects nothing for this file.
  }
  return reasons;
}

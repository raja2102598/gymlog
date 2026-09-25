// Shared set-up for the end-to-end tests. They drive the built site (out/) in Chromium with the clock
// pinned to Wednesday 23 September 2026. Supabase is mocked inside the browser: every request to the
// project is answered from an in-memory `db`, so no real data is read or written. Anything else
// off-site is refused and recorded (the app shouldn't need it).
import { createHash } from "node:crypto";
import fs from "node:fs";

// The Supabase project the built site talks to: NEXT_PUBLIC_SUPABASE_URL, read from the environment or from
// .env.local / .env as Next.js reads it for the build (src/lib/config.ts). The tests intercept that address, so it
// has to be the one out/ was built with; any project will do, since nothing real is called.
function fromEnv(name) {
  if (process.env[name]) return process.env[name];
  for (const file of [".env.local", ".env"]) {
    let text;
    try { text = fs.readFileSync(file, "utf8"); } catch { continue; }
    const m = text.match(new RegExp(`^\\s*${name}\\s*=\\s*(.*?)\\s*$`, "m"));
    if (m) return m[1].replace(/^(["'])(.*)\1$/, "$2");
  }
  return "";
}
export const HOST = fromEnv("NEXT_PUBLIC_SUPABASE_URL").trim().replace(/\/+$/, "");
if (!HOST) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL, in the environment or in .env.local, to the address the site was built with (see .env.example).");
export const AUTH_KEY = `sb-${new URL(HOST).hostname.split(".")[0]}-auth-token`;
export const NOW = new Date("2026-09-23T12:00:00");

/** Day n counted from Wednesday 26 August 2026 (n = 28 is today). */
export const K = (n) => new Date(Date.UTC(2026, 7, 26 + n)).toISOString().slice(0, 10);

/** The default plan (src/data/plan.json), as `db.plan` for an account that has saved its plan. With nothing logged and
 *  no plan saved, an account is new and chooses a plan before Today (firstrun.e2e.mjs). */
export const savedPlan = () => JSON.parse(fs.readFileSync(new URL("../../src/data/plan.json", import.meta.url), "utf8"));

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
/** A signed-in Supabase session for a made-up user, signed in with an emailed link ("otp") or a password. */
export function session(uid, created = "2026-09-01T00:00:00Z", email = "test@example.com", method = "otp") {
  const amr = [{ method, timestamp: 1790000000 }];
  return {
    access_token: `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: uid, role: "authenticated", aud: "authenticated", exp: 4102444800, email, amr })}.sig`,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: 4102444800,
    refresh_token: "fake-refresh",
    user: { id: uid, aud: "authenticated", role: "authenticated", email, app_metadata: {}, user_metadata: {}, created_at: created },
  };
}

/** The updated_at of rows a test puts in `db` itself: older than any write. */
const FIRST_SAVE = "2026-09-23T04:12:00+00:00";

/**
 * The `logs`, `plans` and `health_days` tables, answered from `db` ({ logs, plan, health, healthAt, failWrites, writes,
 * unexpected }; a write to `health_days` that asks to ignore duplicates, as a restore does, leaves the days `db.health`
 * has), and Supabase Auth: sign-in links (recorded in `db.otp`, refused with `db.otpError`), passwords
 * (`db.passwords`: { email: password }), password changes (the new one in `db.passwordSet`), the account's
 * metadata (`db.metadata`), and Continue with Google (switched on with `db.google`; Google's page is skipped: the
 * authorize request goes straight back with a code, or with an error when `db.oauthError`, recorded in `db.oauth`).
 *
 * Rows of `logs` and `plans` carry an updated_at (`db.logsAt[day]`, `db.planAt`) that every write moves on, as the
 * tables' triggers do. Reads and updates honour eq filters on day and updated_at, a write returns the columns it selects
 * of its rows when asked (Prefer: return=representation), and adding rows fails as Postgres does when one of them is
 * there already (409, code 23505), adding none.
 * Several pages can share one `db`, like phones on one account.
 */
export function mockSupabase(db) {
  db.writes ??= { logs: 0, plans: 0, health: 0 };
  db.unexpected ??= [];
  db.logsAt ??= {};
  db.clock ??= 0;
  /** A new updated_at, later than every one before it. */
  const stamp = () => new Date(Date.UTC(2026, 8, 23, 6, 0, 0, ++db.clock)).toISOString().replace("Z", "+00:00");
  return async (route) => {
    const req = route.request(), url = new URL(req.url()), m = req.method();
    const json = (status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    /** The value of an eq filter in the address (day=eq.…), or null. */
    const eq = (col) => url.searchParams.get(col)?.replace(/^eq\./, "") ?? null;
    /** What a write sends back: the columns it selects (select=…) of the rows it wrote, when it asks for them, or nothing. */
    const written = (rows) => {
      if (!/return=representation/.test(req.headers()["prefer"] ?? "")) return route.fulfill({ status: m === "POST" ? 201 : 204, body: "" });
      const cols = (url.searchParams.get("select") ?? "*").split(",");
      return json(m === "POST" ? 201 : 200, rows.map((r) => (cols.includes("*") ? r : Object.fromEntries(cols.map((c) => [c, r[c]])))));
    };
    const duplicate = () => json(409, { code: "23505", details: null, hint: null, message: "duplicate key value violates unique constraint" });
    if (url.pathname === "/rest/v1/logs") {
      const at = (day) => (db.logsAt[day] ??= FIRST_SAVE);
      const picked = () => Object.keys(db.logs).sort().filter((d) => (eq("day") == null || d === eq("day")) && (eq("updated_at") == null || at(d) === eq("updated_at")));
      if (m === "GET") return json(200, picked().map((day) => ({ day, data: db.logs[day], updated_at: at(day) })));
      if (m === "POST" || m === "PATCH") {
        if (db.failWrites) return route.fulfill({ status: 503, contentType: "application/json", body: '{"message":"unavailable"}' });
        const body = JSON.parse(req.postData()), rows = m === "POST" ? [].concat(body) : picked().map((day) => ({ day, data: body.data }));
        if (m === "POST" && rows.some((r) => r.day in db.logs)) return duplicate();
        for (const r of rows) {
          db.logs[r.day] = r.data;
          db.logsAt[r.day] = stamp();
        }
        if (rows.length) db.writes.logs++;
        return written(rows.map((r) => ({ day: r.day, data: r.data, updated_at: db.logsAt[r.day] })));
      }
    }
    if (url.pathname === "/rest/v1/health_days") {
      db.health ??= {};
      if (m === "GET")
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(Object.keys(db.health).sort().map((day) => ({ day, data: db.health[day], updated_at: db.healthAt || "2026-09-23T04:12:00+00:00" }))) });
      if (m === "POST") {
        const keep = /resolution=ignore-duplicates/.test(req.headers()["prefer"] ?? "");
        for (const r of [].concat(JSON.parse(req.postData()))) if (!(keep && r.day in db.health)) db.health[r.day] = r.data;
        db.writes.health++;
        return route.fulfill({ status: 201, body: "" });
      }
    }
    if (url.pathname === "/rest/v1/plans") {
      const at = () => (db.planAt ??= FIRST_SAVE);
      if (m === "GET") return json(200, db.plan ? [{ plan: db.plan, updated_at: at() }] : []);
      if (m === "POST" || m === "PATCH") {
        if (m === "POST" && db.plan) return duplicate();
        if (m === "PATCH" && (!db.plan || (eq("updated_at") != null && at() !== eq("updated_at")))) return written([]);
        db.plan = [].concat(JSON.parse(req.postData()))[0].plan;
        db.planAt = stamp();
        db.writes.plans++;
        return written([{ plan: db.plan, updated_at: db.planAt }]);
      }
    }
    if (url.pathname === "/auth/v1/otp" && m === "POST") {
      (db.otp ??= []).push({ body: JSON.parse(req.postData()), redirect: url.searchParams.get("redirect_to") });
      if (db.otpError) return route.fulfill({ status: 429, contentType: "application/json", body: JSON.stringify(db.otpError) });
      return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    }
    if (url.pathname === "/auth/v1/token" && m === "POST" && url.searchParams.get("grant_type") === "password") {
      const { email, password } = JSON.parse(req.postData());
      if (db.passwords?.[email] !== password)
        return route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ code: 400, error_code: "invalid_credentials", msg: "Invalid login credentials" }) });
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(session(db.uid || "00000000-0000-4000-8000-0000000000aa", "2026-09-01T00:00:00Z", email, "password")) });
    }
    if (url.pathname === "/auth/v1/user" && m === "PUT") {
      const body = JSON.parse(req.postData());
      if (body.password) db.passwordSet = body.password;
      if (body.data) db.metadata = { ...db.metadata, ...body.data };
      const who = JSON.parse(Buffer.from(req.headers()["authorization"].split(".")[1], "base64url").toString());
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id: who.sub, aud: "authenticated", role: "authenticated", email: who.email, app_metadata: {}, user_metadata: db.metadata ?? {}, created_at: "2026-09-01T00:00:00Z" }) });
    }
    if (url.pathname === "/auth/v1/logout" && m === "POST") return route.fulfill({ status: 204, body: "" });
    if (url.pathname === "/auth/v1/settings" && m === "GET")
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ external: { email: true, google: !!db.google }, disable_signup: false }) });
    if (url.pathname === "/auth/v1/authorize" && m === "GET") {
      const q = url.searchParams, back = new URL(q.get("redirect_to"));
      db.oauth = { provider: q.get("provider"), redirectTo: q.get("redirect_to"), challenge: q.get("code_challenge"), method: q.get("code_challenge_method") };
      if (db.oauthError) {
        back.searchParams.set("error", "access_denied");
        back.searchParams.set("error_description", "The user denied the request");
      } else back.searchParams.set("code", "google-code");
      return route.fulfill({ status: 302, headers: { location: back.href } });
    }
    if (url.pathname === "/auth/v1/token" && m === "POST" && url.searchParams.get("grant_type") === "pkce") {
      const { auth_code, code_verifier } = JSON.parse(req.postData());
      // PKCE: the verifier this page kept must be the one whose hash went to the authorize request.
      db.pkceOk = auth_code === "google-code" && createHash("sha256").update(code_verifier).digest("base64url") === db.oauth?.challenge;
      if (!db.pkceOk) return route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ code: 400, error_code: "bad_code_verifier", msg: "code challenge does not match previously saved code verifier" }) });
      const s = session(db.uid || "00000000-0000-4000-8000-0000000000bb", "2026-09-01T00:00:00Z", "g@example.com", "oauth");
      s.user.app_metadata = { provider: "google", providers: ["email", "google"] };
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(s) });
    }
    db.unexpected.push(`${m} ${url.pathname}`);
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  };
}

/**
 * A phone-sized browser context, signed in as `auth` (a session, or null for signed out), with Supabase
 * answered from `db`. Returns the context and a page that records errors in `page.errors`. The clock reads NOW
 * throughout, or, with `clock: "running"`, starts at NOW and runs, so a test can move it on with
 * page.clock.fastForward.
 */
export async function open(browser, base, { auth, db = { logs: {}, plan: null }, width = 390, height = 844, scheme = "light", sw = "block", mobile = true, url = base, clock = "fixed" } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile, serviceWorkers: sw, colorScheme: scheme });
  if (clock === "running") await ctx.clock.install({ time: NOW });
  else await ctx.clock.setFixedTime(NOW);
  if (auth) {
    // Only once, so a reload keeps whatever the app did with it.
    await ctx.addInitScript(([k, v]) => {
      if (!localStorage.getItem("__seeded")) {
        localStorage.setItem(k, v);
        localStorage.setItem("__seeded", "1");
      }
    }, [AUTH_KEY, JSON.stringify(auth)]);
  }
  db.external ??= [];
  await ctx.route(HOST + "/**", mockSupabase(db));
  await ctx.route((u) => !u.href.startsWith(base) && !u.href.startsWith(HOST), (route) => {
    db.external.push(route.request().url());
    return route.abort();
  });
  const page = await ctx.newPage();
  page.errors = [];
  // The harness blocks service workers in most tests, and Chromium says so in the console.
  page.on("console", (msg) => {
    if ((msg.type() === "error" || msg.type() === "warning") && !/blocked by Playwright/.test(msg.text())) page.errors.push(`${msg.type()}: ${msg.text()}`);
  });
  page.on("pageerror", (e) => page.errors.push("pageerror: " + e.message));
  page.on("dialog", (d) => d.accept());
  if (url) await page.goto(url);
  return { ctx, page, db };
}

/** In the page: waits for timed animations to end. (The top bar's edge follows the scroll, and never ends.) */
export const settled = () => Promise.all(document.getAnimations().filter((a) => a.timeline === document.timeline).map((a) => a.finished.catch(() => {})));

/** Waits for the app to show Home and finish its first sync. */
export async function ready(page) {
  await page.waitForSelector("#homeView", { timeout: 15000 });
  await until(async () => (await page.locator("#status").textContent()) === "Synced");
  // Let the view's fade-in finish: mid-transform, a 44px button can measure 43.99997px.
  await page.evaluate(settled);
}

const VIEWS = { home: "#homeView", train: "#trainView", health: "#healthView", progress: "#dashView", settings: "#settingsView" };
/** Taps a tab along the bottom (home, train, progress or health) and waits for its screen. Settings, which isn't a
 *  tab, opens from Home's avatar: from anywhere else, Home first. */
export async function openTab(page, name) {
  if (name === "settings") {
    if (!(await page.locator("#settingsBtn").count())) await openTab(page, "home");
    await page.click("#settingsBtn");
  } else await page.click(`#tab${name[0].toUpperCase()}${name.slice(1)}`);
  await page.waitForSelector(VIEWS[name]);
}
/** Opens a Settings row that unfolds in place (its group's id, e.g. "setData"), unless it's open already. */
export async function openSetting(page, id) {
  const b = page.locator(`#${id}H`);
  if ((await b.getAttribute("aria-expanded")) !== "true") await b.click();
}
/** Leaves the plan editor with Done, back to the screen it opened from. */
export async function planDone(page) {
  await page.click("#planDone");
  await page.waitForSelector("#planView", { state: "hidden" });
}

export async function until(fn, ms = 6000) {
  const t = Date.now();
  while (Date.now() - t < ms) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

/** An element's text with runs of white space collapsed. */
export const flat = async (loc) => ((await loc.textContent()) || "").replace(/\s+/g, " ").trim();

/** One lift on Today, by the name it shows. */
export const liftEl = (page, name) => page.locator("#session .ex li", { has: page.locator(".nm", { hasText: name }) }).first();

/** Saves a screenshot when E2E_SHOTS names a folder. */
export async function shot(target, name, opts = {}) {
  if (process.env.E2E_SHOTS) await target.screenshot({ path: `${process.env.E2E_SHOTS}/${name}.png`, ...opts }).catch(() => {});
}

/** Collects pass/fail lines for one suite. `log` gets each formatted line (console.log by default); the
 *  runner passes one that writes to the suite's own buffer, so parallel suites' output doesn't interleave. */
export function checker(suite, log = console.log) {
  const results = [];
  const check = (name, ok, detail = "") => {
    results.push({ suite, name, ok: !!ok, detail });
    log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? "  — " + detail : ""}`);
  };
  return { check, results };
}

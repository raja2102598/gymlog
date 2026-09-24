// Shared set-up for the end-to-end tests. They drive the built site (out/) in Chromium with the clock
// pinned to Wednesday 23 September 2026. Supabase is mocked inside the browser: every request to the
// project is answered from an in-memory `db`, so no real data is read or written. Anything else
// off-site is refused and recorded (the app shouldn't need it).
export const HOST = "https://dtudesmwddtlcekhqees.supabase.co";
export const AUTH_KEY = "sb-dtudesmwddtlcekhqees-auth-token";
export const NOW = new Date("2026-09-23T12:00:00");

/** Day n counted from Wednesday 26 August 2026 (n = 28 is today). */
export const K = (n) => new Date(Date.UTC(2026, 7, 26 + n)).toISOString().slice(0, 10);

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

/**
 * The `logs`, `plans` and `health_days` tables, answered from `db` ({ logs, plan, health, healthAt, failWrites, writes,
 * unexpected }), and Supabase Auth: sign-in links (recorded in `db.otp`, refused with `db.otpError`), passwords
 * (`db.passwords`: { email: password }), password changes (the new one in `db.passwordSet`) and the account's
 * metadata (`db.metadata`).
 */
export function mockSupabase(db) {
  db.writes ??= { logs: 0, plans: 0 };
  db.unexpected ??= [];
  return async (route) => {
    const req = route.request(), url = new URL(req.url()), m = req.method();
    if (url.pathname === "/rest/v1/logs") {
      if (m === "GET") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(Object.keys(db.logs).sort().map((day) => ({ day, data: db.logs[day] }))) });
      if (m === "POST") {
        if (db.failWrites) return route.fulfill({ status: 503, contentType: "application/json", body: '{"message":"unavailable"}' });
        for (const r of [].concat(JSON.parse(req.postData()))) db.logs[r.day] = r.data;
        db.writes.logs++;
        return route.fulfill({ status: 201, body: "" });
      }
    }
    if (url.pathname === "/rest/v1/health_days") {
      db.health ??= {};
      if (m === "GET")
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(Object.keys(db.health).sort().map((day) => ({ day, data: db.health[day], updated_at: db.healthAt || "2026-09-23T04:12:00+00:00" }))) });
      if (m === "POST") {
        for (const r of [].concat(JSON.parse(req.postData()))) db.health[r.day] = r.data;
        db.writes.health = (db.writes.health || 0) + 1;
        return route.fulfill({ status: 201, body: "" });
      }
    }
    if (url.pathname === "/rest/v1/plans") {
      if (m === "GET") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(db.plan ? [{ plan: db.plan }] : []) });
      if (m === "POST") {
        db.plan = [].concat(JSON.parse(req.postData()))[0].plan;
        db.writes.plans++;
        return route.fulfill({ status: 201, body: "" });
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
    db.unexpected.push(`${m} ${url.pathname}`);
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  };
}

/**
 * A phone-sized browser context, signed in as `auth` (a session, or null for signed out), with Supabase
 * answered from `db`. Returns the context and a page that records errors in `page.errors`.
 */
export async function open(browser, base, { auth, db = { logs: {}, plan: null }, width = 390, height = 844, scheme = "light", sw = "block", mobile = true, url = base } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile, serviceWorkers: sw, colorScheme: scheme });
  await ctx.clock.setFixedTime(NOW);
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

/** Waits for the app to show Today and finish its first sync. */
export async function ready(page) {
  await page.waitForSelector("#appView:not([hidden])", { timeout: 15000 });
  await until(async () => (await page.locator("#status").textContent()) === "Synced");
  // Let the view's fade-in finish: mid-transform, a 44px button can measure 43.99997px.
  await page.evaluate(settled);
}

const VIEWS = { today: "#appView", health: "#healthView", progress: "#dashView", settings: "#settingsView" };
/** Taps a tab along the bottom (today, health, progress or settings) and waits for its screen. */
export async function openTab(page, name) {
  await page.click(`#tab${name[0].toUpperCase()}${name.slice(1)}`);
  await page.waitForSelector(`${VIEWS[name]}:not([hidden])`);
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

/** Collects pass/fail lines for one suite. */
export function checker(suite) {
  const results = [];
  const check = (name, ok, detail = "") => {
    results.push({ suite, name, ok: !!ok, detail });
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? "  — " + detail : ""}`);
  };
  return { check, results };
}

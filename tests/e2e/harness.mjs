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
/** A signed-in Supabase session for a made-up user. */
export function session(uid, created = "2026-09-01T00:00:00Z", email = "test@example.com") {
  return {
    access_token: `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: uid, role: "authenticated", aud: "authenticated", exp: 4102444800, email })}.sig`,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: 4102444800,
    refresh_token: "fake-refresh",
    user: { id: uid, aud: "authenticated", role: "authenticated", email, app_metadata: {}, user_metadata: {}, created_at: created },
  };
}

/** The `logs` and `plans` tables, answered from `db` ({ logs, plan, failWrites, writes, unexpected }). */
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
    if (url.pathname === "/rest/v1/plans") {
      if (m === "GET") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(db.plan ? [{ plan: db.plan }] : []) });
      if (m === "POST") {
        db.plan = [].concat(JSON.parse(req.postData()))[0].plan;
        db.writes.plans++;
        return route.fulfill({ status: 201, body: "" });
      }
    }
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

/** Waits for the app to show Today and finish its first sync. */
export async function ready(page) {
  await page.waitForSelector("#appView:not([hidden])", { timeout: 15000 });
  await until(async () => (await page.locator("#status").textContent()) === "Synced");
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

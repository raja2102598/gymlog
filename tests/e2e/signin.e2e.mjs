// Signing in: an emailed link that carries its own flow id, a wait before another, Supabase's hourly email
// limit, a password instead, setting or changing a password in Settings, and Continue with Google. The email form is
// folded behind "Continue with email" (#emailBtn) until it's tapped. And the sign-in page itself: its fields' names,
// its words, and its colours in dark mode.
import { flat, open, openSetting, openTab, ready, savedPlan, session, until } from "./harness.mjs";

export const covers = ["public/app-login.html"];

export default async function signinSuite({ browser, base, check }) {
  // A link, then the wait before another
  {
    const db = { logs: {}, plan: null };
    const { ctx, page } = await open(browser, base, { auth: null, db });
    await page.waitForSelector("#loginView:not([hidden])");
    await page.click("#emailBtn");
    await page.fill("#email", "t@example.com");
    await page.click("#loginBtn");
    await until(() => db.otp?.length === 1);
    const sent = db.otp[0];
    check(
      "a link comes back to this page with its own flow id, for a PKCE sign-in",
      sent.redirect.startsWith(base + "?") && /[?&]sb_flow_id=[^&]+/.test(sent.redirect) && sent.body.email === "t@example.com" && !!sent.body.code_challenge,
      JSON.stringify(sent),
    );
    await until(async () => /Check t@example.com/.test(await flat(page.locator("#loginMsg"))));
    check(
      "says where the link went, and to use the newest email",
      (await flat(page.locator("#loginMsg"))) === "Check t@example.com for a sign-in link and open it on this device. If you ask for another, use the newest email.",
    );
    check("no Google button while Supabase has Google switched off", (await page.locator("#googleBtn").count()) === 0);
    const btn = await page.$eval("#loginBtn", (b) => ({ disabled: b.disabled, text: b.textContent.replace(/\s+/g, " ") }));
    check("no second link for a minute: a new one would replace the first", btn.disabled && /^Send another link in (59|60) s$/.test(btn.text), JSON.stringify(btn));
    check("only one link was asked for", db.otp.length === 1);
    check("no console errors", page.errors.length === 0, page.errors.join(" | "));
    await ctx.close();
  }

  // Continue with Google on the website: off to Google (skipped here) and back with a code, exchanged with this
  // page's PKCE verifier for a session
  {
    // An account that has saved its plan, so sign-in lands on Today (a new one chooses a plan first: firstrun.e2e.mjs).
    const db = { logs: {}, plan: savedPlan(), google: true };
    const { ctx, page } = await open(browser, base, { auth: null, db });
    await page.waitForSelector("#googleBtn");
    // Google's button comes first in the sheet, above Continue with email.
    const googleFirst = await page.evaluate(() => !!(document.getElementById("googleBtn").compareDocumentPosition(document.getElementById("emailBtn")) & Node.DOCUMENT_POSITION_FOLLOWING));
    check("Continue with Google, above the email ways in", (await flat(page.locator("#googleBtn"))) === "Continue with Google" && googleFirst && (await page.locator("#emailBtn").isVisible()));
    await page.click("#googleBtn");
    await ready(page);
    check(
      "Google's sign-in comes back to this page with its own flow id",
      db.oauth?.provider === "google" && db.oauth.redirectTo.startsWith(base + "?sb_flow_id=") && db.oauth.method === "s256",
      JSON.stringify(db.oauth),
    );
    check("the code is exchanged with the verifier this page kept (PKCE)", db.pkceOk === true);
    check("signed in, and the code is gone from the address", (await page.locator("#homeView").isVisible()) && !/code=|sb_flow_id/.test(page.url()), page.url());
    await openTab(page, "settings");
    await openSetting(page, "setAccount");
    check("Settings says the Google account is linked", /^g@example\.com · Google account linked$/.test(await flat(page.locator("#setAccount .pref-row").first().locator(".sub"))));
    check("no console errors", page.errors.length === 0, page.errors.join(" | "));
    await ctx.close();
  }
  {
    const db = { logs: {}, plan: null, google: true, oauthError: true };
    const { ctx, page } = await open(browser, base, { auth: null, db });
    await page.waitForSelector("#googleBtn");
    await page.click("#googleBtn");
    await page.waitForURL((u) => !u.href.includes("error="), { timeout: 10000 }).catch(() => {});
    await until(async () => /cancelled/.test(await flat(page.locator("#loginMsg"))));
    check("Google cancelled: says so, back on the sign-in screen", (await page.locator("#loginView").isVisible()) && (await flat(page.locator("#loginMsg"))) === "Sign-in was cancelled. Try again, or use another way below.");
    check("and the error is taken out of the address", !/error|sb_flow_id/.test(page.url()), page.url());
    await ctx.close();
  }

  // Supabase's hourly email limit
  {
    const db = { logs: {}, plan: null, otpError: { code: 429, error_code: "over_email_send_rate_limit", msg: "email rate limit exceeded" } };
    const { ctx, page } = await open(browser, base, { auth: null, db });
    await page.waitForSelector("#loginView:not([hidden])");
    await page.click("#emailBtn");
    await page.fill("#email", "t@example.com");
    await page.click("#loginBtn");
    await until(async () => /Supabase/.test(await flat(page.locator("#loginMsg"))));
    check(
      "the hourly email limit is explained, with the password as the way round it",
      (await flat(page.locator("#loginMsg"))) === "Supabase only sends a few sign-in emails an hour, and they’re used up. Try again in an hour, or sign in with a password.",
    );
    check("after a refused link the button isn't held back", !(await page.$eval("#loginBtn", (b) => b.disabled)));
    await ctx.close();
  }

  // A password instead
  {
    const db = { logs: {}, plan: savedPlan(), passwords: { "t@example.com": "right-password-1" } };
    const { ctx, page } = await open(browser, base, { auth: null, db });
    await page.waitForSelector("#loginView:not([hidden])");
    await page.click("#emailBtn");
    check("no password box until you ask for one", (await page.locator("#password").count()) === 0);
    await page.click("#loginMode");
    check(
      "password mode: a password box, a Sign in button, and where the password comes from",
      (await page.locator("#password").isVisible()) &&
        (await flat(page.locator("#loginBtn"))) === "Sign in" &&
        // The form's own line above the email box.
        /password you set in Settings/.test(await flat(page.locator("#loginHow"))) &&
        (await page.$eval("#password", (e) => e.autocomplete)) === "current-password",
    );
    await page.fill("#email", "t@example.com");
    await page.fill("#password", "wrong-password");
    await page.click("#loginBtn");
    await until(async () => /don’t match/.test(await flat(page.locator("#loginMsg"))));
    check(
      "a wrong password says so, and how to get one",
      (await flat(page.locator("#loginMsg"))) === "That email and password don’t match. No password yet? Sign in with an email link, then set one in Settings.",
    );
    await page.fill("#password", "right-password-1");
    await page.press("#password", "Enter");
    await ready(page);
    check("the right password signs you in", await page.locator("#loginView").isHidden());
    await openTab(page, "settings");
    await openSetting(page, "setAccount");
    check("signed in with the password: Settings offers Change password, not Set a password", (await flat(page.locator("#pwBtn"))) === "Change password");
    await until(() => db.metadata?.has_password === true);
    check("and marks the account as having one, for sign-ins with a link", db.metadata?.has_password === true, JSON.stringify(db.metadata));
    check("no link was sent on the way", !db.otp);
    check("only the expected endpoints", db.unexpected.length === 0 && db.external.length === 0, [...db.unexpected, ...db.external].join(", "));
    // Chrome logs the wrong password's 400 from Supabase; nothing else.
    const others = page.errors.filter((e) => !/status of 400 \(Bad Request\)/.test(e));
    check("no other console errors", page.errors.length === 1 && others.length === 0, page.errors.join(" | "));
    await ctx.close();
  }

  // Setting a password from Settings
  {
    const db = { logs: {}, plan: savedPlan() };
    const auth = session("00000000-0000-4000-8000-000000000061", "2026-08-26T05:00:00Z", "me@example.com");
    const { ctx, page } = await open(browser, base, { auth, db });
    await ready(page);
    await openTab(page, "settings");
    await openSetting(page, "setAccount");
    check("signed in with a link and no password yet: Set a password", (await flat(page.locator("#pwBtn"))) === "Set a password" && /^Not set\./.test(await flat(page.locator("#pwD"))), await flat(page.locator("#pwD")));
    await page.click("#pwBtn");
    check("the password box has the focus", await page.evaluate(() => document.activeElement?.id === "newPassword"));
    const form = await page.$eval("#pwForm", (f) => ({ user: f.elements.namedItem("username").value, auto: f.elements.namedItem("newPassword").autocomplete }));
    check("the form tells a password manager which account it's for", form.user === "me@example.com" && form.auto === "new-password", JSON.stringify(form));
    await page.fill("#newPassword", "short");
    await page.click("#pwSave");
    check("a password under 8 characters isn't sent", !db.passwordSet && (await page.locator("#pwForm").count()) === 1);
    await page.fill("#newPassword", "a-long-password");
    await page.click("#pwSave");
    await until(() => db.passwordSet === "a-long-password");
    await until(async () => (await page.locator("#pwMsg").count()) === 1);
    check(
      "saved: says how to use it, and the form closes",
      (await flat(page.locator("#pwMsg"))) === "Password saved. Sign in with your email and this password, in the Android app too." && (await page.locator("#pwForm").count()) === 0,
    );
    check("the account is marked as having one, so later sign-ins know", db.metadata?.has_password === true, JSON.stringify(db.metadata));
    check("then it offers Change password", (await flat(page.locator("#pwBtn"))) === "Change password" && /^Set\./.test(await flat(page.locator("#pwD"))), await flat(page.locator("#pwD")));
    await page.click("#pwBtn");
    await page.fill("#newPassword", "another-long-one");
    await page.click("#pwSave");
    await until(() => db.passwordSet === "another-long-one");
    await until(async () => (await flat(page.locator("#pwMsg"))) === "Password changed.");
    check("changing it says so", (await flat(page.locator("#pwMsg"))) === "Password changed.");
    check("only the expected endpoints", db.unexpected.length === 0 && db.external.length === 0, [...db.unexpected, ...db.external].join(", "));
    check("no console errors", page.errors.length === 0, page.errors.join(" | "));
    await ctx.close();
  }

  // The site's app-login page, where links asked for in the Android app land before going on to the app
  {
    const APP = "#Intent;scheme=io.github.raja2102598.gymlog;package=io.github.raja2102598.gymlog;end";
    const { ctx, page } = await open(browser, base, { auth: null, url: base + "app-login.html?sb_flow_id=f1&code=abc" });
    await page.waitForSelector("#open");
    const good = await page.evaluate(() => ({ title: document.getElementById("title").textContent, href: document.getElementById("open").getAttribute("href") }));
    check(
      "app-login: hands the code and its flow id to the app, and only that app",
      good.title === "Opening Gym Log…" && good.href === "intent://login?sb_flow_id=f1&code=abc" + APP,
      JSON.stringify(good),
    );
    await page.goto(base + "app-login.html#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired");
    await page.waitForSelector("#open");
    const bad = await page.evaluate(() => ({ title: document.getElementById("title").textContent, text: document.getElementById("text").textContent, href: document.getElementById("open").getAttribute("href") }));
    check(
      "app-login: an expired link says so and what to do, and the button just opens the app",
      bad.title === "This sign-in link didn’t work" &&
        bad.text === "Email link is invalid or has expired. Go back to Gym Log, send a new link, and open the newest email on this phone." &&
        bad.href === "intent://login" + APP,
      JSON.stringify(bad),
    );
    const box = await page.$eval("#open", (a) => a.getBoundingClientRect().height);
    check("app-login: the button is a full-size target", box >= 48, String(box));
    await ctx.close();
  }

  // ---------- Sign-in and the page's colours ----------
  {
    const { ctx, page } = await open(browser, base, { auth: null, scheme: "dark" });
    await page.waitForSelector("#loginView:not([hidden])");
    await page.click("#emailBtn");
    await page.waitForSelector("#loginForm");
    const email = await page.$eval("#email", (e) => ({ name: e.name, spell: e.getAttribute("spellcheck"), auto: e.autocomplete }));
    check("sign-in: the email box has a name, no spellcheck, email autofill", email.name === "email" && email.spell === "false" && email.auto === "email", JSON.stringify(email));
    const signin = await flat(page.locator("#loginView"));
    check("sign-in: the button says what it does, in the second person", (await flat(page.locator("#loginBtn"))) === "Send sign-in link" && !/\bwe\b/i.test(signin), signin.match(/[^.]*\bwe\b[^.]*\./i)?.[0] ?? "");
    const colours = await page.evaluate(() => ({ meta: document.querySelector('meta[name="theme-color"][media*="dark"]').content, bg: getComputedStyle(document.body).backgroundColor }));
    check("dark mode: the browser bar matches the page", colours.meta.toUpperCase() === "#0E0F11" && colours.bg === "rgb(14, 15, 17)", JSON.stringify(colours));
    check("the app's name isn't machine-translated", (await page.getAttribute("h1", "translate")) === "no");
    await ctx.close();
  }
}

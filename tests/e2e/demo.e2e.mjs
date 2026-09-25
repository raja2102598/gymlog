// The in-app demo: "Try it with sample data" from the sign-in screen, straight into a fully usable app with four
// weeks of made-up history and no Supabase project involved. Smoke checks on Today, Health and Progress, logging a
// set, editing the plan, what Settings hides or refuses, the banner, and that a reload ends it.
import { flat, liftEl, open, openTab, planDone, ready, until } from "./harness.mjs";

export default async function demo({ browser, base, check }) {
  const db = { logs: {}, plan: null };
  const { ctx, page } = await open(browser, base, { auth: null, db });
  await page.waitForSelector("#loginView:not([hidden])");

  // ---------- the sign-in screen offers it ----------
  const btn = page.locator("#demoBtn");
  check("named, and separated from the email and Google ways in", (await flat(btn)) === "Try it with sample data" && (await page.locator("#loginView .or").count()) >= 1);
  const box = await btn.boundingBox();
  check("its touch target is at least 44px tall", box.height >= 44, String(box.height));
  const words = await flat(page.locator("#loginView .login").last());
  check("says no account is needed and that a reload ends it, no em or en dash", /No account needed/.test(words) && /reloading ends it/.test(words) && !/[–—]/.test(words), words);
  await btn.click();
  await ready(page);
  check("drops straight onto Today, signed in, no plan-picker first", (await page.locator("#appView").isVisible()) && (await page.locator("#chooseView").isHidden()));
  check("today is Wed · Legs, the default plan's own day", (await page.textContent("#session h2")) === "Legs");

  // ---------- the banner ----------
  const bar = page.locator("#demoBar");
  check("the banner says it's sample data, nothing saved", (await bar.isVisible()) && (await flat(bar)).startsWith("Sample data. Nothing you do here is saved."));
  const signIn = bar.locator("#demoSignIn");
  const signInBox = await signIn.boundingBox();
  check("its Sign in button is named and full-size", (await flat(signIn)) === "Sign in" && signInBox.height >= 44);

  // ---------- Today: a real week of history, and logging a set works ----------
  check("the week strip and lift pill carry real numbers", /\d\/\d lifts/.test(await page.textContent("#liftPill")) && (await page.locator("#week .dchip").count()) === 7);
  const calf = liftEl(page, "Calf Raise");
  const calfReps = await calf.locator('.set input[data-set$=":reps"]').evaluateAll((els) => els.map((e) => e.value));
  check(
    "today's last lift is left partway through: one set logged, not done, the rest blank",
    calfReps.filter(Boolean).length === 1 && !(await calf.locator('input[type="checkbox"]').isChecked()),
    calfReps.join(","),
  );
  await calf.locator('input[data-set$=":0:reps"]').fill("12");
  await calf.locator("button[data-addset]").click();
  await calf.locator('input[data-set$=":1:reps"]').fill("11");
  await calf.locator('input[data-set$=":1:kg"]').fill("20");
  await until(async () => (await flat(page.locator("#status"))) === "Saved");
  check("it saves through the fake client: ends Saved, no sync trouble banner", (await flat(page.locator("#status"))) === "Saved" && (await page.locator("#syncBar").isHidden()));

  // ---------- editing the plan works ----------
  await openTab(page, "settings");
  await page.click("#planBtn");
  await page.waitForSelector("#planView:not([hidden])");
  await page.fill("#pe_goal", "11500");
  await until(async () => (await flat(page.locator("#planMsg"))) === "Saved");
  check("the plan editor saves too", (await flat(page.locator("#planMsg"))) === "Saved");
  await planDone(page);
  await openTab(page, "settings");
  check("the edit stuck: Settings' own goal field shows it", (await page.inputValue("#goalSteps")) === "11500");

  // ---------- Health: a real day of Health Connect-shaped data ----------
  await openTab(page, "health");
  check("not the empty state: three weeks of Health Connect data were seeded", (await page.locator("#healthEmpty").count()) === 0 && (await page.locator("#activity").isVisible()));
  check("six tiles, none of them all placeholders", (await page.locator(".tiles .tile").count()) === 6 && (await page.locator(".tiles .tile-v.none").count()) < 6);
  await openTab(page, "today");
  check("Today's own health card and Health Connect note show too", (await page.locator("#healthToday").count()) === 1 && (await page.locator("#hcNote").count()) === 1);

  // ---------- Progress: four weeks of plan-driven history to show ----------
  await openTab(page, "progress");
  check("weight, plan, steps, strength and knee cards all have something to show", (await page.locator("#dashWeight, #dashPlan, #dashSteps, #dashStrength, #dashKnee").count()) === 5);
  const knee = await flat(page.locator("#dashKnee"));
  check("a sore knee day made it through: the knee card has a row for it", (await page.locator("#dashKnee tbody tr").count()) >= 1, knee.slice(0, 200));
  const strength = await flat(page.locator("#dashStrength"));
  check("a lift done most weeks shows a rising trend", /Hack Squat/.test(strength) && /since/.test(strength), strength.slice(0, 200));

  // ---------- Settings: what a demo can't do ----------
  await openTab(page, "settings");
  const health = await flat(page.locator("#setHealth"));
  check("Health Connect: not offered, and says why", /Not available in the demo/.test(health) && (await page.locator("#hcConnect, #hcSync, #bgSync, #hcManage").count()) === 0, health);
  const account = await flat(page.locator("#setAccount"));
  check("Account: no password, no sign-out, just a way back to a real sign-in", /Trying the sample data/.test(account) && (await page.locator("#signOutBtn, #pwBtn").count()) === 0, account);
  check("Your data: export works, import is hidden", (await page.locator("#exportBtn, #csvBtn").count()) === 2 && (await page.locator("#importBtn, #importFile").count()) === 0);
  check("About: no update check, nothing here is a real installed copy", (await page.locator("#updChk, #updChkWeb, #updCheckWebBtn, #updCheckBtn").count()) === 0);

  // ---------- nothing was ever saved to the phone, and no network call was ever made ----------
  check("localStorage stays completely empty through all of that", (await page.evaluate(() => Object.keys(localStorage).length)) === 0);
  check("no request ever reached Supabase or anywhere else", db.unexpected.length === 0 && db.external.length === 0, [...db.unexpected, ...db.external].join(", "));
  check("no console errors along the way", page.errors.length === 0, page.errors.join(" | "));

  // ---------- Sign in leaves the demo; so does a reload ----------
  await signIn.click();
  await page.waitForSelector("#loginView:not([hidden])");
  check("Sign in goes back to the real sign-in screen, demo bar gone", (await page.locator("#demoBar").isHidden()) && (await page.locator("#appView").isHidden()));
  await btn.click();
  await ready(page);
  await calf.locator('input[data-set$=":0:reps"]').fill("9");
  await page.reload();
  await page.waitForSelector("#loginView:not([hidden])", { timeout: 15000 });
  check("a reload ends the demo too: back to sign-in, nothing left of it", (await page.locator("#loginView").isVisible()) && (await page.locator("#appView").isHidden()));
  check("and still nothing in localStorage", (await page.evaluate(() => Object.keys(localStorage).length)) === 0);
  check("only the expected endpoints across the whole run", db.unexpected.length === 0 && db.external.length === 0, [...db.unexpected, ...db.external].join(", "));

  // ---------- signing in after the demo works: the real client is back in place ----------
  await btn.click();
  await ready(page);
  await signIn.click();
  await page.waitForSelector("#loginView:not([hidden])");
  await page.fill("#email", "t@example.com");
  await page.click("#loginBtn");
  check("after Sign in, an email link can be asked for: the request reaches Supabase", (await until(() => db.otp?.length === 1)) && db.otp[0].body.email === "t@example.com");
  await ctx.close();
}

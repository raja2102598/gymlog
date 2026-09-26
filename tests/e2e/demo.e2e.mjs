// The in-app demo: "Try it with sample data" from the sign-in screen, straight into a fully usable app with four
// weeks of made-up history and no Supabase project involved. Smoke checks on Home, Train, the workout, Health and
// Progress, logging a set, editing the plan, what Settings hides or refuses, the banner, and that a reload ends it.
import { flat, open, openSetting, openTab, openWorkout, planDone, ready, until } from "./harness.mjs";

// Calf Raise is the last of Wednesday's five lifts (Legs): lift 4, its sets #s4_<set>_r / _k in the workout.
const CALF = 4;
/** Leaves a pushed screen (Settings, the workout) for Home, where the tabs are. */
async function home(page) {
  if (await page.locator("#closeWorkout").count()) await page.click("#closeWorkout");
  if (await page.locator("#backBtn").count()) await page.click("#backBtn");
  if (!(await page.locator(".tabbar").count())) await page.click("#backBtn");
  await openTab(page, "home");
}

// It opens Health, so it runs with the other suites that do when the tab changes.
export const covers = ["src/components/health/HealthView.tsx", "src/components/health/Rings.tsx"];

export default async function demo({ browser, base, check }) {
  const db = { logs: {}, plan: null };
  const { ctx, page } = await open(browser, base, { auth: null, db });
  await page.waitForSelector("#loginView:not([hidden])");

  // ---------- the sign-in screen offers it ----------
  const btn = page.locator("#demoBtn");
  // Below the email way in and the message line, styled as a link, not another sign-in button.
  const after = await page.evaluate(() => !!(document.getElementById("emailBtn").compareDocumentPosition(document.getElementById("demoBtn")) & Node.DOCUMENT_POSITION_FOLLOWING));
  check("named, and separated from the email and Google ways in", (await flat(btn)) === "Try it with sample data" && after && (await btn.evaluate((b) => b.classList.contains("btn-link"))));
  const box = await btn.boundingBox();
  check("its touch target is at least 44px tall", box.height >= 44, String(box.height));
  const words = await flat(page.locator("#loginView .sheet-note"));
  check("says sample mode saves nothing and that a reload ends it, no em or en dash", /saves nothing/.test(words) && /Reloading ends it/.test(words) && !/[–—]/.test(words), words);
  await btn.click();
  await ready(page);
  check("drops straight onto Home, signed in, no plan-picker first", (await page.locator("#homeView").isVisible()) && (await page.locator("#chooseView").isHidden()));
  check("today is Wed · Legs, the default plan's own day", (await flat(page.locator("#todayName"))) === "Legs");

  // ---------- the banner ----------
  const bar = page.locator("#demoBar");
  check("the banner says it's sample data, nothing saved", (await bar.isVisible()) && (await flat(bar)).startsWith("Sample data. Nothing you do here is saved."));
  const signIn = bar.locator("#demoSignIn");
  const signInBox = await signIn.boundingBox();
  check("its Sign in button is named and full-size", (await flat(signIn)) === "Sign in" && signInBox.height >= 44);
  // As on every banner (the update banner's Install and × too): the message takes the room left, the button the right edge.
  const barEnd = await bar.evaluate((b) => b.getBoundingClientRect().right - parseFloat(getComputedStyle(b).paddingRight));
  check("and it sits at the banner's right edge, beside the message", Math.abs(signInBox.x + signInBox.width - barEnd) < 1 && signInBox.y < (await bar.locator("#demoMsg").boundingBox()).y + 20, `${signInBox.x + signInBox.width} / ${barEnd}`);

  // ---------- Home and Train: a real week of history; the workout: logging a set works ----------
  const doneDays = await page.locator("#week .wd.done, #week .wd.part").count();
  check("the week strip carries real history: seven days, some done", (await page.locator("#week .wd").count()) === 7 && doneDays >= 1, `${doneDays} done`);
  check("today's card says how much is left, in real numbers", /^\d lifts? · \d+ sets/.test(await flat(page.locator("#todaySub"))) && (await flat(page.locator("#startWorkout"))) === "Continue", await flat(page.locator("#todaySub")));
  await openWorkout(page, "Calf Raise");
  const calf = page.locator("#workoutView section.ex-card.lift");
  const calfReps = await calf.locator('.srow.set input[data-set$=":reps"]').evaluateAll((els) => els.map((e) => e.value));
  check(
    "today's last lift is left partway through: one set logged, not done, the rest blank",
    (await flat(calf.locator(".ex-name .nm"))) === "Calf Raise" && calfReps.filter(Boolean).length === 1 && !(await calf.evaluate((c) => c.classList.contains("checked"))),
    calfReps.join(","),
  );
  await page.fill(`#s${CALF}_0_r`, "12");
  await page.click(`[data-addset="${CALF}"]`);
  await page.fill(`#s${CALF}_1_r`, "11");
  await page.fill(`#s${CALF}_1_k`, "20");
  await until(async () => (await flat(page.locator("#status"))) === "Saved");
  check("it saves through the fake client: ends Saved, no sync trouble banner", (await flat(page.locator("#status"))) === "Saved" && (await page.locator("#syncBar").isHidden()));

  // ---------- editing the plan works ----------
  await home(page);
  await openTab(page, "settings");
  await page.click("#planBtn");
  await page.waitForSelector("#planView");
  await page.fill("#pe_goal", "11500");
  await until(async () => (await flat(page.locator("#planMsg"))) === "Saved");
  check("the plan editor saves too", (await flat(page.locator("#planMsg"))) === "Saved");
  await planDone(page); // back to Settings
  await page.waitForSelector("#settingsView");
  await openSetting(page, "setGoals");
  check("the edit stuck: Settings' own goal field shows it", (await page.inputValue("#goalSteps")) === "11500");

  // ---------- Health: a real day of Health Connect-shaped data ----------
  await home(page);
  await openTab(page, "health");
  check("not the empty state: three weeks of Health Connect data were seeded", (await page.locator("#healthEmpty").count()) === 0 && (await page.locator("#activity").isVisible()));
  // Five metric tiles and the water box; a metric with nothing shows "–".
  const blank = await page.locator(".tiles .tile .mt-v").evaluateAll((els) => els.filter((e) => e.textContent.trim() === "–").length);
  check("six tiles, none of them all placeholders", (await page.locator(".tiles .tile").count()) === 6 && blank < 5, `${blank} blank`);
  await openTab(page, "home");
  const homeRings = await page.locator("#homeActivity [role=img]").first().getAttribute("aria-label");
  await openTab(page, "train");
  check("Home's own activity card and Train's Health Connect note show too", /Steps [1-9]\d*%/.test(homeRings ?? "") && (await page.locator("#hcNote").count()) === 1, homeRings);

  // ---------- Progress: four weeks of plan-driven history to show ----------
  // Overview has the weight, plan and steps cards; Strength and Body (the knee) are sections of their own.
  await openTab(page, "progress");
  const overview = await page.locator("#dashWeight, #dashPlan, #dashSteps").count();
  await page.click('#progTabs [data-seg="body"]');
  await page.waitForSelector("#dashKnee");
  const knee = await flat(page.locator("#dashKnee"));
  const kneeRows = await page.locator("#dashKnee tbody tr").count();
  await page.click('#progTabs [data-seg="strength"]');
  await page.waitForSelector("#dashStrength");
  check("weight, plan, steps, strength and knee cards all have something to show", overview === 3 && (await page.locator("#dashStrength").count()) === 1 && knee.length > 0, String(overview));
  check("a sore knee day made it through: the knee card has a row for it", kneeRows >= 1, knee.slice(0, 200));
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
  check("localStorage stays completely empty through all of that", (await page.evaluate(() => Object.keys(localStorage).length)) === 0, await page.evaluate(() => JSON.stringify(localStorage)));
  check("no request ever reached Supabase or anywhere else", db.unexpected.length === 0 && db.external.length === 0, [...db.unexpected, ...db.external].join(", "));
  check("no console errors along the way", page.errors.length === 0, page.errors.join(" | "));

  // ---------- Sign in leaves the demo; so does a reload ----------
  await signIn.click();
  await page.waitForSelector("#loginView:not([hidden])");
  check("Sign in goes back to the real sign-in screen, demo bar gone", (await page.locator("#demoBar").isHidden()) && (await page.locator("#homeView").count()) === 0);
  await btn.click();
  await ready(page);
  await openWorkout(page, "Calf Raise");
  await page.fill(`#s${CALF}_0_r`, "9");
  await home(page); // so the address the reload keeps is Home's
  await page.reload();
  await page.waitForSelector("#loginView:not([hidden])", { timeout: 15000 });
  check("a reload ends the demo too: back to sign-in, nothing left of it", (await page.locator("#loginView").isVisible()) && (await page.locator("#homeView, #workoutView").count()) === 0);
  check("and still nothing in localStorage", (await page.evaluate(() => Object.keys(localStorage).length)) === 0, await page.evaluate(() => JSON.stringify(localStorage)));
  check("only the expected endpoints across the whole run", db.unexpected.length === 0 && db.external.length === 0, [...db.unexpected, ...db.external].join(", "));

  // ---------- signing in after the demo works: the real client is back in place ----------
  await btn.click();
  await ready(page);
  await signIn.click();
  await page.waitForSelector("#loginView:not([hidden])");
  await page.click("#emailBtn");
  await page.fill("#email", "t@example.com");
  await page.click("#loginBtn");
  check("after Sign in, an email link can be asked for: the request reaches Supabase", (await until(() => db.otp?.length === 1)) && db.otp[0].body.email === "t@example.com");
  await ctx.close();
}

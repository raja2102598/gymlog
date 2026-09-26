// Moving between screens (lib/pageTransition.ts, shell.css), with the browser's view transitions on as on a phone:
// a page opened deeper slides in from the right, Back slides it out again, tabs crossfade, nothing animates twice,
// and with Reduce motion on the screen just changes.
import { open, openTab, ready, session, until } from "./harness.mjs";

export const covers = ["src/lib/pageTransition.ts"];

/** Starts noting, frame by frame, the view-transition animations that run and the way <html> says the move goes. */
const watch = (page) =>
  page.evaluate(() => {
    const seen = new Set(), me = (window.__watching = (window.__watching ?? 0) + 1);
    window.__moves = [];
    let frames = 90;
    const tick = () => {
      if (window.__watching !== me) return; // a newer watch took over
      const nav = document.documentElement.dataset.nav ?? "-";
      for (const a of document.getAnimations()) {
        const pe = a.effect?.pseudoElement;
        if (pe?.startsWith("::view-transition-") && a.animationName) seen.add(`${nav} ${a.animationName} ${pe}`);
      }
      window.__moves = [...seen];
      if (--frames > 0) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
const moves = async (page) => {
  await until(async () => (await page.evaluate(() => document.documentElement.dataset.nav)) === undefined, 3000);
  return page.evaluate(() => window.__moves);
};

export default async function motion({ browser, base, check }) {
  const auth = session("00000000-0000-4000-8000-0000000000e1", "2026-08-26T05:00:00Z", "t@example.com");
  const { ctx, page } = await open(browser, base, { auth, db: { logs: {}, plan: {} }, transitions: true });
  await ready(page);
  check("the browser can slide screens, and says so on <html>", (await page.evaluate(() => typeof document.startViewTransition === "function" && "vt" in document.documentElement.dataset)) === true);

  // Deeper: Settings slides in from the right over Home, which drifts left and dims.
  await watch(page);
  await page.click("#settingsBtn");
  await page.waitForSelector("#settingsView");
  let seen = await moves(page);
  check(
    "opening Settings slides it in from the right over Home",
    seen.includes("forward pageIn ::view-transition-new(root)") && seen.includes("forward pageAway ::view-transition-old(root)"),
    seen.join(" | "),
  );
  check("and the screen's own fade-in doesn't run as well", (await page.$eval("#settingsView", (e) => getComputedStyle(e).animationName)) === "none");

  // Back: the same, in reverse.
  await watch(page);
  await page.click("#backBtn");
  await page.waitForSelector("#homeView");
  seen = await moves(page);
  check("Back slides it out to the right, Home coming back from the left", seen.includes("back pageOut ::view-transition-old(root)") && seen.includes("back pageBack ::view-transition-new(root)"), seen.join(" | "));

  // Across the tabs: a crossfade, no slide.
  await watch(page);
  await page.click("#tabHealth");
  await page.waitForSelector("#healthView");
  seen = await moves(page);
  check("switching tabs crossfades, without sliding", seen.some((m) => m.startsWith("across ")) && !seen.some((m) => /page(In|Out|Away|Back)/.test(m)), seen.join(" | "));

  // Reduce motion: the screen just changes.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await watch(page);
  await openTab(page, "train");
  seen = await moves(page);
  check("with Reduce motion on, screens change without moving", seen.length === 0, seen.join(" | "));
  check("no console errors", page.errors.length === 0, page.errors.join(" | "));
  await ctx.close();
}

# Gym Log

A small installable web app for tracking a 5-day gym split: every set you lift (reps × weight), warm-ups, a cardio finisher, daily steps, body weight, waist, knee pain and notes, with a dashboard that shows how it's going. Your data lives in your own free Supabase database, and only your account can read it.

**Live app:** https://gym-log-omega-seven.vercel.app


## What's in here

A [Next.js](https://nextjs.org) app (App Router, TypeScript) exported as a static site: everything runs in the browser against Supabase, so there's no server to keep running.

| Path | What it does |
|---|---|
| `src/app/` | The page, its `<head>` (title, icons, theme colour) and the fonts |
| `src/components/GymLog.tsx` | The app's frame: header, menu, sign-in, and which screen is showing |
| `src/components/today/` | The Today screen: week strip, the day's lifts and sets, knee scores, warm-up, cardio, steps and weight, history |
| `src/components/dashboard/` | The dashboard cards and their charts |
| `src/components/plan/` | The plan editor |
| `src/components/shell/`, `src/components/ui/` | Sign-in, loading placeholder, sync bar, menu; text boxes that keep what you type |
| `src/lib/store.ts` | The data: the copy kept on the phone, saving to Supabase in the background, and everything worked out from your days (last time, next weight, records, missed sessions) |
| `src/lib/stats.ts`, `src/lib/dashboard.ts` | The calculations behind the dashboard, add-weight hints and records (weight trend, weekly rate, estimated 1RM, personal records) |
| `src/lib/config.ts` | Supabase project URL and publishable key (safe to publish; RLS protects the data) |
| `src/data/plan.json` | The default workout plan: days, exercises, sets/reps, cues, cardio, warm-ups. Used until you edit your plan in the app. |
| `src/styles/` | The look: colours and type (`tokens.css`), shared controls, then one file per screen |
| `src/fonts/` | Oswald and IBM Plex (SIL Open Font License), served from the site so they work offline |
| `src/service-worker.js`, `scripts/build-sw.mjs` | Offline support: after each build the script writes `out/sw.js`, which keeps every file of the site on the phone |
| `public/` | `manifest.webmanifest` and icons, for "Add to Home screen" |
| `supabase/schema.sql` | The database tables (`logs`, `plans`) and their security rules. Safe to re-run. |
| `tests/unit/`, `tests/e2e/` | Tests: the calculations (Vitest), and the whole app in Chrome with Supabase mocked |
| `vercel.json` | How Vercel builds and serves the site |


## Working on it

Needs Node.js 20 (20.19 or later), 22 (22.12 or later) or 24.

```bash
npm install
npm run dev          # the app at http://localhost:3000, reloading as you edit
npm run build        # the site in out/, plus out/sw.js
npm run preview      # serves out/ at http://127.0.0.1:3000
npm run lint && npm run typecheck && npm test
npm run test:e2e     # after a build; needs Chrome for Playwright: npx playwright-core install chromium
```

The development server uses the same Supabase project as the live app. Sign-in links only come back to addresses listed in Supabase under Authentication → URL Configuration (anything else lands on the live app), so to sign in on `localhost`, add `http://localhost:3000/**` there.


## How it's set up

- **Code:** private GitHub repo `raja2102598/gymlog`.
- **Hosting:** Vercel project `gym-log`. `vercel.json` has the settings: it runs `npm ci` and `npm run build` and serves `out/`, and it tells browsers they can keep the fingerprinted files in `/_next/static` for good. Every push to `main` deploys to the live app; other branches get preview deployments that need a Vercel login to open.
- **Database and sign-in:** Supabase project **Personal** (ap-south-1). Tables `logs` (one row per day) and `plans` (your edited plan) use row-level security, so each account sees only its own rows. Authentication → URL Configuration has the live app as the Site URL and `https://gym-log-omega-seven.vercel.app/**` as a redirect URL.

### Setting it up again from scratch
1. In a Supabase project, run `supabase/schema.sql` (SQL Editor → New query → paste → Run), then put the project URL and publishable key in `src/lib/config.ts`.
2. On Vercel: Add New → Project → import the repo. `vercel.json` sets the build, so the defaults are fine.
3. In Supabase → Authentication → URL Configuration, set the Site URL to the new site address and add the same address followed by `/**` as a redirect URL.


## Install on your phone
1. Open the live app in Chrome on your phone and sign in with your email. Tap the link in the email **on the same phone**.
2. Chrome menu **⋮ → Add to Home screen → Install**. It then opens like a normal app.


## Everyday use
- The app opens on today. Tap a day in the week strip to look at or fill in another day. A day is green when every lift is done, pale green with a green edge when some are, and has an orange edge when a workout day was missed.
- **Warm-up:** tap **Warm-up** to show the list and tick what you did. It starts folded so the lifts come first, and rest days don't show it.
- **Sets:** each lift has a row per planned set. Enter reps and kg; the next set copies the weight you just used. Grey numbers in empty boxes are what you did last time (or the next weight to try), and a set's number turns green once its reps are logged. Logging the planned number of sets ticks the lift off. Use **+ Set** for extra sets.
- **Change a day's workout:** the picker under the day's title lets any day use another day's workout, e.g. do a missed Push on a rest day. Rest days list the sessions you missed earlier that week, with a button to do one. The weekly count still counts each planned session once.
- **Skip or swap:** tap **···** on a lift. *Skip today* (with an optional reason, e.g. machine busy) or *Swap for another lift* to log a different exercise in its place. The same menu undoes either.
- **Adding weight:** when every set of a lift reached the top of its rep range last time, the lift says *Go up to … kg* and the grey numbers switch to the new weight at the bottom of the range. Each lift adds 2.5 kg unless you set its own step in the plan.
- **Records:** a set that beats every earlier session of that lift (heaviest weight, best estimated 1RM, or most reps at that weight or more) gets a **PR** badge as you type it.
- **Knee:** on days with knee-sensitive lifts, tap your knee pain from 0 to 10 before and after the session, and on waking the next morning. Once scored, the scale folds to one line; **Change** opens it again. If pain goes above your limit (5 unless you change it), or hasn't settled by the morning, knee-sensitive lifts say *Hold … kg* instead of going up next time.
- **Cardio and waist:** under the cardio finisher, log minutes, speed and incline (entering minutes ticks the finisher). The waist field sits next to body weight; once a week is enough.
- **Dashboard:** the **Dashboard** button at the top. Weight trend and weekly rate, with a goal date and your pace against the target once you set them in the plan; sessions kept, full weeks in a row and a calendar; steps by week; strength (estimated 1RM of each day's first lift, lifts ready for more weight, recent records); knee scores by session. Notes at the top point out anything that needs attention, such as no weigh-in for a while.
- **Home-screen shortcuts:** once installed, long-press the app icon for *Today*, *Log weight* or *Log steps*.
- **Edit your plan:** **Menu → Edit plan**. Change session names, lifts, sets/reps, cues, cardio, warm-ups, the step goal and tempo. Each lift can have its own weight step and be marked knee-sensitive; the plan also holds your goal weight, target loss a week (% of body weight) and knee pain limit. Changes save as you type and sync to your other devices. *Reset to the default plan* brings back `src/data/plan.json`.
- Changes save automatically. With poor gym signal they're kept on the phone and sync when you're back online. If a save fails, or you're offline with days waiting, a bar at the top says how many days haven't synced yet, with **Retry now**. The app asks the browser to keep its storage, so edits waiting to sync aren't cleared to free space.
- **Menu → Export my data** downloads every day as JSON; **Import data** brings a file like that back in.


## How the numbers work
- **Weight trend:** one value a day from your weigh-ins, with gaps filled by straight lines, smoothed with Holt's method as [TrendWeight](https://github.com/ervwalter/trendweight) does. It starts from a straight-line fit of your first two weeks, so it doesn't lag behind at the start.
- **Weekly rate:** a straight-line fit of your weigh-ins over the last four weeks. It shows once you have six weigh-ins spread over two weeks; before that, water weight hides the real change.
- **Estimated 1RM:** Brzycki's formula, only from sets of 12 reps or fewer.


## Notes
- Your history follows each lift by name. Renaming a lift in the plan starts a fresh history for it; days you've already logged keep what you logged.
- Supabase's free plan pauses a project after about a week with no activity. Logging every day keeps it awake. If it does pause, click **Restore** in the Supabase dashboard; no data is lost.
- The installed app loads its files from the phone's cache first, so it opens straight away even on weak signal. Each build gives `sw.js` a new version (a fingerprint of the site's files), so there's nothing to bump by hand: installed copies download the new files in the background and use them from the next launch.

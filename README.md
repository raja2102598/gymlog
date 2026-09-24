# Gym Log

A small installable web app for tracking a 5-day gym split: every set you lift (reps × weight), warm-ups, a cardio finisher, daily steps, body weight, waist, knee pain and notes, with a dashboard that shows how it's going. Your data lives in your own free Supabase database, and only your account can read it.

There's also an [Android app](#android-app-and-health-connect): the same app, which can also read steps, weight, sleep, heart rate and workouts from Health Connect.

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
| `src/lib/health.ts` | Health Connect's readings turned into one entry a day, and the words the screens use for them |
| `src/native/`, `src/lib/native.ts` | Code that only runs in the Android app: reading Health Connect, and signing in from the email link |
| `src/lib/stats.ts`, `src/lib/dashboard.ts` | The calculations behind the dashboard, add-weight hints and records (weight trend, weekly rate, estimated 1RM, personal records) |
| `src/lib/config.ts` | Supabase project URL and publishable key (safe to publish; RLS protects the data) |
| `src/data/plan.json` | The default workout plan: days, exercises, sets/reps, cues, cardio, warm-ups. Used until you edit your plan in the app. |
| `src/styles/` | The look: colours and type (`tokens.css`), shared controls, then one file per screen |
| `src/fonts/` | Oswald and IBM Plex (SIL Open Font License), served from the site so they work offline |
| `src/service-worker.js`, `scripts/build-sw.mjs` | Offline support: after each build the script writes `out/sw.js`, which keeps every file of the site on the phone |
| `public/` | `manifest.webmanifest` and icons, for "Add to Home screen"; `privacypolicy.html`, which Health Connect shows when you give the Android app access |
| `supabase/schema.sql` | The database tables (`logs`, `plans`, `health_days`) and their security rules. Safe to re-run. |
| `android/`, `capacitor.config.ts` | The Android app ([Capacitor](https://capacitorjs.com)): the site in a native shell, with the Health Connect permissions it asks for |
| `.github/workflows/android.yml` | Builds the Android app for every pull request and push to `main`, and publishes it from `main` |
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
- **Database and sign-in:** Supabase project **Personal** (ap-south-1). Tables `logs` (one row per day), `plans` (your edited plan) and `health_days` (Health Connect's numbers, one row per day, written by the Android app) use row-level security, so each account sees only its own rows. Authentication → URL Configuration has the live app as the Site URL, and two redirect URLs: `https://gym-log-omega-seven.vercel.app/**` for the site and `io.github.raja2102598.gymlog://login` for the Android app.
- **Android app:** GitHub Actions (`.github/workflows/android.yml`) builds it. Its signing key is in two repository secrets, `GYMLOG_KEYSTORE_BASE64` and `GYMLOG_KEYSTORE_PASSWORD` (see [Updates](#updates-and-the-signing-key)).

### Setting it up again from scratch
1. In a Supabase project, run `supabase/schema.sql` (SQL Editor → New query → paste → Run), then put the project URL and publishable key in `src/lib/config.ts`.
2. On Vercel: Add New → Project → import the repo. `vercel.json` sets the build, so the defaults are fine.
3. In Supabase → Authentication → URL Configuration, set the Site URL to the new site address and add the same address followed by `/**` as a redirect URL. For the Android app, add `io.github.raja2102598.gymlog://login` too.


## Install on your phone
1. Open the live app in Chrome on your phone and sign in with your email. Tap the link in the email **on the same phone**.
2. Chrome menu **⋮ → Add to Home screen → Install**. It then opens like a normal app.


## Everyday use
- The app opens on today. Tap a day in the week strip to look at or fill in another day. A day is green when every lift is done, pale green with a green edge when some are, and has an orange edge when a workout day was missed.
- **Warm-up:** tap **Warm-up** to show the list and tick what you did. It starts folded so the lifts come first, and rest days don't show it.
- **Lifts and sets:** each lift is a card.
  - Under its name you see the plan (e.g. 3 × 8-10) and what you did last time, set by set. An arrow shows when today's heaviest set is already heavier.
  - Each planned set has a row: enter reps and kg, and the next set copies the weight you just used. Grey numbers in empty boxes are suggestions: last time's numbers, or the next weight to try.
  - A set's number turns green once its reps are logged, and logging the planned number of sets fills the round tick. Tap the tick to set it by hand.
  - **+ Set** adds a set and **− Set** removes the last one, asking first if it has numbers in it. **How to** opens the lift's form notes; warnings such as a KNEE NOTE always show.
  - The bar under the day's title fills as lifts are done.
- **Change a day's workout:** the picker under the day's title lets any day use another day's workout, e.g. do a missed Push on a rest day. Rest days list the sessions you missed earlier that week, with a button to do one. The weekly count still counts each planned session once.
- **Skip or swap:** tap **···** on a lift. *Skip today* (with an optional reason, e.g. machine busy) or *Swap for another lift* to log a different exercise in its place. The same menu undoes either.
- **Adding weight:** when every set of a lift reached the top of its rep range last time, the lift says *Go up to … kg* and the grey numbers switch to the new weight at the bottom of the range. Each lift adds 2.5 kg unless you set its own step in the plan.
- **Records:** a set that beats every earlier session of that lift (heaviest weight, best estimated 1RM, or most reps at that weight or more) gets a **PR** badge as you type it.
- **Knee:** on days with knee-sensitive lifts, tap your knee pain from 0 to 10 before and after the session, and on waking the next morning. Once scored, the scale folds to one line; **Change** opens it again. If pain goes above your limit (5 unless you change it), or hasn't settled by the morning, knee-sensitive lifts say *Hold … kg* instead of going up next time.
- **Cardio and waist:** under the cardio finisher, log minutes, speed and incline (entering minutes ticks the finisher). The waist field sits next to body weight; once a week is enough.
- **Dashboard:** the **Dashboard** button at the top. Weight trend and weekly rate, with a goal date and your pace against the target once you set them in the plan; sessions kept, full weeks in a row and a calendar; steps by week; strength (estimated 1RM of each day's first lift, lifts ready for more weight, recent records); knee scores by session. Notes at the top point out anything that needs attention, such as no weigh-in for a while. The phone's Back button returns to Today, from here and from the plan editor, and `/#dashboard` opens the dashboard directly.
- **Home-screen shortcuts:** once installed, long-press the app icon for *Today*, *Log weight* or *Log steps*.
- **Edit your plan:** **Menu → Edit plan**. Change session names, lifts, sets/reps, cues, cardio, warm-ups, the step goal and tempo. Each lift can have its own weight step and be marked knee-sensitive; the plan also holds your goal weight, target loss a week (% of body weight) and knee pain limit. Changes save as you type and sync to your other devices. *Reset to the default plan* brings back `src/data/plan.json`.
- Changes save automatically. With poor gym signal they're kept on the phone and sync when you're back online. If a save fails, or you're offline with days waiting, a bar at the top says how many days haven't synced yet, with **Retry now**. The app asks the browser to keep its storage, so edits waiting to sync aren't cleared to free space.
- **Menu → Export data** downloads every day as JSON; **Import data** brings a file like that back in. If the file has different entries for days you've already logged, it asks before replacing them.

- **Health Connect:** in the [Android app](#android-app-and-health-connect), steps and body weight from Health Connect show in grey in their boxes until you type your own, and a card under them shows the night's sleep, resting heart rate, active calories and any workouts other apps recorded. The dashboard's *Sleep, heart and workouts* card compares this week with the week before. The website shows the same numbers once the app has synced them.


## Android app and Health Connect
The Android app is the same Gym Log, installed from a file instead of Chrome, and it can read [Health Connect](https://support.google.com/android/answer/12201227), where Samsung Health, Google Fit, Fitbit, most watches and many scales keep their data. It reads steps, body weight, sleep, heart rate and resting heart rate, active calories, and workouts with their calories and distance. It never writes to Health Connect.

**Needs:** Android 8 or later, and Health Connect: built into Settings on Android 14 and later (search Settings for *Health Connect*), or the **Health Connect** app from Google Play on Android 8 to 13. In the app that records your data (Samsung Health, Fit, your watch's app), turn on sharing with Health Connect.

### Install
1. On the phone, sign in to GitHub in Chrome (the repo is private), open the repo's **Releases** and the latest **Gym Log for Android**, and download `gym-log.apk`.
2. Open the downloaded file. Android asks once to allow installs from Chrome (or your Files app): allow it, go back and tap **Install**. Google Play Protect may say it doesn't know the developer: tap **More details → Install anyway**.
3. Open Gym Log, enter your email and tap the link in the email **on the same phone**. It opens the app, signed in. (The sign-in link only comes back to the app if Supabase lists `io.github.raja2102598.gymlog://login` as a redirect URL; see [How it's set up](#how-its-set-up).)
4. **Menu → Connect Health Connect**, then allow what Gym Log asks for, including past data. The first sync reads back to when your log started (30 to 90 days).

After that it syncs the last 10 days (other apps' data can arrive late) each time you open the app or come back to it, at most every 5 minutes, and **Menu → Sync now** syncs straight away. The menu says when it last synced and what changed.

### What it does with the data
- Each day's numbers go to your Supabase database, in `health_days`, one row per day, behind the same row-level security as your log. Nothing is sent anywhere else. The website reads them to show the same cards, but only the app writes them.
- A number you type always wins: Health Connect's steps or weight only show on days you left the box empty, and history, the week so far and the dashboard use them the same way.
- To stop: open Health Connect → **App permissions → Gym Log** and turn its access off, or uninstall the app. Days already synced stay in `health_days`; delete them in Supabase (Table Editor → `health_days`) if you want them gone.

### Updates and the signing key
The app carries its own copy of the site, so changes to the site only reach it in a new APK. Every push to `main` builds one and publishes it as the **android-latest** release (GitHub → Actions → *Android app* shows each build; pull requests get an APK under the run's *Artifacts*). Install it over the old one the same way; you stay signed in.

An update only installs over the app if it's signed with the same key. The key is `gymlog-release.p12`, kept outside the repo, and GitHub Actions gets it from two repository secrets (Settings → Secrets and variables → Actions): `GYMLOG_KEYSTORE_BASE64` (the file, base64-encoded) and `GYMLOG_KEYSTORE_PASSWORD`. Without them, builds are signed with a throwaway key and nothing is published. Keep a copy of the key and its password somewhere safe: if they're lost, make a new key, update the secrets, and uninstall the app before installing the next build (your data is in Supabase, so you only sign in again and reconnect Health Connect).

### Building it yourself
Needs JDK 21 and the Android SDK (Android Studio installs both).

```bash
npm run android                      # builds the site and copies it into android/
cd android && ./gradlew assembleDebug  # android/app/build/outputs/apk/debug/app-debug.apk
```

Or open `android/` in Android Studio and press Run with the phone plugged in. For a release build signed with your key, set `GYMLOG_KEYSTORE` (the `.p12` file's path), `GYMLOG_KEYSTORE_PASSWORD` and `GYMLOG_VERSION_CODE` (a number higher than the installed build's), then run `./gradlew assembleRelease`.


## How the numbers work
- **Weight trend:** one value a day from your weigh-ins, with gaps filled by straight lines, smoothed with Holt's method as [TrendWeight](https://github.com/ervwalter/trendweight) does. It starts from a straight-line fit of your first two weeks, so it doesn't lag behind at the start.
- **Weekly rate:** a straight-line fit of your weigh-ins over the last four weeks. It shows once you have six weigh-ins spread over two weeks; before that, water weight hides the real change.
- **Estimated 1RM:** Brzycki's formula, only from sets of 12 reps or fewer.


## Notes
- Your history follows each lift by name. Renaming a lift in the plan starts a fresh history for it; days you've already logged keep what you logged.
- Supabase's free plan pauses a project after about a week with no activity. Logging every day keeps it awake. If it does pause, click **Restore** in the Supabase dashboard; no data is lost.
- The installed app loads its files from the phone's cache first, so it opens straight away even on weak signal. Each build gives `sw.js` a new version (a fingerprint of the site's files), so there's nothing to bump by hand: installed copies download the new files in the background and use them from the next launch.

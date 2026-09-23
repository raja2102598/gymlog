# Gym Log

A small installable web app for tracking a 5-day gym split: every set you lift (reps × weight), warm-ups, a cardio finisher, daily steps, body weight and notes. Your data lives in your own free Supabase database, and only your account can read it.

**Live app:** https://gym-log-omega-seven.vercel.app


## What's in here

| File | What it does |
|---|---|
| `index.html`, `styles.css`, `app.js` | The app itself (plain HTML/JS, no build step) |
| `plan.json` | The default workout plan: days, exercises, sets/reps, cues, cardio, warm-ups. Used until you edit your plan in the app. |
| `config.js` | Supabase project URL and publishable key (safe to publish; RLS protects the data) |
| `supabase/schema.sql` | The database tables (`logs`, `plans`) and their security rules. Safe to re-run. |
| `sw.js`, `manifest.webmanifest`, `icons/` | Offline support and "Add to Home screen" |
| `vendor/supabase.js` | Supabase JS client v2.117.1, bundled so the app needs no CDN |
| `.vercelignore` | Keeps the README, schema and other repo-only files off the website |


## How it's set up

- **Code:** private GitHub repo `raja2102598/gymlog`.
- **Hosting:** Vercel project `gym-log` (Framework: Other, no build or install command, output directory `.`). Every push to `main` deploys to the live app; other branches get preview deployments that need a Vercel login to open.
- **Database and sign-in:** Supabase project **Personal** (ap-south-1). Tables `logs` (one row per day) and `plans` (your edited plan) use row-level security, so each account sees only its own rows. Authentication → URL Configuration has the live app as the Site URL and `https://gym-log-omega-seven.vercel.app/**` as a redirect URL.

### Setting it up again from scratch
1. In a Supabase project, run `supabase/schema.sql` (SQL Editor → New query → paste → Run), then put the project URL and publishable key in `config.js`.
2. On Vercel: Add New → Project → import the repo. Framework: *Other*, no build or install command, output directory `.`.
3. In Supabase → Authentication → URL Configuration, set the Site URL to the new site address and add the same address followed by `/**` as a redirect URL.


## Install on your phone
1. Open the live app in Chrome on your phone and sign in with your email. Tap the link in the email **on the same phone**.
2. Chrome menu **⋮ → Add to Home screen → Install**. It then opens like a normal app.


## Everyday use
- The app opens on today. Tap a day in the week strip to look at or fill in another day.
- **Sets:** each lift has a row per planned set. Enter reps and kg; the next set copies the weight you just used, and the grey numbers show what you did last time. Logging the planned number of sets ticks the lift off. Use **+ Set** for extra sets.
- **Skip or swap:** tap **···** on a lift. *Skip today* (with an optional reason, e.g. machine busy) or *Swap for another lift* to log a different exercise in its place. The same menu undoes either.
- **Edit your plan:** **Menu → Edit plan**. Change session names, lifts, sets/reps, cues, cardio, warm-ups, the step goal and tempo. Changes save as you type and sync to your other devices. *Reset to the default plan* brings back `plan.json`.
- Changes save automatically. With poor gym signal they're kept on the phone and sync when you're back online.
- **Menu → Export my data** downloads every day as JSON; **Import data** brings a file like that back in.


## Notes
- Your history follows each lift by name. Renaming a lift in the plan starts a fresh history for it; days you've already logged keep what you logged.
- Supabase's free plan pauses a project after about a week with no activity. Logging every day keeps it awake. If it does pause, click **Restore** in the Supabase dashboard; no data is lost.
- After changing app files, bump `VERSION` in `sw.js` so installed copies pick up the update.

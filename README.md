# Gym Log

A small installable web app for tracking a 5-day gym split: lifts (with the weight used), warm-ups, a cardio finisher, daily steps, body weight and notes. Your data lives in your own free Supabase database, and only your account can read it.

**Live app:** https://raja2102598.github.io/gym-log/

## What's in here

| File | What it does |
|---|---|
| `index.html`, `styles.css`, `app.js` | The app itself (plain HTML/JS, no build step) |
| `plan.json` | The workout plan: days, exercises, sets/reps, cues, cardio, warm-up list. Edit this to change the plan. |
| `config.js` | Your Supabase project URL and anon key |
| `supabase/schema.sql` | The database table and security rules |
| `sw.js`, `manifest.webmanifest`, `icons/` | Offline support and "Add to Home screen" |
| `vendor/supabase.js` | Supabase JS client v2.117.1, bundled so the app needs no CDN |

## One-time setup (about 10 minutes)

### 1. Create the Supabase project
1. Sign up at https://supabase.com (free plan) and click **New project**.
2. Name it `gym-log`, set a database password (save it somewhere), pick the **Mumbai (ap-south-1)** region, and create it.

### 2. Create the table
1. In the project, open **SQL Editor → New query**.
2. Paste everything from [`supabase/schema.sql`](supabase/schema.sql) and click **Run**. You should see "Success. No rows returned".

### 3. Allow sign-in links to come back to the app
1. Open **Authentication → URL Configuration**.
2. Set **Site URL** to `https://raja2102598.github.io/gym-log/`
3. Under **Redirect URLs**, add `https://raja2102598.github.io/gym-log/**`

### 4. Connect the app
1. Open **Project Settings → API** (or **Data API**).
2. Copy the **Project URL** and the **anon public** key.
3. Put them in [`config.js`](config.js) and commit. The site updates within a minute or so.

The anon key is meant to be public. The row-level security rules in `schema.sql` are what protect your data.

### 5. Install on your phone
1. Open the live app in Chrome on your phone and sign in with your email (tap the link in the email **on the same phone**).
2. Chrome menu **⋮ → Add to Home screen → Install**. It then opens like a normal app.

### 6. Bring over your old log
Use the **Menu → Import data (.json)** button and pick the export file you were given.

## Everyday use
- The app opens on today. Tap a day in the week strip to look at or fill in another day.
- Changes save automatically. With poor gym signal they're kept on the phone and sync when you're back online.
- **Menu → Export my data** downloads everything as JSON for your own backup.

## Notes
- Supabase's free plan pauses a project after about a week with no activity. Logging every day keeps it awake. If it does pause, click **Restore** in the Supabase dashboard; no data is lost.
- After changing app files, bump `VERSION` in `sw.js` so installed copies pick up the update.

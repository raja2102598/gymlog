# Gym Log

A small installable web app for tracking a 5-day gym split: lifts (with the weight used), warm-ups, a cardio finisher, daily steps, body weight and notes. Your data lives in your own free Supabase database, and only your account can read it.


## What's in here

| File | What it does |
|---|---|
| `index.html`, `styles.css`, `app.js` | The app itself (plain HTML/JS, no build step) |
| `plan.json` | The workout plan: days, exercises, sets/reps, cues, cardio, warm-up list. Edit this to change the plan. |
| `config.js` | Supabase project URL and publishable key (safe to publish; RLS protects the data) |
| `supabase/schema.sql` | The database table and security rules |
| `sw.js`, `manifest.webmanifest`, `icons/` | Offline support and "Add to Home screen" |
| `vendor/supabase.js` | Supabase JS client v2.117.1, bundled so the app needs no CDN |

## Setup

The Supabase side is already done: project **Personal** (ap-south-1) has the `logs` table with row-level security, and `config.js` points at it.

### 1. Push to GitHub (private repo is fine)
```bash
git remote add origin https://github.com/raja2102598/gym-log.git
git push -u origin main
```

### 2. Host it for free
GitHub Pages doesn't host **private** repos on the free plan, so use one of these instead. All three are free and deploy straight from a private repo:
- **Netlify:** Add new site → Import from Git → pick `gym-log`. Build command: *(empty)*. Publish directory: `.`
- **Vercel:** Add New → Project → import `gym-log`. Framework: *Other*. No build command, output directory `.`
- **Cloudflare Pages:** Workers & Pages → Create → Pages → Connect to Git. No build command, output directory `/`

Every push to `main` redeploys automatically. Note the site address you get (e.g. `https://gym-log-raja.netlify.app/`).

### 3. Let sign-in links come back to the app
Supabase dashboard → **Authentication → URL Configuration**:
- **Site URL:** your site address from step 2
- **Redirect URLs:** add the same address followed by `**` (e.g. `https://gym-log-raja.netlify.app/**`)

### 4. Install on your phone
1. Open the site in Chrome on your phone and sign in with your email. Tap the link in the email **on the same phone**.
2. Chrome menu **⋮ → Add to Home screen → Install**. It then opens like a normal app.

### 5. Bring over your old log
**Menu → Import data (.json)** and pick the export file.

## Everyday use
- The app opens on today. Tap a day in the week strip to look at or fill in another day.
- Changes save automatically. With poor gym signal they're kept on the phone and sync when you're back online.
- **Menu → Export my data** downloads everything as JSON for your own backup.

## Notes
- Supabase's free plan pauses a project after about a week with no activity. Logging every day keeps it awake. If it does pause, click **Restore** in the Supabase dashboard; no data is lost.
- After changing app files, bump `VERSION` in `sw.js` so installed copies pick up the update.

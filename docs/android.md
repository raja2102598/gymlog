# Android app and Health Connect

The Android app is the same Gym Log, installed from a file instead of Chrome, and it can read [Health Connect](https://support.google.com/android/answer/12201227), where Samsung Health, Google Fit, Fitbit, most watches and many scales keep their data. It reads 20 kinds of data: steps (by the day and the hour), distance, floors, active, total and resting calories, calories eaten, water, heart rate, resting heart rate, heart rate variability, blood oxygen, breathing rate, VO₂ max, blood pressure, weight, body fat, height, sleep with its stages, and workouts. It never writes to Health Connect.

**Needs:** Android 8 or later, and Health Connect: built into Settings on Android 14 and later (search Settings for *Health Connect*), or the **Health Connect** app from Google Play on Android 8 to 13. In the app that records your data (Samsung Health, Fit, your watch's app), turn on sharing with Health Connect.

## Install

1. On the phone, open the repo's **Releases** page on GitHub in Chrome, then the latest **Gym Log for Android**, and download `gym-log.apk`.
2. Open the downloaded file. Android asks once to allow installs from Chrome (or your Files app): allow it, go back and tap **Install**. Google Play Protect may say it doesn't know the developer: tap **More details → Install anyway**.
3. Sign in. Easiest is **Continue with Google**, once [it's set up](google-sign-in.md), or a password: set one on the website first (**Settings → Set a password**), then in the app tap **Use a password instead**. Or ask for an email link and tap it **on the same phone**: it opens a Gym Log page on the site, which opens the app signed in (tap **Open Gym Log** if it doesn't by itself). Each link works once, and only the newest one does.
4. **Settings → Health Connect → Connect**, then allow what Gym Log asks for, including past data. The first sync reads back to when your log started (30 to 90 days). Only some kinds allowed? **Allow** under it asks for the rest; each newly allowed kind is read back that far too.
5. For syncing while the app is closed, turn on **Sync in the background** in the same place, and allow Health Connect's *access data in the background* when it asks.

While the app is open it syncs the last 10 days (other apps' data can arrive late) when you open it or come back to it, and every 15 minutes, and **Sync now** syncs straight away. Settings says when it last synced and what changed.

## Background sync

With **Sync in the background** on, Android runs a small job about every hour, even with the app closed: it reads the last 3 days from Health Connect and saves any that changed. It only runs with a network connection, and Android may delay it to save battery. Settings shows when it last ran and what happened.

- It needs Health Connect's background reading, which some phones don't have yet (it comes with Health Connect updates from Google Play). Settings says so when it's missing, and Gym Log then syncs whenever you open it.
- The job can't use your sign-in, which expires. Turning it on makes a random key for this phone that can do one thing, save this account's recent Health Connect days. Supabase keeps only its fingerprint. Turning it off, or signing out, removes it from the phone; turning it off also deletes it from Supabase. If the key stops working, background sync turns itself off and Settings says why.

## What it does with the data

- Each day's numbers go to your Supabase database, in `health_days`, one row per day, behind the same row-level security as your log. Nothing is sent anywhere else. The website reads them to show the same cards, but only the app writes them.
- A number you type always wins: Health Connect's steps or weight only show on days you left the box empty, and history, the week so far, Health and Progress use them the same way.
- To stop: turn off **Sync in the background**, then open Health Connect → **App permissions → Gym Log** (or **Settings → Manage in Health Connect** in the app) and turn its access off, or uninstall the app. Days already synced stay in `health_days`; delete them in Supabase (Table Editor → `health_days`) if you want them gone.

## Updates and the signing key

The app carries its own copy of the site, so changes to the site only reach it in a new APK. Every push to `main` builds one and publishes it as the **android-latest** release (GitHub → Actions → *Android app* shows each build; pull requests get an APK under the run's *Artifacts*). Install it over the old one the same way; you stay signed in.

An update only installs over the app if it's signed with the same key. The key is a `.p12` file kept outside the repo, and GitHub Actions gets it from two repository secrets (Settings → Secrets and variables → Actions): `GYMLOG_KEYSTORE_BASE64` (the file, base64-encoded) and `GYMLOG_KEYSTORE_PASSWORD`. Without them, builds are signed with a throwaway key and nothing is published. Keep a copy of the key and its password somewhere safe: if they're lost, make a new key, update the secrets, and uninstall the app before installing the next build (your data is in Supabase, so you only sign in again and reconnect Health Connect).

The build also reads the same `NEXT_PUBLIC_*` variables as the site, from repository variables on the same settings page (see `.env.example`). Without them the workflow builds an APK that shows the setup screen, and refuses to publish it.

## Building it yourself

Needs JDK 21 and the Android SDK (Android Studio installs both), and a `.env.local` with your project (see `.env.example`).

```bash
npm run android                        # builds the site and copies it into android/
cd android && ./gradlew assembleDebug  # android/app/build/outputs/apk/debug/app-debug.apk
```

Or open `android/` in Android Studio and press Run with the phone plugged in. For a release build signed with your key, set `GYMLOG_KEYSTORE` (the `.p12` file's path), `GYMLOG_KEYSTORE_PASSWORD` and `GYMLOG_VERSION_CODE` (a number higher than the installed build's), then run `./gradlew assembleRelease`.

The Kotlin has its own tests: `./gradlew testReleaseUnitTest`. They include a check that `HealthDays.kt` turns Health Connect's readings into the same days as `src/lib/health.ts`, against `tests/fixtures/health-days.json`.

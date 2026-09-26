# Android app and Health Connect

The Android app is the same Gym Log, installed from a file instead of Chrome, and it can read [Health Connect](https://support.google.com/android/answer/12201227), where Samsung Health, Google Fit, Fitbit, most watches and many scales keep their data. It reads 20 kinds of data: steps (by the day and the hour), distance, floors, active, total and resting calories, calories eaten, water, heart rate, resting heart rate, heart rate variability, blood oxygen, breathing rate, VO₂ max, blood pressure, weight, body fat, height, sleep with its stages, and workouts. It never writes to Health Connect.

**Needs:** Android 8 or later, and Health Connect: built into Settings on Android 14 and later (search Settings for *Health Connect*), or the **Health Connect** app from Google Play on Android 8 to 13. In the app that records your data (Samsung Health, Fit, your watch's app), turn on sharing with Health Connect.

## Install

1. On the phone, open the repo's **Releases** page on GitHub in Chrome, then the latest **Gym Log for Android**, and download `gym-log.apk`.
2. Open the downloaded file. Android asks once to allow installs from Chrome (or your Files app): allow it, go back and tap **Install**. Google Play Protect may say it doesn't know the developer: tap **More details → Install anyway**.
3. Sign in. Easiest is **Continue with Google**, once [it's set up](google-sign-in.md), or a password: set one on the website first (**Settings → Account → Set a password**), then in the app tap **Use a password instead**. Or ask for an email link and tap it **on the same phone**: it opens a Gym Log page on the site, which opens the app signed in (tap **Open Gym Log** if it doesn't by itself). Each link works once, and only the newest one does.
4. **Settings → Health Connect → Connect**, then allow what Gym Log asks for, including past data. The first sync reads back to when your log started (30 to 90 days). Only some kinds allowed? **Allow** under it asks for the rest; each newly allowed kind is read back that far too.
5. For syncing while the app is closed, turn on **Sync in the background** in the same place, and allow Health Connect's *access data in the background* when it asks.

While the app is open it syncs the last 10 days (other apps' data can arrive late) when you open it or come back to it, and every 15 minutes, and **Sync now** syncs straight away. While it's on screen it also reads today's numbers every 30 seconds, so steps and calories move as you do; that quick read only saves when something changed, and never when part of it failed. Settings says when it last synced and what changed.

## Background sync

With **Sync in the background** on, Android runs a small job about every hour, even with the app closed: it reads the last 3 days from Health Connect and saves any that changed. It only runs with a network connection, and Android may delay it to save battery. Settings shows when it last ran and what happened.

- It needs Health Connect's background reading, which some phones don't have yet (it comes with Health Connect updates from Google Play). Settings says so when it's missing, and Gym Log then syncs whenever you open it.
- The job can't use your sign-in, which expires. Turning it on makes a random key for this phone that can do one thing, save this account's recent Health Connect days. Supabase keeps only its fingerprint. Turning it off, or signing out, removes it from the phone; turning it off also deletes it from Supabase. If the key stops working, background sync turns itself off and Settings says why.

## What it does with the data

- Each day's numbers go to your Supabase database, in `health_days`, one row per day, behind the same row-level security as your log. Nothing is sent anywhere else. The website reads them to show the same cards. Only the app writes them, except that restoring a backup (**Settings → Export & backup → Import data**) fills in days the database doesn't have.
- A number you type always wins: Health Connect's steps or weight only show on days you left the box empty, and history, the week so far, Health and Progress use them the same way.
- To stop: turn off **Sync in the background**, then open Health Connect → **App permissions → Gym Log** (or **Settings → Manage in Health Connect** in the app) and turn its access off, or uninstall the app. Days already synced stay in `health_days`; delete them in Supabase (Table Editor → `health_days`) if you want them gone.

## Voice logging

With **Settings → Voice** on, the exercise in the workout gets a microphone: tap it and say the set, such as *10 at 45*, or *again*, *undo*, *done* or *skip* (the [user guide](user-guide.md#the-workout) has the rest). The app's web view has no speech recognition of its own, so the app's own plugin (`SpeechPlugin.kt`) uses Android's. It listens in English, the language it reads: the phone's own English (English (India), say) when the phone's languages include one, and otherwise US English. Settings shows the switch once the phone says it can turn speech into text, which needs a speech service such as Google's; most phones have one.

- **The microphone:** switching it on asks for Android's microphone permission. Refuse it and the switch stays off and says why; to allow it later, open Android's **Settings → Apps → Gym Log → Permissions → Microphone**, then switch it on again. Allowed *only this time*, it asks again when you next tap the microphone. The app listens only after you tap it, for one phrase, and stops if you leave the workout or the app.
- **On the phone:** on Android 12 and later, where the phone has on-device speech recognition for that English, what you say is turned into text on the phone itself. Otherwise the phone's speech service does it, with its offline model where it has one, or else on its servers (Google's, on most phones). Gym Log gets only the words, and keeps only the numbers.
- **To turn it off:** switch off **Log sets by voice**, and the microphones go. To take back the permission too, turn off **Microphone** on that same Android settings page.

## Home-screen widget

Touch and hold the home screen, tap **Widgets**, find **Gym Log** and drag it on. It shows today's plan: the session's name and how many lifts are done, **Skipped** once you skip it, or **Rest day** with none planned, and while a rest timer runs, when it ends. With room for it, two small buttons, **Log weight** and **Log steps**, sit under that. Tapping the session opens **Home**; the small buttons open **Train** at today with that field ready to type in, even when the app wasn't running.

It updates itself as you log a set, tick a lift or a new day begins, and settles to a plain **Open Gym Log** once the day it was showing has passed, so it never shows yesterday's session as today's.

## Rest timer

The rest timer started by logging a set keeps counting with the app in the background or closed: a quiet notification counts down, and when it reaches zero a second one says **Rest over**, with a sound and a buzz. While the timer runs, the home-screen widget adds when it ends (*rest until 10:32*).

- **Notifications:** Android 13 and later ask first. Tap **Allow** under **Settings → Rest timer & effort → Rest timer notifications**. If Android has stopped asking, turn notifications on for Gym Log in the phone's own settings. Older versions allow them when the app is installed.
- **On time:** the alert uses an exact alarm when the phone allows one (*Alarms & reminders* in the phone's settings for Gym Log, which Android 13 and later leave off by default). Without it, Android may deliver it a little late while the phone is idle. The countdown in the app is exact either way.
- **Notification channels** in the phone's settings let you silence each: *Rest timer running* for the countdown and *Workout under way* for the workout's clock (neither makes a sound), and *Rest over* for the alert.

## Lock screen and Samsung's Now Bar

With the app in the background or the phone locked, a workout under way stays in view. It shows the session, how many exercises are done, and its clock counting up. While a rest timer runs, it shows the countdown in the same place. Pausing the clock or finishing the workout takes it down. So does coming back to the app, which shows all of it itself. If a workout is left running, Android takes it down once it has run for three hours, the point at which the app counts it as left behind.

Both use Android 16's standard *Live Updates* (Google's API, not a Samsung one):

- **Android 16 phones such as Pixels:** they show as a chip in the status bar and at the top of the lock screen.
- **Samsung phones:** they're notifications with a running clock on the lock screen. One UI 8 puts other apps' Live
  Updates in the **Now Bar** only for apps Samsung has approved. To see Gym Log there on your own phone, turn on
  **Developer options → Live notifications for all apps** (tap **Build number** seven times, under **Settings → About
  phone → Software information**, to show Developer options).
- **Earlier versions:** they're ordinary notifications.

Samsung also has an API of its own for the Now Bar, *Live Notifications*, but it only works for apps on Samsung's
allowlist, so Gym Log doesn't use it. Live Updates need the same notification permission as the rest timer, and the
phone's own settings can turn them off for Gym Log, which leaves them ordinary notifications.

## Updates and the signing key

The app carries its own copy of the site, so changes to the site only reach it in a new APK. Every push to `main` builds one and publishes it as the **android-latest** release (GitHub → Actions → *Android app* shows each build; pull requests get an APK under the run's *Artifacts*), together with a `version.json` naming its version, commit and checksum, which is how the app in the next paragraph tells there's something new.

**From inside the app:** open **Settings → About → Check for updates**. Found one? **Download and install** fetches it, checks its SHA-256 against what CI published and that it's signed with Gym Log's own key, then hands it to Android's installer. It keeps going if you leave Settings, and coming back shows how far it's got. The first time, Android asks you to allow installs from Gym Log; allow it and the app tries installing again by itself as soon as you come back. The app also looks quietly, at most every 12 hours, and shows a small banner at the top when one's ready: its **Update** does the same download and install right there, saying how far it's got, with **Open settings** when Android wants that permission and **Try again** if the download fails. A build with no repository to check (one you built yourself without `GYMLOG_UPDATE_REPO`, below) shows no update controls at all.

The manual way still works too: on the phone, open the repo's **Releases** page in Chrome, download `gym-log.apk` from the latest release and open it. Either way, Android asks its one-time question only once and you stay signed in.

`android-latest` is replaced by each push. For a build that stays, push a tag: `git tag v1.2.0 && git push origin v1.2.0` builds the APK with that version name and publishes it as a permanent release for the tag; its notes name the commit and link to the build, whose summary shows the signing certificate's fingerprints. Use tags for the builds you want people to install, and `android-latest` for the newest.

An update only installs over the app if it's signed with the same key — Android refuses anything else, and from inside the app Gym Log's own check says so plainly before it even asks Android. The key is a `.p12` file kept outside the repo, and GitHub Actions gets it from two repository secrets (Settings → Secrets and variables → Actions): `GYMLOG_KEYSTORE_BASE64` (the file, base64-encoded) and `GYMLOG_KEYSTORE_PASSWORD`. Without them, builds are signed with a throwaway key and nothing is published. Keep a copy of the key and its password somewhere safe: if they're lost, make a new key, update the secrets, and uninstall the app before installing the next build (your data is in Supabase, so you only sign in again and reconnect Health Connect).

The build also reads the same `NEXT_PUBLIC_*` variables as the site, from repository variables on the same settings page (see `.env.example`), and `GYMLOG_UPDATE_REPO` (the workflow sets it to the repository itself, so a fork's app checks the fork's own releases, never this one). Without the `NEXT_PUBLIC_*` ones the workflow builds an APK that shows the setup screen, and refuses to publish it.

## Building it yourself

Needs JDK 21 and the Android SDK (Android Studio installs both), and a `.env.local` with your project (see `.env.example`).

```bash
npm run android                        # builds the site and copies it into android/
cd android && ./gradlew assembleDebug  # android/app/build/outputs/apk/debug/app-debug.apk
```

Or open `android/` in Android Studio and press Run with the phone plugged in. For a release build signed with your key, set `GYMLOG_KEYSTORE` (the `.p12` file's path), `GYMLOG_KEYSTORE_PASSWORD` and `GYMLOG_VERSION_CODE` (a number higher than the installed build's), then run `./gradlew assembleRelease`.

The Kotlin has its own tests: `./gradlew testReleaseUnitTest`. They include a check that `HealthDays.kt` turns Health Connect's readings into the same days as `src/lib/health.ts`, against `tests/fixtures/health-days.json`.

# Gym Log on the watch

A Wear OS app for the watch paired with the phone (built and tested for a Galaxy Watch4 Classic: round, 450×450,
a rotating bezel, Wear OS 3 to 6, so API 30 to 36). It does the workout from the wrist: today's session, each
lift's sets with the suggested weight and reps, the bezel to change them, Complete set, the rest countdown with a
buzz when it's over, the workout clock, and the heart rate through it; and a tile with the workout's clock and next
set. It keeps working away from the phone and catches up when the two are back in reach.

The phone stays the one place the data lives. The watch never talks to Supabase: it shows what the phone last sent
it, and sends back what was done on it, which the phone applies exactly as if it had been done on the phone.

## Build and install

- `android/wear` is its own Gradle module (`:wear`), a native Kotlin app with Compose for Wear OS. Its
  `applicationId` is the phone app's, `io.github.raja2102598.gymlog`, and CI signs both with the same key: Wear OS's
  Data Layer only connects an app to its twin with the same package name and signature.
- CI builds it next to the phone app and puts `gym-log-watch.apk` on the `android-latest` release (and on a tag's
  release), numbered as the phone's build is. Each CI run also keeps it as the `gym-log-watch-apk` artifact.
- The phone app has to be CI's too (`gym-log.apk` from the same releases): a phone app built and signed on your own
  computer has another key, and the watch never hears from it.
- It isn't on Google Play, so it's installed on the watch over Wi-Fi debugging, once to set up and then for each
  update:
  1. On the watch, Settings → About watch → Software information → tap Software version five times, until it says
     Developer mode is on.
  2. Settings → Developer options → ADB debugging on, then Wireless debugging (Debug over Wi-Fi on some versions)
     on. The watch has to be on the same Wi-Fi as the computer, or the phone: while it's connected to the phone by
     Bluetooth, a Galaxy Watch keeps its Wi-Fi off, so set Settings → Connections → Wi-Fi to Always on (or turn
     Bluetooth off for a minute).
  3. From a computer with Android's platform tools: Wireless debugging → Pair new device shows an address and a
     code; `adb pair <ip>:<pairing port>` and type the code (once per computer). Then `adb connect <ip>:<port>` with
     the port the Wireless debugging screen itself shows (not the pairing one), and `adb install -r
     gym-log-watch.apk`.
  4. From the phone alone, an app such as Bugjaeger or Wear Installer does the same pairing and install.
  5. An update installs the same way, over the one before (`adb install -r`): what the watch has kept stays.
  6. Open Gym Log on the watch once, and allow notifications when it asks (Wear OS 4 and later): "Rest over" and the
     workout on the watch face are notifications. The buzz itself doesn't need them. The first workout started on the
     watch asks for the heart rate (Body sensors, or Heart rate on Wear OS 6): allow it to have the workout's heart
     rate; refused, everything else works without it.
  7. For the tile, touch and hold a tile (or swipe past the last one), tap +, and pick Gym Log.
  8. Turn Wireless debugging (and Wi-Fi's Always on) off again afterwards: it costs battery.

## How the phone and the watch talk

Wear OS's Data Layer (`com.google.android.gms:play-services-wearable`, `Wearable.getDataClient`). Both directions
are data items rather than messages: a data item waits until the other side is in reach and survives either app
being closed or the phone and watch being apart, which a message doesn't. All payloads are UTF-8 JSON in the item's
`DataMap` under the key `json`, with a version `v` so either side can ignore a shape it doesn't know.

### Phone → watch: `/gymlog/state`

One item, replaced whenever what it holds changes (and at most every couple of seconds while typing). The phone app
builds it in JavaScript (`src/native/watch.ts`) from the store, with the same rules the phone's own screens use, so
the watch has nothing to work out for itself beyond moving through it:

```jsonc
{
  "v": 1,
  "sentAt": 1790000000000,          // epoch ms
  "signedIn": true,                 // false: the watch says to sign in on the phone, and shows nothing else
  "account": "0b6f2a4e-…",          // the account signed in (its Supabase user id), or null: see the commands' own
  "applied": ["c-…", "c-…"],        // ids of the watch's commands applied so far (the last 200)
  "run": {                          // the workout under way (lib/workout.ts's WorkoutRun), or null
    "day": "2026-09-29", "startedAt": 0, "pausedAt": null, "pausedMs": 0, "endedAt": null
  },
  "rest": {                         // store.rest, or null
    "day": "2026-09-29", "lift": "Leg Press", "endAt": 0, "pausedAt": null, "sec": 90,
    "startedAt": 0                  // epoch ms it was started: which rest this is (see the rest's commands, below).
                                    // Kept through pause, resume and +15s; null for a timer kept from before
  },
  "days": [                         // today first, then the next six days: the watch picks the one for its date,
                                    // unless a workout is under way for another day (see below)
    {
      "date": "2026-09-29",
      "title": "Legs",              // the session's name, or the free workout's
      "skipped": false,             // the day's workout skipped on purpose
      "cardio": "Cycling - 15-20 min", // the day's cardio, or null
      "cardioDone": false,
      "blocks": [                   // the workout's steps in order: one lift, or a superset's lifts
        [
          {
            "key": "Leg Press",     // the day's name for it (as planned): what commands name
            "name": "Leg Press",    // what it's done as (a swap's own name): what the watch shows
            "done": false, "skipped": false,
            "restSec": 90,          // its rest, as the phone would start it (a superset's lifts: the round's, the
                                    // longest of theirs not skipped, started once the round is complete)
            "inc": 2.5,             // the weight step on its equipment, kg: one bezel click
            "cue": "…",             // how to do it, when there's anything to say, else ""
            "rows": [               // one per working set the phone shows (never warm-ups)
              { "reps": 12, "kg": 100, "type": null, "sugReps": 12, "sugKg": 100 },
              { "reps": null, "kg": null, "type": null, "sugReps": 12, "sugKg": 100 }
            ]
          }
        ]
      ]
    }
  ]
}
```

`sugReps` and `sugKg` are what the phone's Complete set would log in an empty row (null for nothing to suggest): the
watch starts the bezel there. They're the numbers greyed in the phone's boxes: the last set logged before the row, reps
and weight, a drop set aside (it's lighter on purpose), or before any is logged, last time's set or the next weight
(`LiftModel.sugFor`, lib/lift.ts). Leg Press's set 1 done at 12 × 50 kg rather than the suggested 10 × 45: sets 2 and
3 suggest 12 × 50. The rows after one the watch logged itself follow it the same way.

`days` has one more day, first, when a workout is under way for a day that isn't among them: one started before
midnight, or opened on the phone for a day gone by, while its clock is running or paused (not finished or left
running for three hours). A paused one counts too, unlike on the phone's lock screen and widget: otherwise pausing at
00:10 would take the day away and the watch would jump to the next day's session mid-workout. The watch shows
`run.day`'s day while `run` has no `endedAt`, isn't left running for three hours (`pausedAt` null and three hours
counted: the phone's `STALE_RUN_MS`), and `days` has it, and otherwise the one for its date. The three hours are
for a state it has kept since the day before: a workout never finished yesterday doesn't hold the watch on
yesterday's session.

### Watch → phone: `/gymlog/cmd/<id>`

One item per thing done on the watch, `id` unique (e.g. `c-` and a random UUID), never reused, and made of letters,
digits and `.` `_` `:` `-` only, since it's part of the path (the phone deletes anything else unread). The phone
applies each once, in the order of `at`, adds its id to `applied`, then a few seconds later deletes the item. Until
its id comes back in `applied`, the watch shows its own command as done on top of the last state it had (so it keeps
working away from the phone); once it's there, the state already includes it.

```jsonc
{ "v": 1, "id": "c-…", "at": 1790000000000, "account": "0b6f2a4e-…", "type": "…", /* the type's own fields */ }
```

`account` is the state's `account` when the watch made the command: the account whose workout it was showing. The
phone applies a command only to that account, signed in: one made under another (the watch out of reach while the
phone signed out and into another account, say), or under none, is dropped, so one account's sets never land on
another's days. The watch drops its own too, once a state of another account comes: they're no longer shown as done,
nor sent again. A signed-out state keeps them, since the phone keeps them as well, for that account to sign in again.
An `hr` carries the account whose workout it was measured in, even when sent after the switch.

The account is the Supabase user id itself, rather than a hash of it: it isn't a secret (it opens nothing without the
account's own sign-in), the phone keeps it already, and it only goes between the account's own phone and watch, in the
app's own Data Layer items.

| `type` | fields | the phone does |
|---|---|---|
| `set` | `day`, `lift` (key), `set` (row index), `reps`, `kg` | Logs that working set as Complete set N does, weight then reps (`kg: null` takes the weight Complete set N would; `reps: null` clears it: the tick's undo). The rest it starts is the phone's own rule, counted from `at`, and started at `at` (its `startedAt`, as the watch gave it, so it's the rest the watch started itself); one for a set logged longer ago than its rest isn't started. |
| `startRun` | `day` | Starts the day's workout clock from `at`, or does nothing if it's running. |
| `pauseRun` / `resumeRun` | `day` | Pauses or resumes it, as of `at`. |
| `finish` | `day` | Finish: ends the clock (at `at`) and the day's rest, as the phone's Finish workout does. |
| `restSkip` | `day`, `lift`, `restStartedAt` | Skips the rest, if it's the one named (below). |
| `restAdd` | `day`, `lift`, `restStartedAt`, `sec` | Adds to the rest (+15 s), if it's the one named. |
| `restPause` / `restResume` | `day`, `lift`, `restStartedAt` | Pauses or resumes the rest, if it's the one named. |
| `skipLift` | `day`, `lift` | Skips the lift (no reason). |
| `cardioDone` | `day`, `done` | Ticks the day's cardio. |
| `hr` | `day`, `avg`, `max`, `samples` | Keeps the day's heart rate from the watch (bpm, the average and highest over `samples` readings), rounded, as the day's `hr` (`{ avg, max }`, on its log, so it syncs with the day) for Workout complete. Each is the day's whole so far, so it replaces the one before. One over no readings, or with an average above its highest or a highest over 250, is dropped. |

`at` is never taken as later than the phone's own clock (a rest's `startedAt` aside: it only names the rest).

The rest timer's buttons name the rest they were pressed for: the `day`, `lift` and `startedAt` (as `restStartedAt`)
of the rest the watch showed, the phone's or one the watch started itself for a set done on it (started at that
`set`'s `at`, as the phone starts it). The phone applies one only while that's still its rest, as it is when the
command arrives: the same `startedAt`, so paused, resumed or 15 s longer since, but not a newer rest started on the
phone meanwhile, by a set logged or said there, which a command delayed out of reach would otherwise skip or push
out. It drops the others. A rest with no `startedAt` (a timer the phone kept from before it had one), or a command
with none, is matched by its `day` and `lift` alone. The watch shows its own rest commands by the same rule, so a skip
of a rest the phone has since replaced isn't shown on the newer one.

The watch sends `hr` every five minutes during the workout (with new readings since the last), so little is lost if it's
reset or lost before the end, and at the end. A newer `hr` for a day replaces that day's older ones still waiting to
reach the Data Layer on the watch, so one sent again later never takes the phone back to less of the workout.

A command the phone can't apply (another account's, or one with none; a day or lift it doesn't have, a set past the rows
or of a skipped lift, a rest that's no longer the one it was for, a `type` or `v` it doesn't know) is dropped: its id
still goes into `applied`, so the watch stops showing it.

Commands are only ever applied by the phone app's JavaScript, where the store is. When the phone app isn't running,
the phone's listener service (`WatchListenerService`) keeps the commands that arrive and the app applies them the
next time it runs; the watch meanwhile shows them as done, as above.

## The watch app

`android/wear/src/main/java/io/github/raja2102598/gymlog/wear/`. The rules are plain Kotlin with JVM tests, as the
phone app's Kotlin is: reading the state and choosing the day (`StateLogic`), the steps, sets and words
(`StepLogic`), the commands and showing them as done (`OverlayLogic`), the clock and the rest (`TimerLogic`), and
the bezel (`BezelLogic`), the heart rate (`HeartLogic`) and the tile's words (`TileLogic`). The screens are Compose for
Wear OS, Material 3.

- **Today**: the session's title (or "Rest day"), the workout clock once started (a tap pauses it, another resumes
  it, as on the phone), Start (Continue once it's under way, Review once every lift is done), then each step with
  how far it's got ("2 of 4 sets", "Done", "Skipped"), and Finish workout while it's under way. Opening a step starts
  the clock, as opening the workout does on the phone. A skipped day says so and offers nothing to start: it's undone
  on the phone. With no state yet, or none for today: "Open Gym Log on your phone"; signed out: "Sign in on your
  phone"; a state from a newer phone app: "Update Gym Log on your watch".
- **A lift**: its name and "Set 3 of 4" (a superset's "A1 · round 2 of 3"), and two big numbers, weight and reps,
  starting at what's logged or else `sugKg` and `sugReps`. Tap one to pick it (weight is picked first); the bezel
  changes the picked one, weight by `inc` and reps by 1, never below 0, with a light tick of haptic per click (the
  one Wear OS's own lists give). Complete set N, at the bottom edge, logs it (with no reps to log, it picks the reps
  instead, as the phone puts the cursor there), buzzes lightly, and brings up the rest when it starts one. The step
  then moves on: a lift to its next set, a superset round by round, as the phone's Complete set does.
- **Sets**: tapping the lift's name lists every set of the step with its tick. A tick completes a set with what the
  lift screen would start at, and a done set's tick undoes it (`reps: null`); tapping a set opens it on the lift
  screen to change. Then Skip today for each lift (it asks first, since only the phone can undo it), Next, and
  Finish workout. Once a step's sets are all logged, the step itself shows this list with Next exercise (or Finish
  workout) first.
- **Rest**: a ring counting down from `endAt`, the time left (a tap pauses or resumes it, as the phone's ring does),
  +15s and Skip, then "Rest over" at zero. The rest also counts down beside the time at the top of every other
  screen.
- **Heart rate**: small, a heart and the beats a minute, beside "Set 3 of 4" on a lift and beside the rest's length on
  the rest, while the sensor has a reading from the last 30 seconds.
- **The cardio**: its name, which exercise it is, and Done; then Finish workout, or Not done yet.
- **Finish**: the workout's time, sets and kg lifted, and Finish workout; then "Workout complete".
- Round screens: the time curves along the top, the step's button hugs the bottom edge, nothing sits in the corners,
  and each list (Today, Sets) curves at the edge and scrolls with the bezel (ScalingLazyColumn). The lift screen's
  numbers and the rest's buttons size themselves to the screen, from a 42 mm watch to a 46 mm one.
- Swiping right, or the back button, goes back a screen, as everywhere on Wear OS.

### Heart rate

- **Health Services' exercise** (`androidx.health:health-services-client`'s `ExerciseClient`, `HeartMonitor.kt`): an
  exercise of weight training (`WEIGHTLIFTING`, or `STRENGTH_TRAINING` or `WORKOUT` where the watch has no such
  exercise), measuring heart rate only. Health Services keeps the sensor going with the screen off and while Gym Log
  is out of sight, and hands back what it read when the app runs again; that's why it's this rather than
  `MeasureClient`, which is simpler but only measures while the app is on screen, when a workout's watch is mostly
  dark between sets. The workout service (below) keeps the app running through the workout, and is of Android's
  health kind as well as special use once the permission is there, which Android asks of a service reading the
  body's sensors in the background.
- **When**: from the workout clock's start (the service starts with it, while the app is on screen) to Finish, on the
  watch or the phone, or the workout left running for three hours. A reading counts when it's in range (30 to 240)
  and taken while the clock ran: from its start, to its end, and not after it was paused; and once, since Health
  Services hands its last readings over again when the app sets its callback anew. The screens show the latest
  reading, paused or not.
- **Another app's workout** (Samsung Health's, say): Gym Log doesn't start its own, which would end that one, and goes
  without heart rate. After Android stopped Gym Log mid-workout, it picks up its own exercise again (Health Services
  ends one left five minutes with no app to hand it to).
- **Permission**: `BODY_SENSORS` up to Wear OS 5 (API 35), and `android.permission.health.READ_HEART_RATE` from Wear OS
  6 (API 36), which replaced it. Asked once, the first time a workout is started on the watch; refused, nothing is
  measured and everything else works. Settings → Apps → Gym Log → Permissions can allow it later.
- **Kept and sent**: each day's sum, count and highest (so the average and highest over every reading) in a file, a
  week of days, with the account whose workout it was (a workout that day under another account, after the phone
  signed into it, starts its own count). The day's `hr` goes to the phone five minutes after its first readings, then
  every five minutes with new ones, and at the end with whatever came since: at Finish, and again should Health
  Services' last readings arrive after.

### The tile

`GymTileService.kt`, with ProtoLayout's Material 3 (`androidx.wear.tiles`), its words from `TileLogic`:

- **During a workout**: its session, the rest counting down (then the workout's clock once it's over) or the workout's
  clock, and the next set: "Leg Press · Set 3 of 4 · 100 kg × 12", the rested lift's next set while it has one, else
  the first exercise not done, then the cardio. The time ticks on the watch's own (ProtoLayout's dynamic time), with
  nothing from the app. A paused clock or rest shows where it stopped.
- **Otherwise**: today's session, how far it's got ("5 exercises"), and Start; or a rest day, a skipped day, "Workout
  complete", or what to do on the phone, as the app says it.
- A tap opens the app where it was. The tile is asked for again with every change to what the watch has, every five
  minutes during a workout (for one left behind), and otherwise half an hour on, or just past midnight for the next
  day's session.

### What the watch keeps

The last `/gymlog/state` and the commands the phone hasn't applied yet are kept in two files in the app's own
storage, so the watch opens on the last workout from cold, away from the phone. The state arrives whether or not the
app is open (a `WearableListenerService` for `/gymlog/state`), and the app reads the Data Layer again each time it
comes to the front. A command is shown as done at once, kept, and put as its urgent data item; one that never
reached the Data Layer (the app killed that moment) is put again the next time the app opens. One the phone never
takes stops being shown after two days, and one made under another account than the state's, at once. A third file
keeps the heart rate's days.

### The rest's buzz, and the workout in the background

- The buzz is an exact alarm (`AlarmManager.setExactAndAllowWhileIdle`) at the rest's end, for whichever rest the
  watch has, the phone's or its own, so a rest started on the phone buzzes on the wrist too. Its receiver buzzes
  three long pulses, as an alarm (so with the screen off, and through Do Not Disturb unless alarms are off too), and
  posts "Rest over" with what's next ("Leg Press · Next: set 3 of 4") unless the app is on screen. It checks the
  rest is still the one due first: skipped, paused or pushed out by +15s since, it stays quiet. The alarm follows
  every change, from either side, and needs nothing running: it fires with the app closed.
- Exact alarms: `USE_EXACT_ALARM` from Wear OS 4 (API 33), granted on install. It's meant for alarm and timer apps,
  which a rest timer is, and Google Play's limit on it doesn't apply to an app that isn't on Play. On Wear OS 3 (API
  30 to 32), `SCHEDULE_EXACT_ALARM`, granted on install too.
- While the workout clock runs, a foreground service (of the special-use kind, and health too while it measures the
  heart rate) holds an Ongoing Activity: the workout's icon and clock, or the rest counting down, on the watch face and at the top of the
  app list, one tap from the app, and Gym Log's process alive through the workout, so it opens at once where it was.
  Android only lets an app start one while it's on screen, so it starts when the app opens with a workout under
  way, and stops itself once it's finished or left running for three hours. The buzz doesn't depend on it.
- The phone app's own notifications are turned off on the watch while the watch app is installed (Wear OS's
  bridging, `BridgingManager`), or "Rest over" would buzz twice, once from each. The phone's only other
  notifications are ongoing ones, which Wear OS never shows on the watch anyway.

## Later, in the same app

- Staying on screen, dimmed, while the watch is idle (ambient mode), for the rest's countdown at a glance.

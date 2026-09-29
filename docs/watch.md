# Gym Log on the watch

A Wear OS app for the watch paired with the phone (built and tested for a Galaxy Watch4 Classic: round, 450×450,
a rotating bezel, Wear OS 3 to 6, so API 30 to 36). It does the workout from the wrist: today's session, each
lift's sets with the suggested weight and reps, the bezel to change them, Complete set, the rest countdown with a
buzz when it's over, and the workout clock. It keeps working away from the phone and catches up when the two are
back in reach.

The phone stays the one place the data lives. The watch never talks to Supabase: it shows what the phone last sent
it, and sends back what was done on it, which the phone applies exactly as if it had been done on the phone.

## Build and install

- `android/wear` is its own Gradle module (`:wear`), a native Kotlin app with Compose for Wear OS. Its
  `applicationId` is the phone app's, `io.github.raja2102598.gymlog`, and CI signs both with the same key: Wear OS's
  Data Layer only connects an app to its twin with the same package name and signature.
- CI builds it next to the phone app and puts `gym-log-watch.apk` on the `android-latest` release.
- It isn't on Google Play, so it's installed on the watch over Wi-Fi debugging: on the watch, Settings → About
  watch → Software → tap Software version five times, then Settings → Developer options → ADB debugging and
  Wireless debugging on. From a computer: `adb pair <ip>:<port>` with the code the watch shows, `adb connect
  <ip>:<port>`, `adb install gym-log-watch.apk`. From the phone alone, an app such as Bugjaeger or Wear Installer
  does the same. An update is installed the same way, over the one before.

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
  "applied": ["c-…", "c-…"],        // ids of the watch's commands applied so far (the last 200)
  "run": {                          // the workout under way (lib/workout.ts's WorkoutRun), or null
    "day": "2026-09-29", "startedAt": 0, "pausedAt": null, "pausedMs": 0, "endedAt": null
  },
  "rest": {                         // store.rest, or null
    "day": "2026-09-29", "lift": "Leg Press", "endAt": 0, "pausedAt": null, "sec": 90
  },
  "days": [                         // today first, then the next six days: the watch picks the one for its date
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
            "restSec": 90,          // its rest, as the phone would start it
            "inc": 2.5,             // the weight step on its equipment, kg: one bezel click
            "cue": "…",             // how to do it, when there's anything to say
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

`sugReps` and `sugKg` are what the phone shows greyed in an empty row (its placeholder), and what its Complete set
would log: the watch starts the bezel there.

### Watch → phone: `/gymlog/cmd/<id>`

One item per thing done on the watch, `id` unique (e.g. `c-` and a random UUID), never reused. The phone applies
each once, in the order of `at`, adds its id to `applied`, then deletes the item. Until its id comes back in
`applied`, the watch shows its own command as done on top of the last state it had (so it keeps working away from the
phone); once it's there, the state already includes it.

```jsonc
{ "v": 1, "id": "c-…", "at": 1790000000000, "type": "…", /* the type's own fields */ }
```

| `type` | fields | the phone does |
|---|---|---|
| `set` | `day`, `lift` (key), `set` (row index), `reps`, `kg` | Logs that working set as Complete set N does, weight then reps (`reps: null` clears it: the tick's undo). The rest it starts is the phone's own rule; one for a set logged longer ago than its rest isn't started. |
| `startRun` | `day` | Starts the day's workout clock, or does nothing if it's running. |
| `pauseRun` / `resumeRun` | `day` | Pauses or resumes it. |
| `finish` | `day` | Finish: ends the clock and the day's rest, as the phone's Finish workout does. |
| `restSkip` | | Skips the rest. |
| `restAdd` | `sec` | Adds to the rest (+15 s). |
| `restPause` / `restResume` | | Pauses or resumes the rest. |
| `skipLift` | `day`, `lift` | Skips the lift (no reason). |
| `cardioDone` | `day`, `done` | Ticks the day's cardio. |

A command the phone can't apply (a day or lift it doesn't have, a set past the rows) is dropped: its id still goes
into `applied`, so the watch stops showing it.

Commands are only ever applied by the phone app's JavaScript, where the store is. When the phone app isn't running,
the phone's listener service (`WatchListenerService`) keeps the commands that arrive and the app applies them the
next time it runs; the watch meanwhile shows them as done, as above.

## The watch app

- **Today**: the session's title, the workout clock once started, and its steps with how far each has got. Start
  (or Continue) opens the first step not done. With no state yet, or none for today: "Open Gym Log on your phone".
- **A lift**: its name, set N of M, and two big numbers, weight and reps, starting at what's logged or else the
  suggestion. Tap one to pick it; the bezel changes the picked one (weight by `inc`, reps by 1), with a light tick
  of haptic per click. Complete set logs it and starts the rest. A done set's tick undoes it. Next lift and a
  superset's rounds follow the phone's order.
- **Rest**: a ring counting down from `endAt`, +15 s, Skip, and a strong buzz at zero, screen on or off (an exact
  alarm on the watch, and the workout kept alive in the background while it runs; see below).
- **Finish**: from the last step, as on the phone.
- It keeps the screen's round shape in mind: nothing important in the corners, lists that curve at the edge
  (ScalingLazyColumn), and the bezel scrolling any list (rotary input).

## Later, in the same app

- Heart rate during the workout (Health Services), its average and highest sent to the phone for Workout complete.
- A tile with the workout clock and the next set, and the workout on the watch face (Ongoing Activity).

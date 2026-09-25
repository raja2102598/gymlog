# Roadmap

Where Gym Log is going, in the order the work is planned. It comes from two independent reviews of the repo, checked against the code, and it is kept in step with the project's issue tracker.

What the app does well today, and keeps: fast plan-driven logging, injury-aware progression, deep Health Connect data, offline-first with your own database. The roadmap adds what people expect from a workout log without giving those up.

## Tier 1: trust and first run

The things that can lose data, and what a new person hits first. Small, one pull request each.

- **Complete backup and restore.** One versioned export with the plan, every logged day and the synced Health Connect days, and an import that restores all three. A workout CSV alongside it. Today's export holds only the daily logs.
- **Local-storage failures shown in the sync bar.** A save that fails on the phone (storage full or blocked) is silent today.
- **Sync conflict detection.** Two devices editing the same day, or the plan, currently overwrite each other; the tables' `updated_at` columns make detecting that cheap.
- **A generic privacy page**, with a note for self-hosters to name their own deployment.
- **Permanent, versioned APK releases** from tags, with `android-latest` kept as the moving build.
- **This roadmap.**
- **Neutral first run:** a blank plan and 3, 4 and 5-day templates instead of the author's own split.
- **A Vercel Deploy button**, and the Supabase integration's variable name accepted for the key.

## Tier 2: logging polish

What people expect while lifting. Builds on the model as it is.

- **Rename a lift with its history**, and store the target sets and reps with each logged lift. This settles the exercise model before the items below build on it.
- **Rest timer**, in the page first, then an Android notification while the app is in the background.
- **Set types** (warm-up, working, drop, failure) and optional RPE or RIR.
- **Supersets**, and reordering lifts within a session.
- **Free-form workout** on any day, alongside the planned one.
- **Plate calculator and warm-up calculator.**
- **Voice logging:** say a set ("10 at 45") and it's logged. On the website first, then in the Android app with on-device recognition.
- **Per-lift charts:** load, reps, estimated 1RM and volume over time, on a page for each lift.
- **Body measurements** beyond weight and waist.

## Tier 3: needs new pieces

Items that depend on something from outside the repo: a licensed dataset or native code.

- **Exercise library** with search, muscle and equipment tags, and custom exercises. Needs an exercise dataset with a licence that allows redistribution.
- **My gym:** the equipment your gym has, so the library and swaps offer lifts you can do. Depends on the library.
- **Weights per kind of equipment:** bar weights for the barbell, EZ bar, trap bar and Smith machine, and steps for dumbbells, kettlebells, machines and cables, so suggested weights are ones the equipment can make. Depends on the library.
- **Weekly sets per muscle group.** Depends on the library.
- **Progression options per lift:** linear, double, percentage, simple deload, always showing the rule.
- **In-app demo mode** with sample data, so people can try it without a database.
- **Android home-screen widgets.** Needs native code.

## Next: smooth on the phone

Reported from using the Android app after the redesign.

- **Smooth animations.** Movement isn't smooth on the phone. First measure it on a real, mid-range Android phone,
  with Chrome's remote DevTools (`chrome://inspect`) on the app's WebView and its Performance panel. Measure:
  - switching tabs;
  - opening Health, then a metric's page;
  - opening the workout, then Complete set and the rest ring.

  What the code points to so far:
  - **Settings' switches** slide their knob by `left` and `top`, which lays the page out again every frame. They
    should move with `transform`.
  - **Every screen fades and rises in** (`rise`, 200 ms) while React is still building it, charts and lists
    included, so the first frames are dropped. Start the fade once the screen has painted, or paint the screen's
    frame first and its charts just after.
  - **The activity rings** draw by animating `stroke-dasharray` for 0.9 s, under an SVG drop-shadow filter on each
    tip. **The bars** grow by `scaleY` on SVG rectangles for 0.6 s. In Android's WebView both are repainted on the
    CPU every frame, and Home and Health start several at once. Animate only what's on screen, drop the filter while
    drawing, or use shapes the GPU can move.
  - **Things that appear or change jump** instead of moving: a logged set, a lift moved in Train, the how-to
    opening, a Settings row unfolding. Give each a short `transform` and `opacity` transition, 120–200 ms, with the
    design's easing.

  Done when:
  - those interactions hold 60 fps on that phone, with the traces attached to the pull request;
  - nothing moves with Reduce motion on, as now.

## Later

New platforms, storage, external services or business decisions. These wait for feedback from other lifters.

- iOS app and HealthKit (needs Apple tooling and an account).
- Wear OS companion for set logging and the rest timer.
- Progress photos (needs a storage decision).
- Bring-your-own-key AI assistance.
- Interval and WOD timers.
- Sharing and coach features.
- A hosted version (a business decision, not code).

## How work happens

One issue per pull request. Unrelated issues can be worked in parallel. Every pull request runs lint, the type check, the unit tests, the build and the browser tests in CI, and a change to how a screen looks should refresh the screenshots with `npm run screenshots`. [CONTRIBUTING.md](../CONTRIBUTING.md) has the details.

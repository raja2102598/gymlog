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
- **Weekly sets per muscle group.** Depends on the library.
- **Progression options per lift:** linear, double, percentage, simple deload, always showing the rule.
- **In-app demo mode** with sample data, so people can try it without a database.
- **Android home-screen widgets.** Needs native code.

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

# Tests

Two kinds, each with one job:

- **Unit tests** (`tests/unit`, Vitest, no browser): the rules. What a set counts toward, the next weight, how a day
  syncs, what an import keeps, what a Health Connect read becomes. Every case of a rule goes here, because here it's
  fast and a failure names the rule.
- **Browser tests** (`tests/e2e`, Chromium against the built site, Supabase mocked by `harness.mjs`): the screens.
  That a rule's answer shows where it should, a tap does what it says, a page saves what's typed, and the app hangs
  together from one screen to the next. One case of a rule is enough here; the rest are the unit tests'.

`npm test` runs the unit tests. `npm run build`, then `npm run test:e2e`, runs the browser tests; name suites to run
only those (`npm run test:e2e -- health progress`), or `--changed` to run what the changes since `main` touch.

## Where a test goes

One file per page of the app, or per scenario that crosses pages. Before adding a test, find the file for its page or
scenario, and look there for a test of the same thing: extend that one rather than adding a second.

**Unit tests, by page:** `train` (the day log, missed and skipped days, records while typing), `progress` (Weight,
Strength, Muscles, a lift's page), `healthView` (the Health tab's numbers), `gym` (My gym's equipment and weights),
`plan` (the plan as saved, and Reset), `library`, `navigation` (addresses, Back, moving between screens).

**Unit tests, by scenario:** `rename` (renaming a lift and its history), `sync` (saving over the version a phone had),
`backup`, `auth` (signing in and out), `healthSync` (Health Connect from the Android app), `android` (the app
starting, the widget), `update`, `rest` (the rest timer), `workout` (its clock), `freeform`, `supersets`, `settypes`,
`progression` (the rules and the next weight), `templates` (and the first run), `demo`, `voice` and `speech`. And for
the library code underneath: `stats`, `format`, `health` (Health Connect's readings into days), `heart`, `videos`
(finding a lift's YouTube videos), `tokens`, `config`.

**Browser suites, by page:** `navigation`, `layout` (a small phone), `signin`, `firstrun`, `today` (Home, Train and the
workout in a day's training), `workout`, `library`, `gym`, `plan` (the plan editor), `health`, `progress`.

**Browser suites, by scenario:** `backup`, `sync` (two phones), `offline`, `demo`, `voice`, `rest`, `settypes`,
`supersets`, `freeform`.

A browser suite is split into sections, each a function opening its own browser context, so one section's state never
leaks into the next. The runner spreads suites over workers, and the longest one sets the pace: keep a suite under
about 25 seconds where the scenario allows (`voice`, at about 40, is the longest).

## No blind tests

A test is only worth having if it fails when the behaviour it names breaks. So:

- **See it fail.** Break the code it's about (flip the rule, drop the call, remove the element) and run it: it must
  fail, and say why. Then put the code back.
- **Test the real thing.** Build tests on the app's own objects (a `GymStore`, the real plan), not on a stand-in that
  does the work itself. A fake stands in for the outside world only: Supabase, Health Connect, the phone's plugins
  (`fakeSupabase.ts`, `nativeMocks.ts`).
- **Don't check an absence by a name nothing uses.** "No credit line" checked as `.howto-credit` count is 0 passes
  forever once the class is gone. Check what a person would see instead: the panel's text has no credit in it.
- **Wait for the change, then check it.** Use `until` (browser) or `vi.waitFor` (unit) for what's asynchronous, not a
  fixed pause that passes because the app happened to be slow.
- **Name it for what it checks, and give the browser check a detail** (the third argument to `check`), so a failure
  says what was there instead.

## Shared helpers

- `tests/unit/helpers.ts`: the day the tests are set on (Wednesday 23 September 2026, as the browser tests' clock),
  `day()`, `lift()`, `storeWith()`, `memoryStorage()`.
- `tests/unit/fakeSupabase.ts`: one account's tables in memory, answering as PostgREST does.
- `tests/unit/nativeMocks.ts` and `phone.ts`: the Android app's plugins, and a phone with Health Connect data.
- `tests/e2e/harness.mjs`: opening the app signed in with a `db`, the in-app question sheet (`answerAsk`, `lastAsked`),
  `onDefaultPlan()` for an account on the default plan, stand-ins for YouTube's search (`db.youtube`, what it's asked
  in `db.videoSearches`) and player, and the rest. The browser tests' build needs `NEXT_PUBLIC_YOUTUBE_API_KEY` set
  to anything (CI's is `youtube-key-example`), so its lifts offer **Watch a video**.

Reach for these before writing a helper of your own; add to them when a second file needs the same thing.

## What's not tested here

Cases that can't happen in the Android app (AGENTS.md, Review guidelines): signing out or into another account while a
question sheet is up, or another tab changing things. Don't add tests, or fixes, for them.

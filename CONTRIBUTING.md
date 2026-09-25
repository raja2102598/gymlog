# Contributing

Issues and pull requests are welcome.

## Before you start

- For anything bigger than a small fix, open an issue first and say what you have in mind, so the work isn't wasted if it doesn't fit.
- One change per pull request. Small ones are easier to review and get merged sooner.

## Setting up

The README's [Run it locally](README.md#run-it-locally) has the commands: `npm install`, then `npm run dev`. The app needs a Supabase project to talk to: copy `.env.example` to `.env.local` and fill it in with your own (a free project is enough; [Deploy your own](README.md#deploy-your-own) has the steps). The browser tests answer every request themselves, so for `npm run build && npm run test:e2e` any address in `.env.local` will do.

## Before you open a pull request

Run what CI runs:

```bash
npm run lint && npm run typecheck && npm test
npm run build && npm run test:e2e
```

The browser tests need Chromium once: `npx playwright-core install chromium`. They run in parallel, across a pool of workers that share that one Chromium; `npm run test:e2e -- --workers N` (or `E2E_WORKERS=N`) overrides how many, and each suite's own time (from your last run) decides the order, longest first.

Only touched part of the app? `npm run test:changed` runs the unit tests affected by what changed since `origin/main`, committed or not (`vitest run --changed origin/main`), and `npm run test:e2e -- --changed` does the same for the browser suites: a suite runs again if its own file changed, a file listed in its `covers` changed, or the change is broad enough (most of `src/`, `public/` or `tests/e2e/`, or a shared build file) that every suite needs to. To compare against something other than `origin/main`, pass a ref: `npx vitest run --changed HEAD~3`, or `npm run test:e2e -- --changed HEAD~3`. A suite lists a file in `covers` only when every suite that shows it lists it too, so shared code (the store, the plan, Today, Progress) runs every suite. It's a quick check before pushing: CI runs them all.

A change to the Android app should also pass `./gradlew testReleaseUnitTest assembleDebug` in `android/` ([Building it yourself](docs/android.md#building-it-yourself) has what that needs).

Pull requests from forks build the Android app signed with a throwaway key and don't publish anything. That's expected.

## Conventions

- TypeScript, checked by the ESLint config in the repo. New dependencies need a good reason: the site is kept on phones for offline use, so size matters.
- Tests go with the change: `tests/unit/` for the calculations and the store, `tests/e2e/` for the app in Chrome with Supabase mocked, and `android/app/src/test/` for the Kotlin. A change to how a screen looks is worth a fresh `npm run screenshots` for the README.
- Database changes go in `supabase/schema.sql`, kept safe to re-run, with row-level security on any new table.
- Text in the app is in sentence case and plain words, and never uses an em dash.

By contributing you agree that your contribution is licensed under the [MIT License](LICENSE).

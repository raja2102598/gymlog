# Contributing

Issues and pull requests are welcome.

## Before you start

- For anything bigger than a small fix, open an issue first and say what you have in mind, so the work isn't wasted if it doesn't fit.
- One change per pull request. Small ones are easier to review and get merged sooner.

## Setting up

The README's [Working on it](README.md#working-on-it) has the commands: `npm install`, then `npm run dev`. Without a `.env.local`, the development server talks to the live app's Supabase project. To use your own, copy `.env.example` to `.env.local` and fill it in; [Setting it up again from scratch](README.md#setting-it-up-again-from-scratch) has the steps.

## Before you open a pull request

Run what CI runs:

```bash
npm run lint && npm run typecheck && npm test
npm run build && npm run test:e2e
```

The browser tests need Chromium once: `npx playwright-core install chromium`. A change to the Android app should also pass `./gradlew testDebugUnitTest assembleDebug` in `android/` ([Building it yourself](README.md#building-it-yourself) has what that needs).

Pull requests from forks build the Android app signed with a throwaway key and don't publish anything. That's expected.

## Conventions

- TypeScript, checked by the ESLint config in the repo. New dependencies need a good reason: the site is kept on phones for offline use, so size matters.
- Tests go with the change: `tests/unit/` for the calculations and the store, `tests/e2e/` for the app in Chrome with Supabase mocked, and `android/app/src/test/` for the Kotlin.
- Database changes go in `supabase/schema.sql`, kept safe to re-run, with row-level security on any new table.
- Text in the app is in sentence case and plain words, and never uses an em dash.

By contributing you agree that your contribution is licensed under the [MIT License](LICENSE).

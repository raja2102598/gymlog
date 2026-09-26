<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Review guidelines

Gym Log runs as an Android app (Capacitor, one WebView). There is one window: no second tab, no second window, and
while a sheet or dialog is up (the in-app question sheet, `src/components/ds/Ask.tsx`, the exercise sheet, a picker)
nothing else in the app can be tapped. Judge every race or "what if" against that.

Don't raise, and don't fix, cases that can't happen in the app:

- the account signing out, or switching to another account, while a question sheet is up or its answer is pending
- another tab or window changing the store, the plan, a day or the session while a question is up
- two tabs or windows racing each other (saves, syncs, timers, sign-in)
- anything else that needs the user to act somewhere else in the app while a modal sheet covers it

These do happen on the phone, and are worth guarding:

- a sync bringing another phone's changes (a day, the plan) when the app comes back to the foreground, including
  while a sheet is up
- voice logging finishing while a sheet is up (the microphone keeps listening)
- the app going to the background and coming back, the phone going offline and online, Android killing the app
- Health Connect reads overlapping each other, or with the app's own timers

When a review raises one of the first kind: reply once on the thread that it can't happen in the Android app and why,
resolve it, and change no code.

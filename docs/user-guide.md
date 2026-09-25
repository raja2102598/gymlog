# User guide

Gym Log opens on today and works like a phone app: four tabs along the bottom, **Today**, **Health**, **Progress** and **Settings**. This page walks through each. For installing it, see the [README](../README.md#install-on-your-phone).

<p align="center">
  <img src="screenshots/signin-light.png" width="190" alt="The sign-in screen: Continue with Google, or an email link or a password">
  <img src="screenshots/today-light.png" width="190" alt="Today">
  <img src="screenshots/plan-light.png" width="190" alt="The plan editor">
</p>

## Signing in

**Continue with Google**, or your email. With email, tap the link in the email **on the same phone**, or, once you've set a password (**Settings → Set a password**), tap **Use a password instead**. A Google account with the same email as an account made with an email link is the same account, with the same data.

### First run

A new account starts by choosing a plan: a **Blank plan** (seven rest days to fill with your own sessions), **Full body, 3 days**, **Upper and lower, 4 days**, or the **Five-day split**. It's saved as your plan and synced, and everything in it can be changed later in **Settings → Edit plan**. Only the five-day split marks lifts as knee-sensitive; with the others, knee tracking stays off until you mark a lift in the plan. An account that already has logged days skips this step and keeps its plan.

Moving from another copy of Gym Log? Tap **Restore a backup** on that screen and choose a file exported there with **Settings → Export data**. Its days, plan and Health Connect days come in without asking first, since a new account has nothing of its own to replace, and the app opens **Settings → Your data**, which says what came in. A file with no days and no plan (or one that can't be read) leaves you on the plan choice, with a line saying why.

## Today

- The app opens on today. Tap a day in the week strip to look at or fill in another day. A day is green when every lift is done, pale green with a green edge when some are, and has an orange edge when a workout day was missed.
- **Warm-up:** tap **Warm-up** to show the list and tick what you did. It starts folded so the lifts come first, and rest days don't show it.
- **Lifts and sets:** each lift is a card.
  - Under its name you see the plan (e.g. 3 × 8-10) and what you did last time, set by set. An arrow shows when today's heaviest set is already heavier.
  - Each planned set has a row: enter reps and kg, and the next set copies the weight you just used. Grey numbers in empty boxes are suggestions: last time's numbers, or the next weight to try.
  - **Plates:** tap the stack icon next to a set's kg box for the plates to load on each side, using the bar and plates you set in Settings. It finds the closest loading to the weight with the fewest plates; if the weight can't be made exactly, it says what's left over; a weight under the bar says so instead of a breakdown.
  - A set's number turns green once its reps are logged, and logging the planned number of sets fills the round tick. Tap the tick to set it by hand.
  - **+ Set** adds a set and **− Set** removes the last one, asking first if it has numbers in it. **How to** opens the lift's form notes; warnings such as a KNEE NOTE always show.
  - **Warm-up sets:** tap **Warm-up sets**, type a working weight, and see 40, 60 and 80 percent of it with rep counts. **Log warm-up sets** logs all three with one tap. They're marked as warm-ups, so they never count toward the lift's planned sets, its tick, or a record. **Remove warm-up sets** takes them off again.
  - The bar under the day's title fills as lifts are done.
- **Voice:** switch on **Settings → Log sets by voice**, then tap the microphone on a lift and say the set: *10 at 45*, *twelve reps at forty kilos*, *45 kg for 8* or *22.5 for 10*. *10 reps* on its own keeps the weight of the set before. Say *again* to repeat the last set, *undo* to clear it, *done* to tick the lift or *skip* to skip it for today. A line under the sets says what it heard; anything it can't read for certain, such as a weight in pounds, changes nothing. It listens in English, the language it reads, whatever language the browser or phone is set to, and it stops when you leave Today or pick another day. On the website it uses the browser's speech recognition: in Chrome, what you say goes to Google to be turned into text. The [Android app](android.md#voice-logging) uses the phone's, on the phone itself where it can, and asks for the microphone when you switch it on.
- **Change a day's workout:** the picker under the day's title lets any day use another day's workout, e.g. do a missed Push on a rest day. Rest days list the sessions you missed earlier that week, with a button to do one. The weekly count still counts each planned session once.
- **Skip, swap or see its chart:** tap **···** on a lift. *Skip today* (with an optional reason, e.g. machine busy) or *Swap for another lift* to log a different exercise in its place; the same menu undoes either. *See chart* opens that lift's own page under Progress: its heaviest set, estimated 1RM, volume and sessions a week, over time.
- **Adding weight:** when every set of a lift reached the top of its rep range last time, the lift says *Go up to … kg* and the grey numbers switch to the new weight at the bottom of the range. Each lift adds 2.5 kg unless you set its own step in the plan.
- **Records:** a set that beats every earlier session of that lift (heaviest weight, best estimated 1RM, or most reps at that weight or more) gets a **PR** badge as you type it.
- **Knee:** on days with knee-sensitive lifts, tap your knee pain from 0 to 10 before and after the session, and on waking the next morning. Once scored, the scale folds to one line; **Change** opens it again. If pain goes above your limit (5 unless you change it), or hasn't settled by the morning, knee-sensitive lifts say *Hold … kg* instead of going up next time.
- **Cardio and waist:** under the cardio finisher, log minutes, speed and incline (entering minutes ticks the finisher). The waist field sits next to body weight; once a week is enough.
- **Measurements:** a card below logs chest, arms, thighs, hips (cm) and body fat (%); once a week is enough, like waist. A value that isn't a number, or is outside a plausible range, is refused with a message naming the range. Their trends and the change over four weeks show in Health → Body.
- **Health Connect on Today:** in the [Android app](android.md), steps and body weight from Health Connect show in grey in their boxes until you type your own, and a card under them shows the night's sleep, resting heart rate, active calories and any workouts other apps recorded, with **More in Health** to open the Health tab at that day. The website shows the same numbers once the app has synced them.
- **Home-screen shortcuts:** once installed, long-press the app icon for *Today*, *Log weight* or *Log steps*.

## Health

The day's activity as three rings (steps, exercise minutes and active calories against your goals), then a tile for each kind of data: sleep with its stages, heart, calories burned and eaten, body (weight, body fat, BMI, and chest, arms, thighs and hips when you've logged them), water and exercise. ‹ › moves between days.

Tap a ring or a tile for its page: the day in detail (steps by the hour, the night's stages and times, heart rate range and vitals, workouts, the measurements card's fields), or a week or a month as a chart with your goal and average, and the numbers that matter (average, days at the goal, average bedtime, change in weight). Body also gets a trend and the change over four weeks for each measurement you log. Tap a bar or a point, or use the arrow keys, to read its value.

Logging chest, arms, thighs, hips or body fat on Today is enough to open Health here, even before Health Connect has synced anything; the other tiles just show no data yet.

The data comes from Health Connect through the [Android app](android.md). The website shows it too, once the app has synced it.

## Progress

Weight trend and weekly rate, with a goal date and your pace against the target once you set them in the plan; sessions kept, full weeks in a row and a calendar; steps by week; strength (estimated 1RM of every lift, each with a sparkline, lifts ready for more weight, recent records); knee scores by session. Notes at the top point out anything that needs attention, such as no weigh-in for a while, short sleep, or a resting heart rate higher than last week.

Tap a lift in Strength, or **See chart** in its **···** menu on Today, for its own page: heaviest set (with its reps), estimated 1RM, total volume and sessions a week, charted over time the same way as a Health metric, with the days the plan has it on and its rep range. A lift on two days of the plan is one row in Strength, naming both.

### How the numbers work

- **Weight trend:** one value a day from your weigh-ins, with gaps filled by straight lines, smoothed with Holt's method as [TrendWeight](https://github.com/ervwalter/trendweight) does. It starts from a straight-line fit of your first two weeks, so it doesn't lag behind at the start.
- **Weekly rate:** a straight-line fit of your weigh-ins over the last four weeks. It shows once you have six weigh-ins spread over two weeks; before that, water weight hides the real change.
- **Estimated 1RM:** Brzycki's formula, only from sets of 12 reps or fewer.
- **Sessions a week**, on a lift's own page: its sessions so far divided by the weeks since the first one, shown once at least a week has passed.

## Settings

- **Edit plan:** change session names, lifts, sets/reps, cues, cardio, warm-ups, the step goal and tempo. Each lift can have its own weight step and be marked knee-sensitive; the plan also holds your goal weight, target loss a week (% of body weight) and knee pain limit. Changes save as you type and sync to your other devices. *Start from a template* swaps in the sessions, lifts, warm-ups and tempo of one of the first-run plans and keeps your goals; *Reset to the default plan* brings back the five-day split the app ships with, goals included.
- **Bar and plates:** the bar weight and the plates your gym has, for the plates button on a set and for warm-up sets. Defaults to a 20 kg bar and plates of 25, 20, 15, 10, 5, 2.5 and 1.25 kg; list your own plates separated by commas. Synced with the rest of your plan, since a bar and plates belong to your gym, not to one phone.
- **Daily goals:** steps, sleep, exercise minutes, active calories, water. The Health tab's rings and charts use them.
- **Theme:** the phone's, or always light or dark.
- **Password:** sign in without waiting for an email. Once the account has a password, it offers **Change password** instead.
- **Export data** downloads a backup of your account as one JSON file: every day you've logged, your plan and the Health Connect days the Android app has synced. A backup made while you're on the default plan brings the default plan back when it's imported. **Import data** restores a file like that, or an older export that holds only the days. It asks before replacing days you've already logged or a plan that's different from yours, and if you say no, nothing changes. Health Connect days are restored to your database, filling in the days it doesn't have and leaving the ones it has as they are. That needs a connection: offline, the app says the Health Connect days couldn't be saved, and you can import the file again once you're back online.
- **Export workouts as CSV** downloads every set you've logged, a row each, to open in a spreadsheet. The columns are `day`, `session` (the day's workout), `lift` (its name in the plan), `set` (warm-ups are numbered apart, so set 1 is the first working set, as on Today), `reps`, `kg`, `warmup` (`true` for a warm-up set, which doesn't count as a working set), `skipped` (`true` or `false`), `swapped_for` (the lift you did instead, after a swap) and `note` (the day's note). Days without sets have no rows. Text that starts with `=`, `+`, `-` or `@`, such as a note like *+1 rep next week*, gets a `'` in front, so a spreadsheet shows it as text rather than treating it as a formula.
- In the Android app, Settings also holds **Health Connect** and **Sync in the background**; see [Android app and Health Connect](android.md).

## Moving around

The tabs along the bottom switch screens; pages under a tab (a Health chart, a lift's own page, the plan editor) have a back arrow. The phone's Back button walks back the way you came: a page to its tab, a tab to Today. Each screen has an address, so `/#progress`, `/#health/sleep` or `/#settings` open it directly, and so does a lift's own page.

## Saving and syncing

Changes save automatically. With poor gym signal they're kept on the phone and sync when you're back online. If a save fails, or you're offline with days waiting, a bar at the top says how many days haven't synced yet, with **Retry now**. The app asks the browser to keep its storage, so edits waiting to sync aren't cleared to free space.

The installed app loads its files from the phone's cache first, so it opens straight away even on weak signal. New versions download in the background and run from the next launch.

## Updates

- **On the website**, a new version downloads in the background as you use the site and runs from the next visit; if it finishes while a tab is still open, that tab shows **Gym Log was updated** with **Reload**. **Settings → About → Check for updates** asks right away instead of waiting for that.
- **In the Android app**, updates come as a new APK. **Settings → About → Check for updates** downloads and installs one from inside the app — see the [Android app](android.md#updates-and-the-signing-key) for how it's verified — and the app also checks quietly every so often, with a small banner when one's ready.

## Good to know

- Supabase's built-in email service sends only a few sign-in emails an hour for the whole project (about 2). If you hit the limit, the sign-in screen says so: wait an hour, or sign in with your password. The Send button also waits a minute after each link, since a new link replaces the last one.
- Your history follows each lift by name, including on its own page under Progress. Renaming a lift in the plan starts a fresh history for it; days you've already logged keep what you logged.
- Supabase's free plan pauses a project after about a week with no activity. Logging every day keeps it awake. If it does pause, click **Restore** in the Supabase dashboard; no data is lost.

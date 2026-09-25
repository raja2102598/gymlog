# Redesign: old screens → new boards

The redesign follows the Gym Log design system (tokens, components, README) and the approved dark boards. This is
the map from what the app had to what it becomes. Data, routes that still make sense, and every behaviour stay;
structure changes where the boards say so.

## Navigation

| Before | After |
|---|---|
| Tabs: Today · Health · Progress · Settings (Phosphor icons, green pill) | Tabs: **Home · Train · Progress · Health** (Lucide house, dumbbell, chart-column, heart; 84px, brand-tint pill) |
| Settings was a tab | Settings is a pushed screen, opened from the avatar at the top right of every tab (`#settings`, back chevron to that tab, no tabs) |
| Today (`./`) did everything for the selected day | Split into **Home** (`./`, today at a glance), **Train** (`#train`, the selected day's session and day log) and **Active workout** (`#workout`, one exercise at a time) → **Workout complete** (`#workout/done`) |
| Plan editor `#plan`, My gym `#gym` under Settings | Same addresses; opened from Train (Change plan, My gym tile) or Settings; back goes where they were opened from |
| Health `#health`, metric pages `#health/<metric>` | Same addresses, rebuilt |
| Progress `#progress`, lift pages `#progress/lift/<name>` | Same addresses; Progress gains Overview / Strength / Body / Muscles sections |

## Screens

| Old screen / component | New board | Notes |
|---|---|---|
| `shell/LoginView` | 01 Sign in | Logo mark, wordmark, bottom sheet: Google (outline), Continue with email (primary, opens the email form), Try it with sample data |
| `today/TodayView` (week strip, session header, rings from Health) | 02 Home | Greeting, WeekStrip, Today's workout card (knee note / PainScale, Start workout, View lifts), Daily activity rings, Water/Weight quick-add, Today timeline |
| `today/SessionCard` (session picker, free workout, catch-up, warm-ups, lift list, cardio, day fields, measurements) | 03 Train | Day chips, session card with lift rows (drag handle reorders), Start, Add exercise, Library + My gym tiles; the day log (knee, warm-ups, weight, steps, notes, measurements) sits under it |
| `today/LiftItem`, `SupersetItem`, `SetMenu`, `PlateCalc`, `WarmupCalc` | 04 Active workout | Same logic (liftModel); one block at a time, SetRow grid (Set · Last · kg · Reps · check), rest timer card, Complete set N, Next |
| — (new) | 05 Workout complete | Duration, kg lifted, sets, personal bests, knee-after PainScale, ring summary, Share, Done |
| `today/KneeScale` | PainScale | 11-cell one-tap scale; used on Home (before, on waking), Complete (after) and Train |
| `today/WeekStats`, `WeightLine`, `History`, `HealthToday` | folded into Home, Progress and Health | Week totals → Progress stats; weight line → Progress; history → Progress Overview "Recent days"; Health Connect day → Home timeline |
| `health/HealthView` | 06 Health | Header with sync time, Daily activity (136px rings, day switch), 2-column MetricTiles with mini charts, water −/+, insight |
| `health/HealthDetail` + `Bars` + `Trend` | 07 Steps detail (pattern for all metrics) | SegmentedControl Day/Week/Month/Year, StepsBarChart (capsules, dashed goal pill, scrub bubble), 3-up stats, insight |
| `dashboard/DashboardView` + cards | 08 Progress | Overview (stats, WeightTrendChart, consistency grid, pinned lifts, steps), Strength, Body (weight goal and pace, knee), Muscles |
| `library/LibraryPicker` | 09 Exercise library | Full-screen: back, search pill, chips (My gym + muscles), rows with 44px add/added buttons |
| `settings/SettingsView` | 10 Settings | Profile card, grouped rows (Training, Health, App & data) that open in place, Sign out |
| `shell/AppBar`, `TabBar` | Screen headers, TabBar | Tab screens: eyebrow + title-lg; pushed screens: 44px back chevron + title-md |
| App icon (dumbbell PNGs) | 00 Logo | Angled dumbbell mark for icon, splash and sign-in |

## Shared components (src/components/ds)

Button, TabBar, WeekStrip, MetricTile, ActivityRings, StepsBarChart, WeightTrendChart, SetRow, PainScale,
SegmentedControl, InsightCallout, ListRow, Chip, plus Icon (Lucide at 2px).

## Tokens

`src/design/tokens.json` is the design system's token file, dark first. `npm run tokens` writes
`src/styles/tokens.css` from it (both themes). Nothing else holds a colour value.

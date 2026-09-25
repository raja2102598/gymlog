# The exercise library

The library is 657 lifts, each with the muscles it works and the equipment it needs. The plan editor adds lifts
from it, a swap on Today picks one from it, and a free-form workout adds lifts from it (see the
[user guide](user-guide.md)). It lives in `src/data/exercises.json`, and `src/lib/library.ts` reads and
searches it.

## Where it comes from

The lifts come from [free-exercise-db](https://github.com/yuhonas/free-exercise-db) by yuhonas, at commit
`a859101d633a01c4a1a920d6a8ce41dabba0705f` (its `dist/exercises.json`). That project restructured
[exercises.json](https://github.com/wrkout/exercises.json) by Ollie Jennings. Both are released into the
public domain under the Unlicense, whose text is at the end of this page. They need no credit, but they get one
here and in the README all the same.

Only the lifts in the `strength`, `powerlifting` and `olympic weightlifting` categories are kept; stretches,
cardio, plyometrics and strongman are left out. So are the instructions and the images: each lift keeps its id,
name, muscles and equipment.

## What each lift holds

`src/data/exercises.json` names its `source`, `commit` and `licence`, then lists `exercises`, one lift a line,
A to Z:

| Key | What it is |
| --- | --- |
| `id` | free-exercise-db's id, such as `Leg_Extensions`. A plan lift points at it (`PlanExercise.lib`). |
| `n` | The name, such as *Leg Extensions*. |
| `e` | The equipment, in the app's own words (below). None means bodyweight only. |
| `p` | The main muscles, such as `quadriceps`. Every lift has at least one. |
| `s` | The other muscles it works, leaving out the main ones. |
| `c` | Its place among the lifts most people know, 1 first; only those have one. They come first in the list and win when a name matches two lifts equally well. |

The muscles are free-exercise-db's 17. The app shows them in its own words: *Quads* for `quadriceps`,
*Abs* for `abdominals`.

## Equipment

free-exercise-db gives each lift one piece of equipment. The app uses its own list (`EQUIPMENT` in
`src/lib/library.ts`), the one My gym switches on and off: it maps free-exercise-db's equipment and adds what a
lift's name says it needs. A lift is offered when My gym has everything it needs.

| free-exercise-db | The app |
| --- | --- |
| `barbell` | `barbell` |
| `e-z curl bar` | `ezbar` |
| `dumbbell` | `dumbbell` |
| `kettlebells` | `kettlebell` |
| `bands` | `band` |
| `cable` | `cable` |
| `machine` | `machine` |
| `medicine ball` | `medball` |
| `exercise ball` | `ball` |
| `foam roll` | `foamroll` |
| `other` | `other` |
| `body only`, none | nothing: bodyweight |

From the name:

- *Smith* makes it `smith` in place of a barbell, machine or other.
- *Trap bar* and *EZ bar* (or *EZ curl*) make it `trapbar` or `ezbar` in place of a barbell or other.
- *Pull-up*, *chin-up* or *hanging* makes it `pullupbar` in place of other, unless it's done on a cable, a
  machine or with a band.
- *Dip* makes it `dipbars` in place of other, unless it's a bench dip, a dip squat or on a machine.
- A free weight with *bench*, *incline*, *decline*, *preacher*, *hip thrust*, *lying*, *prone* or *seated* in
  its name adds `bench`, as does *bench* in the name of a lift with no machine, cable or Smith machine.
- A barbell squat, bench press, military, shoulder or overhead press, good morning, or a lift done from pins or
  a rack adds `rack`.

### What a lift is loaded with

A lift's equipment also says what its weight is loaded with (`loadOf` in `src/lib/library.ts`), for its bar and
how it goes up (My gym's weights): the first of a Smith machine, trap bar, EZ bar, barbell, dumbbells,
kettlebell, cable, machine or band it needs, or bodyweight when it needs none of them (a medicine ball or a sled
counts as bodyweight too). A lift of your own with no muscles yet, and one the library doesn't know, aren't known:
they keep the barbell's plates and a 2.5 kg step, as every lift did before, with nothing rounded. A plan lift can
say otherwise (`PlanExercise.load`, **Loaded with** in the plan editor).

- A bar (barbell, EZ bar, trap bar, Smith machine) takes the gym's plates: its plates button and warm-up sets use
  its weight, and it goes up by a pair of the smallest plate, from the bar.
- A machine's plates go on no bar; it goes up by the machines' step.
- Dumbbells, kettlebells, cables and bands take no plates, and go up by their own step, from nothing.
- Bodyweight takes no plates, and nothing is rounded.

A suggested weight rounds to what the lift's equipment makes: *Go up to* up, a deload down, and a percentage of a
1RM and warm-up sets to the nearest. A lift with a step of its own goes up by exactly that, with nothing rounded.

## Updating it

1. Get free-exercise-db at the commit you want:
   `git clone https://github.com/yuhonas/free-exercise-db`, then note `git rev-parse HEAD`.
2. Build the library from it:

   ```bash
   node scripts/build-exercises.mjs path/to/free-exercise-db/dist/exercises.json <that 40-character commit>
   ```

   It fails, naming them, if a lift on its list of common lifts is no longer in the data.
3. Read `git diff src/data/exercises.json`: one lift a line keeps it short. Then run `npm test`. The unit tests
   check that every library link in the default plan and the templates (`"lib"` in `src/data/plan.json` and
   `src/data/templates/`) is still a lift, and that each lift has a main muscle and only known equipment.
4. Update the commit named above.

A plan lift pointing at an id that's no longer there keeps working. The app finds it by its name, as it did
before the library.

## How plan lifts use it

A lift is still identified by its name ([exercise-model.md](exercise-model.md)). A plan lift can point at a
library lift with `lib`, the library's id, which gives it muscles and equipment under its own name. A lift of
your own (`Plan.custom`) is found by its name. A plan saved before the library is asked about once, a lift at a
time, in the plan editor.

## The Unlicense

```
This is free and unencumbered software released into the public domain.

Anyone is free to copy, modify, publish, use, compile, sell, or
distribute this software, either in source code form or as a compiled
binary, for any purpose, commercial or non-commercial, and by any
means.

In jurisdictions that recognize copyright laws, the author or authors
of this software dedicate any and all copyright interest in the
software to the public domain. We make this dedication for the benefit
of the public at large and to the detriment of our heirs and
successors. We intend this dedication to be an overt act of
relinquishment in perpetuity of all present and future rights to this
software under copyright law.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS BE LIABLE FOR ANY CLAIM, DAMAGES OR
OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE,
ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
OTHER DEALINGS IN THE SOFTWARE.

For more information, please refer to <https://unlicense.org>
```

# How lifts are identified

A lift is identified by its **name**. The plan names each lift, and a logged day keeps each lift under that
same name (`DayLog.exercises["Leg Press"]`). Everything that reads history (last time's numbers, the next
weight, records, a lift's own page, the CSV) finds a lift by name.

This was chosen over stable exercise IDs because names are what people type and read, and IDs would mean
rewriting every logged day for little gain today. What names cost is handled where it shows:

- **Renaming.** Renaming a lift in the plan editor offers to carry its history over. Every logged day's key,
  and any swap naming the old lift, are rewritten and synced like any other edit, and other plan days using
  the same name move with it, so a lift kept on two days keeps one history. It runs only once every logged day
  has just loaded, so a day another device logged, not yet on this one, can't be left under the old name. A name that already has its own
  history is refused, so two histories are never merged by accident.
- **Targets.** Each logged lift stores the sets and reps the plan asked for that day (`LiftLog.target`), so an
  old session still reads against what it was asked, after the plan changes. Entries logged before this, and
  extras added outside the plan, have none and read today's plan.
- **Set types.** A set's `type` says what kind of set it is. Unset means a working set, so every day logged
  before types existed reads as it always did.
- **Order and supersets.** A day whose lifts were moved keeps the order they were done in as a list of names
  (`DayLog.order`), which a rename rewrites too; a day without one follows the plan. A superset is a flag on
  a plan lift (`superset`: done with the lift before it), so it belongs to the plan's place for a lift, not
  to its name.
- **The exercise library.** A plan lift can point at a library lift (`PlanExercise.lib`, the library's id),
  which gives it muscles and equipment while it keeps its own name: *Hamstring Curl* can be *Lying Leg Curls*.
  Every plan lift of that name points the same way, as they share one history. A lift of your own
  (`Plan.custom`) is found by its name. A lift named exactly as a library lift needs no link, and one neither
  knows is simply untagged. Logged days never hold the link, so pointing a lift elsewhere changes nothing in
  its history. A plan lift can also say what it's loaded with (`PlanExercise.load`), for its bar and step, when
  that isn't what the library's equipment says. See [exercise-library.md](exercise-library.md).

**Later.** If two lifts with one name ever need telling apart, or a lift needs following across languages, a
stable ID can be added to each plan lift and logged entry then, with names kept as the display text. The
library's ids are a start: a plan lift pointing at one already says which lift it is.

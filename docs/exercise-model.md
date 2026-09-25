# How lifts are identified

A lift is identified by its **name**. The plan names each lift, and a logged day keeps each lift under that
same name (`DayLog.exercises["Leg Press"]`). Everything that reads history (last time's numbers, the next
weight, records, a lift's own page, the CSV) finds a lift by name.

This was chosen over stable exercise IDs because names are what people type and read, and IDs would mean
rewriting every logged day for little gain today. What names cost is handled where it shows:

- **Renaming.** Renaming a lift in the plan editor offers to carry its history over. Every logged day's key,
  and any swap naming the old lift, are rewritten and synced like any other edit, and other plan days using
  the same name move with it, so a lift kept on two days keeps one history. A name that already has its own
  history is refused, so two histories are never merged by accident.
- **Targets.** Each logged lift stores the sets and reps the plan asked for that day (`LiftLog.target`), so an
  old session still reads against what it was asked, after the plan changes. Entries logged before this, and
  extras added outside the plan, have none and read today's plan.
- **Set types.** A set's `type` says what kind of set it is. Unset means a working set, so every day logged
  before types existed reads as it always did.

**Later.** If the exercise library needs to tell apart two lifts with one name, or to follow a lift across
languages, a stable ID can be added to each plan lift and logged entry then, with names kept as the display
text.

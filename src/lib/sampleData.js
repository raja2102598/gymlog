/* Four weeks of plan-driven workout history and three weeks of Health Connect data, ending on a given day. Shared
 * by the in-app demo (lib/store.ts, GymStore.startDemo) and scripts/screenshots.mjs, so there's one generator
 * instead of two.
 *
 * Plain JavaScript, not TypeScript: scripts/screenshots.mjs runs under plain Node, which has no loader for .ts, so
 * this file can't import anything from lib/ (that would pull in TypeScript transitively). Its types are declared by
 * hand in sampleData.d.ts, next to this file, so lib/store.ts still gets full type-checking on the way in and out. */

const pad = (n) => String(n).padStart(2, "0");
const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
function addDays(key, n) {
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + n);
  return keyOf(dt);
}
/** 0 = Monday, as in lib/dates.ts's wdIndex, so a plan's `days` (Monday first) lines up with the calendar. */
const wdIndex = (key) => {
  const [y, m, d] = key.split("-").map(Number);
  return (new Date(y, m - 1, d).getDay() + 6) % 7;
};

/** "8-10" -> [8, 10], "12" -> [12, 12], anything unreadable -> [8, 10] (as good a guess as any). */
function repRange(s) {
  const n = String(s ?? "").match(/\d+/g);
  if (!n) return [8, 10];
  const lo = +n[0], hi = +(n[1] ?? n[0]);
  return lo > 0 && hi >= lo ? [lo, hi] : [8, 10];
}

/** Same rule as lib/plan.ts's normalizePlan: a real `knee` boolean if there is one, else a KNEE NOTE in `flag`.
 *  planDays can be a normalized Plan's days (the demo, already booleans) or plan.json's own raw days (the
 *  screenshots script, flag text only), so this checks both instead of assuming which one it was given. */
const isKnee = (x) => (typeof x.knee === "boolean" ? x.knee : /knee/i.test(String(x.flag ?? "")));

/** A stable, plausible starting weight for a lift: heavier for low rep ranges, lighter for high ones, and varied
 *  by name so a plan's lifts don't all start at the same number. Rounded to how gyms load plates. */
function startWeight(name, repsTop) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  const base = 15 + (hash % 8) * 5; // 15..50, in steps of 5
  const scaled = repsTop <= 8 ? base * 1.3 : repsTop >= 14 ? base * 0.6 : base;
  return Math.round(scaled / 2.5) * 2.5;
}

/**
 * Four weeks of history ending on `today` (inclusive) from `planDays` (a Plan's `days`: seven entries, Monday
 * first, each with an `exercises` list, as the app's own plan or a template has), and three weeks of Health
 * Connect data over the same stretch. Weights climb 2.5 kg a week; a couple of sessions are missed; a
 * knee-sensitive session (whichever the plan flags) comes up sore shortly before today, so knee tracking and
 * "hold this weight" have something to show. Today itself is left partway through: its last lift has one set
 * logged, not ticked done, so the app looks like a session in progress rather than a finished week.
 */
export function sampleDays(today, planDays) {
  const logs = {}, health = {};
  for (let n = -27; n <= 0; n++) {
    const day = addDays(today, n), plan = planDays[wdIndex(day)];
    const age = n + 27, week = Math.floor(age / 7), isToday = n === 0;
    const e = { exercises: {}, warmup: [], cardio: false, steps: null, weight: null, note: "" };
    // Today's steps and weight are left blank, as if only Health Connect had reported them so far.
    if (!isToday && age % 3 !== 2) e.weight = Math.round((84.2 - 0.12 * age + (((age * 7) % 5) - 2) * 0.12) * 10) / 10;
    if (!isToday && age % 4 === 1) e.steps = 7000 + ((age * 1379) % 5000);
    const rest = plan.exercises.length === 0, missed = !rest && (age === 16 || age === 23);
    if (!rest && !missed) {
      plan.exercises.forEach((x, i) => {
        const [, top] = repRange(x.reps), kg = startWeight(x.name, top) + 2.5 * week;
        // Today's last lift: one set in, not yet ticked done.
        const last = isToday && i === plan.exercises.length - 1;
        e.exercises[x.name] = last
          ? { done: false, kg, sets: [{ reps: top, kg }] }
          : { done: true, kg, sets: [{ reps: top, kg }, { reps: top, kg }, { reps: top - 1, kg }] };
      });
      e.warmup = ["Treadmill walk 5 min", "Leg swings", "Light warm-up sets"];
      e.cardio = !isToday && age % 6 !== 3;
      if (e.cardio) Object.assign(e, { cardioMin: 12, cardioKmh: 5.5, cardioIncline: 6 });
      if (plan.exercises.some(isKnee)) Object.assign(e, { kneeBefore: 1 + (week % 2), kneeAfter: 2 + (week % 2) });
    }
    logs[day] = e;

    // Health Connect: the last three weeks, as if the phone had been syncing since then.
    if (age >= 7) {
      const gym = !rest && !missed, sleep = 400 + ((age * 37) % 70) - (age >= 24 ? 40 : 0);
      health[day] = {
        steps: 6200 + ((age * 911) % 4800),
        km: Math.round((4.2 + ((age * 13) % 30) / 10) * 100) / 100,
        activeKcal: 320 + ((age * 53) % 160),
        eatenKcal: 1900 + ((age * 97) % 400),
        waterMl: 1500 + ((age * 250) % 1000),
        totalKcal: 2100 + ((age * 61) % 300),
        hrAvg: 74 + (age % 5),
        hrMin: 50 + (age % 4),
        hrMax: 140 + ((age * 7) % 25),
        restingHr: 58 + (age % 4) + (age >= 23 ? 3 : 0),
        hrv: 38 + ((age * 5) % 14),
        spo2: 96 + ((age * 3) % 3),
        respRate: 14 + (age % 3) * 0.4,
        weight: Math.round((84 - 0.12 * age) * 10) / 10,
        bodyFat: Math.round((25 - 0.04 * age) * 10) / 10,
        sleepMin: sleep,
        sleepStages: { light: Math.round(sleep * 0.52), deep: Math.round(sleep * 0.2), rem: Math.round(sleep * 0.23), awake: Math.round(sleep * 0.05) },
        bed: `${addDays(day, -1)}T22:${pad(40 + (age % 3) * 5)}:00`,
        wake: `${day}T0${6 + (age % 2)}:${pad(10 + (age % 4) * 5)}:00`,
        workouts: gym ? [{ type: "strengthTraining", start: `${day}T07:05:00`, end: `${day}T07:58:00`, min: 53, kcal: 280 + (age % 5) * 12, source: "Health Connect" }] : [],
      };
    }
  }

  // A sore session shortly before today: whichever knee day that turns out to be, so knee-sensitive lifts hold
  // their weight next time and the following morning's score reflects it.
  const kneeDays = Object.keys(logs).sort().filter((k) => logs[k].kneeAfter != null);
  for (const k of kneeDays) {
    const wake = logs[addDays(k, 1)];
    if (wake) wake.kneeWake = 1;
  }
  if (kneeDays.length >= 2) {
    const sore = kneeDays[kneeDays.length - 2];
    logs[sore].kneeAfter = 6;
    const wake = logs[addDays(sore, 1)];
    if (wake) wake.kneeWake = 3;
  }

  const first = logs[addDays(today, -27)], midway = logs[addDays(today, -6)];
  if (first) first.waist = 96;
  if (midway) midway.waist = 94;
  if (health[today]) Object.assign(health[today], { stepsByHour: [0, 0, 0, 0, 0, 0, 640, 1810, 920, 310, 1240, 1560, 780, 420, 340, 400, 0, 0, 0, 0, 0, 0, 0, 0], bp: { sys: 118, dia: 76 } });

  return { logs, health };
}

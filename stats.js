/* Gym Log — pure calculations for the dashboard, weight hints and records.
 * No DOM and no storage, so it can be tested on its own. Loaded before app.js as window.GymStats.
 * Days are "YYYY-MM-DD" keys; sets are { reps: number|null, kg: number|null }.
 */
(() => {
  "use strict";

  const DAY = 86400000;
  const dayNum = (k) => { const [y, m, d] = k.split("-").map(Number); return Math.round(Date.UTC(y, m - 1, d) / DAY); };
  const keyOfNum = (n) => new Date(n * DAY).toISOString().slice(0, 10);
  const daysBetween = (a, b) => dayNum(b) - dayNum(a);

  /* ---------- body-weight trend ---------- */
  // After TrendWeight (github.com/ervwalter/trendweight, MIT): one value per day from the first to the
  // last weigh-in, gaps filled with straight lines, then Holt's double exponential smoothing (level and
  // slope, alpha = beta = 0.1), which follows steady loss with less lag than a plain moving average.
  // Unlike TrendWeight, level and slope start from a straight-line fit of the first two weeks: started
  // flat from the first weigh-in, the trend lags a steady loss for weeks and then overshoots it.
  function weightTrend(points, alpha = 0.1, beta = 0.1) {
    const pts = points.filter(([, w]) => w > 0).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    const out = [];
    pts.forEach(([k, w], i) => {
      if (i) {
        const [pk, pw] = pts[i - 1], pn = dayNum(pk), n = dayNum(k);
        for (let g = pn + 1; g < n; g++) out.push({ day: keyOfNum(g), weight: pw + (w - pw) * (g - pn) / (n - pn), measured: false });
      }
      out.push({ day: k, weight: w, measured: true });
    });
    const head = out.slice(0, 14).map((p) => p.weight);
    let b = slope(head) ?? 0, level = head.reduce((a, w) => a + w, 0) / (head.length || 1) - (b * (head.length - 1)) / 2;
    out.forEach((p, i) => {
      if (i) {
        const prev = level;
        level = alpha * p.weight + (1 - alpha) * (level + b);
        b = beta * (level - prev) + (1 - beta) * b;
      }
      p.trend = level;
    });
    return out;
  }

  // Least-squares slope of ys against xs (0, 1, 2, … when xs is left out).
  function slope(ys, xs = ys.map((_, i) => i)) {
    const n = ys.length;
    if (n < 2) return null;
    const mx = xs.reduce((a, x) => a + x, 0) / n, my = ys.reduce((a, y) => a + y, 0) / n;
    let num = 0, den = 0;
    ys.forEach((y, i) => { num += (xs[i] - mx) * (y - my); den += (xs[i] - mx) ** 2; });
    return den ? num / den : null;
  }

  // kg per week: least-squares slope of the weigh-ins in the four weeks up to the latest one. It needs
  // six or more weigh-ins spread over at least two weeks; over less, water weight swamps the change.
  function weeklyRate(series) {
    const m = series.filter((p) => p.measured);
    if (!m.length) return null;
    const end = dayNum(m[m.length - 1].day), win = m.filter((p) => end - dayNum(p.day) < 28);
    if (win.length < 6 || end - dayNum(win[0].day) < 13) return null;
    const b = slope(win.map((p) => p.weight), win.map((p) => dayNum(p.day)));
    return b == null ? null : b * 7;
  }

  // Trend change over the last `days`, if the trend reaches back that far and at least `minReadings`
  // real weigh-ins fall inside the window.
  function trendChange(series, days, minReadings = 3) {
    const i = series.length - 1 - days;
    if (i < 0) return null;
    const readings = series.slice(i + 1).filter((p) => p.measured).length;
    return readings >= minReadings ? series[series.length - 1].trend - series[i].trend : null;
  }

  // Day the trend reaches `goal` at the current rate: only while heading toward it and under three years away.
  function goalDate(series, rateKgWeek, goal) {
    if (!series.length || rateKgWeek == null || goal == null) return null;
    const last = series[series.length - 1], perDay = rateKgWeek / 7, gap = goal - last.trend;
    if (!perDay || Math.sign(gap) !== Math.sign(perDay)) return null;
    const days = Math.ceil(gap / perDay);
    return days > 0 && days < 3 * 365 ? keyOfNum(dayNum(last.day) + days) : null;
  }

  /* ---------- lifts ---------- */
  // Brzycki estimate, only for sets of 1–12 reps (higher-rep estimates are unreliable).
  function e1rm(kg, reps) {
    return kg != null && kg > 0 && reps >= 1 && reps <= 12 ? (kg * 36) / (37 - reps) : null;
  }

  // "8-10" -> [8, 10], "12" -> [12, 12], anything else -> null.
  function repRange(s) {
    const n = String(s ?? "").match(/\d+/g);
    if (!n) return null;
    const lo = +n[0], hi = +(n[1] ?? n[0]);
    return lo > 0 && hi >= lo ? [lo, hi] : null;
  }

  // Double progression: when every working set last time reached the top of the rep range at one
  // weight, it's time to add `step` kg.
  function readyToAdd(sets, reps, minSets, step) {
    const range = repRange(reps);
    if (!range || !(step > 0)) return null;
    const work = (sets || []).filter((s) => s && s.reps != null && s.kg != null && s.kg >= 0);
    if (!work.length || work.length < minSets) return null;
    const kg = work[0].kg;
    if (!work.every((s) => s.kg === kg && s.reps >= range[1])) return null;
    return { from: kg, to: Math.round((kg + step) * 100) / 100, top: range[1] };
  }

  // Personal records. `days` is [{ day, lifts: [{ name, sets }] }], oldest first. Each set is compared
  // with every earlier day of the same exercise (not with other sets that day): heaviest weight, best
  // estimated 1RM, or most reps at that weight or heavier. An exercise's first day sets no records.
  // Per exercise and day, each kind of record goes to the best set only.
  function records(days) {
    const best = new Map(), out = [];
    for (const { day, lifts } of days) {
      for (const { name, sets } of lifts) {
        const b = best.get(name);
        if (!b) continue;
        const top = {};
        sets.forEach((s, i) => {
          if (!s || s.kg == null) return;
          const e = s.reps != null ? e1rm(s.kg, s.reps) : null;
          const heavier = b.sets.filter((p) => p.kg >= s.kg && p.reps != null);
          const cands = [];
          if (s.kg > b.kg) cands.push(["weight", s.kg]);
          if (e != null && b.e1rm != null && e > b.e1rm + 1e-9) cands.push(["e1rm", e]);
          if (s.reps != null && heavier.length && s.reps > Math.max(...heavier.map((p) => p.reps))) cands.push(["reps", s.reps * 1000 + s.kg]);
          for (const [kind, v] of cands) if (!top[kind] || v > top[kind].v) top[kind] = { v, i };
        });
        const bySet = new Map();
        for (const [kind, { i }] of Object.entries(top)) bySet.set(i, [...(bySet.get(i) || []), kind]);
        for (const [i, kinds] of bySet) out.push({ day, name, set: i, kg: sets[i].kg, reps: sets[i].reps, e1rm: e1rm(sets[i].kg, sets[i].reps), kinds });
      }
      // Fold this day in only after checking it, so sets on the same day don't compete.
      for (const { name, sets } of lifts) {
        const good = sets.filter((s) => s && s.kg != null);
        if (!good.length) continue;
        const b = best.get(name) || { kg: -Infinity, e1rm: null, sets: [] };
        for (const s of good) {
          b.kg = Math.max(b.kg, s.kg);
          const e = s.reps != null ? e1rm(s.kg, s.reps) : null;
          if (e != null) b.e1rm = Math.max(b.e1rm ?? 0, e);
          b.sets.push({ kg: s.kg, reps: s.reps });
        }
        best.set(name, b);
      }
    }
    return out;
  }

  window.GymStats = { dayNum, keyOfNum, daysBetween, weightTrend, slope, weeklyRate, trendChange, goalDate, e1rm, repRange, readyToAdd, records };
})();

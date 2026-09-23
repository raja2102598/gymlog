/* Gym Log — installable web app backed by Supabase.
 * Data model: one row per (user, day) in table `logs`, with a JSON `data` column:
 *   { exercises: { "<planned exercise name>": {
 *       done: bool, kg: number|null,            // kg = heaviest set (also what older entries hold)
 *       sets?: [{ reps: number|null, kg: number|null }],
 *       skipped?: bool, reason?: string,        // skipped that day, e.g. machine busy
 *       swap?: string } },                      // did this exercise instead that day
 *     warmup: [names], cardio: bool, steps: number|null, weight: number|null, note: string,
 *     session?: 0-6,                            // did another weekday's workout that day (e.g. a missed one)
 *     waist?: cm, cardioMin?, cardioKmh?, cardioIncline?,
 *     kneeBefore?, kneeAfter?, kneeWake?: 0-10 } // knee pain around knee-sensitive sessions, and on waking
 * Exercises are keyed by their planned name, so editing the plan never scrambles old logs.
 * The plan itself is one row per user in table `plans`; plan.json is the default until it's edited.
 * Besides the days, it holds goalWeight, weeklyRatePct and kneeLimit, and each lift's step (kg per
 * increase) and knee (knee-sensitive) flag. The calculations behind hints and the dashboard are in stats.js.
 */
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const CACHE_KEY = "gymlog.cache.v1";
  const PENDING_KEY = "gymlog.pending.v1";
  const PLAN_KEY = "gymlog.plan.v1";
  const EXTRA = ["waist", "cardioMin", "cardioKmh", "cardioIncline", "kneeBefore", "kneeAfter", "kneeWake"];
  const G = window.GymStats;
  const GROWS = !!window.CSS?.supports?.("field-sizing", "content"); // text boxes can size to their content

  let DEFAULT_PLAN = null;  // plan.json
  let PLAN = null;          // the signed-in user's plan (a copy of DEFAULT_PLAN until they edit it)
  let sb = null;            // supabase client
  let user = null;          // signed-in user
  let logs = {};            // day -> data
  let pending = {};         // day -> data not yet saved to Supabase
  let sel = todayKey();
  let flushTimer = null, flushing = false;
  let planDirty = false, planRev = 0, planTimer = null, planFlushing = false;
  let view = "day";         // "day", "dash" (dashboard) or "plan" (the plan editor)
  let editDay = 0;          // weekday open in the plan editor
  let acts = null;          // open lift menu: { day, name, mode: "menu" | "swap" }
  let warmOpen = null;      // day whose warm-up list is unfolded (it starts folded)
  let kneeEdit = { day: null, fields: new Set() }; // knee scales reopened with "Change" on that day
  let recBefore = null;     // { upTo, best }: the records fold of every logged day before `upTo`
  let syncTrouble = false;  // the last save to Supabase failed

  /* ---------- small helpers ---------- */
  function pad(n) { return String(n).padStart(2, "0"); }
  function keyOf(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function todayKey() { return keyOf(new Date()); }
  function parseKey(k) { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); }
  function addDays(k, n) { const d = parseKey(k); d.setDate(d.getDate() + n); return keyOf(d); }
  function wdIndex(k) { return (parseKey(k).getDay() + 6) % 7; }
  function isSlot(v) { return Number.isInteger(v) && v >= 0 && v < 7; }
  // Which weekday's workout day k uses: its own, unless the day was switched to another one.
  function slotFor(k) { const s = logs[k]?.session; return isSlot(s) ? s : wdIndex(k); }
  function planFor(k) { return PLAN.days[slotFor(k)]; }
  function mondayOf(k) { return addDays(k, -wdIndex(k)); }
  function dayMonth(k) { return k.slice(8) + "/" + k.slice(5, 7); }
  function fmt(n) { return n == null || n === "" ? "-" : Number(n).toLocaleString("en-IN"); }
  function num(v) { return v === "" || v == null || isNaN(+v) ? null : +v; }
  function esc(s) { return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
  function setStatus(t) { $("status").textContent = t; }
  function setPlanMsg(t) { $("planMsg").textContent = t; }
  // A bar that stays in view while edits wait on a failed save or on the phone being offline.
  function renderSyncBar() {
    const n = Object.keys(pending).length, off = !navigator.onLine, on = !!user && n > 0 && (syncTrouble || off);
    $("syncBar").hidden = !on;
    if (!on) return;
    $("syncMsg").textContent = `${n} day${n === 1 ? "" : "s"} not synced yet. Saved on this phone; ${off ? "they'll sync when you're back online" : "retrying every 15 seconds"}.`;
    $("syncRetry").hidden = off;
  }
  function lsGet(k, fb) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fb; } catch { return fb; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full or blocked */ } }
  function copy(v) { return JSON.parse(JSON.stringify(v)); }

  function entry(k) {
    const e = logs[k] || {};
    const out = {
      exercises: e.exercises || {},
      warmup: Array.isArray(e.warmup) ? e.warmup : [],
      cardio: !!e.cardio,
      steps: e.steps ?? null,
      weight: e.weight ?? null,
      note: e.note || ""
    };
    if (isSlot(e.session)) out.session = e.session;
    for (const f of EXTRA) if (e[f] != null) out[f] = e[f];
    return out;
  }
  function clone(k) { return copy(entry(k)); }

  /* ---------- lifts: sets, skips and swaps ---------- */
  function minSets(x) { const n = parseInt(x.sets, 10); return n > 0 ? Math.min(n, 10) : 1; }
  // Older entries have only one weight per lift: show it as set 1.
  function setsOf(r) { return Array.isArray(r?.sets) ? r.sets : r?.kg != null ? [{ reps: null, kg: r.kg }] : []; }
  function topKg(sets) { const ks = sets.map((s) => s.kg).filter((k) => k != null); return ks.length ? Math.max(...ks) : null; }
  function performed(name, r) { return r?.swap || name; }
  function liftHasData(r) { return !!r && (r.done || r.skipped || !!r.swap || setsOf(r).some((s) => s.reps != null || s.kg != null)); }

  // Planned lifts for the day, plus anything logged that day that is no longer in the plan.
  function liftsFor(k) {
    const p = planFor(k), e = entry(k);
    const items = p.exercises.map((x) => ({ x, name: x.name, extra: false }));
    const planned = new Set(items.map((it) => it.name));
    for (const [name, r] of Object.entries(e.exercises)) {
      if (!planned.has(name) && liftHasData(r)) items.push({ x: { name, sets: "", reps: "", cue: "", flag: "" }, name, extra: true });
    }
    return items;
  }

  // Most recent earlier day this exercise was actually done (as planned or as a swap).
  function lastDone(name, before) {
    const ks = Object.keys(logs).filter((k) => k < before).sort().reverse();
    for (const k of ks) {
      for (const [key, r] of Object.entries(logs[k].exercises || {})) {
        if (r && !r.skipped && performed(key, r) === name && setsOf(r).some((s) => s.reps != null || s.kg != null)) return { day: k, r };
      }
    }
    return null;
  }
  function lastHint(name, k, cur) {
    const L = lastDone(name, k);
    if (!L) return `<span class="last">first time</span>`;
    const top = topKg(setsOf(L.r));
    if (top == null) return `<span class="last">last &middot; ${dayMonth(L.day)}</span>`;
    const up = cur != null && cur > top;
    return `<span class="last${up ? " up" : ""}">last ${top} kg &middot; ${dayMonth(L.day)}${up ? " &uarr;" : ""}</span>`;
  }
  // Placeholders show what you did last time, so there's something to beat; when it's time to add
  // weight, they show the new weight at the bottom of the rep range.
  function placeholders(x, L, j, next) {
    if (next && !next.held) return [G.repRange(x.reps)[0], next.to];
    const ls = L ? setsOf(L.r) : [], s = ls[j] || ls[ls.length - 1] || {};
    return [s.reps ?? (parseInt(x.reps, 10) || "-"), s.kg ?? "-"];
  }
  function worked(k) { return Object.values(entry(k).exercises).some((r) => r.done || setsOf(r).some((s) => s.reps != null)); }
  // Gym sessions planned for days before today in k's week that no day of that week has done,
  // or taken over for today or later.
  function missedThisWeek(k) {
    const mon = mondayOf(k), t = todayKey(), days = DOW.map((_, i) => addDays(mon, i));
    const covered = (s) => days.some((d) => slotFor(d) === s && (worked(d) || (d >= t && logs[d]?.session === s)));
    return days.map((d, i) => (d < t && d < k && PLAN.days[i].exercises.length && !covered(i) ? i : -1)).filter((i) => i >= 0);
  }
  // First day worth showing in history: the earliest log or the day the account was created.
  function firstDay() {
    const created = user?.created_at ? keyOf(new Date(user.created_at)) : null;
    return [Object.keys(logs).sort()[0], created, todayKey()].filter(Boolean).sort()[0];
  }
  /* ---------- knee, next weight and records ---------- */
  function kneeLifts(p) { return p.exercises.filter((x) => x.knee); }
  function kneeDay(k) { return kneeLifts(planFor(k)).length > 0; }
  // Pain-monitoring model: a session was hard on the knee when pain after it or on waking the next
  // morning passed the limit, or the knee hadn't settled back to its pre-session level by morning.
  function kneeBad(k) {
    const e = entry(k), w = entry(addDays(k, 1)).kneeWake, lim = PLAN.kneeLimit;
    return [e.kneeAfter, w].some((v) => v != null && v > lim) || (w != null && e.kneeBefore != null && w > e.kneeBefore);
  }
  function stepOf(x) { const v = parseFloat(x.step); return v > 0 ? v : 2.5; }
  // Double progression from the last time this exercise was done, held back on knee-sensitive lifts
  // when that session was hard on the knee.
  function nextWeight(x, did, k) {
    const L = lastDone(did, k);
    const r = L && G.readyToAdd(setsOf(L.r), x.reps, minSets(x), stepOf(x));
    return r ? { ...r, day: L.day, held: !!x.knee && kneeBad(L.day) } : null;
  }
  function liftSets(d) {
    return Object.entries(logs[d]?.exercises || {}).filter(([, r]) => r && !r.skipped).map(([key, r]) => ({ name: performed(key, r), sets: setsOf(r) }));
  }
  // Records set in the `n` days up to and including k. Earlier days are only folded in, not checked.
  function recentRecords(k, n) {
    const from = addDays(k, -n), best = new Map(), out = [];
    for (const d of Object.keys(logs).filter((d) => d <= k).sort()) {
      const day = { day: d, lifts: liftSets(d) };
      if (d > from) out.push(...G.checkDay(best, day));
      G.foldDay(best, day);
    }
    return out;
  }
  // Records set on day k, as "exercise|set index" -> kinds. The fold of the days before k is kept, so
  // typing a set re-checks only that day; saving an earlier day, or loading new logs, drops it.
  function recordsOn(k) {
    if (!recBefore || recBefore.upTo !== k) {
      const best = new Map();
      for (const d of Object.keys(logs).filter((d) => d < k).sort()) G.foldDay(best, { day: d, lifts: liftSets(d) });
      recBefore = { upTo: k, best };
    }
    return new Map(G.checkDay(recBefore.best, { day: k, lifts: liftSets(k) }).map((r) => [`${r.name}|${r.set}`, r.kinds]));
  }
  const PR_WORDS = { weight: "heaviest yet", e1rm: "best estimated 1RM", reps: "most reps at this weight" };
  function prTitle(kinds) { return kinds ? "Personal record: " + kinds.map((k) => PR_WORDS[k]).join(", ") : ""; }

  function swapSuggestions(exclude) {
    const s = new Set();
    for (const d of PLAN.days) for (const x of d.exercises) s.add(x.name);
    for (const k of Object.keys(logs)) for (const r of Object.values(logs[k].exercises || {})) if (r?.swap) s.add(r.swap);
    s.delete(exclude);
    return [...s].sort((a, b) => a.localeCompare(b));
  }

  /* ---------- plan ---------- */
  // Fills gaps and drops unnamed lifts so a hand-edited or partial plan can't break rendering.
  function normalizePlan(p) {
    const d = DEFAULT_PLAN;
    const str = (v) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
    const pos = (v) => (v != null && v !== "" && +v > 0 ? +v : null);
    const goal = Math.round(+p?.stepGoal), lim = p?.kneeLimit;
    return {
      tempo: typeof p?.tempo === "string" ? p.tempo : d ? d.tempo : "",
      stepGoal: goal > 0 ? goal : d ? d.stepGoal : 10000,
      goalWeight: pos(p?.goalWeight),
      weeklyRatePct: pos(p?.weeklyRatePct),
      kneeLimit: lim != null && lim !== "" && Number.isInteger(+lim) && +lim >= 0 && +lim <= 10 ? +lim : d ? d.kneeLimit : 5,
      warmups: Array.isArray(p?.warmups) ? [...new Set(p.warmups.map((w) => str(w).trim()).filter(Boolean))] : d ? d.warmups.slice() : [],
      days: DOW.map((wd, i) => {
        const s = (Array.isArray(p?.days) && p.days[i]) || d?.days[i] || {};
        return {
          weekday: wd,
          name: str(s.name).trim() || wd,
          focus: str(s.focus),
          exercises: (Array.isArray(s.exercises) ? s.exercises : [])
            .map((x) => ({
              name: str(x?.name).trim(), sets: str(x?.sets), reps: str(x?.reps), cue: str(x?.cue), flag: str(x?.flag), step: str(x?.step),
              knee: typeof x?.knee === "boolean" ? x.knee : /knee/i.test(str(x?.flag)) // plan.json marks these with a KNEE NOTE
            }))
            .filter((x) => x.name),
          cardio: { name: str(s.cardio?.name), detail: str(s.cardio?.detail) }
        };
      })
    };
  }

  /* ---------- views ---------- */
  function show(v) {
    for (const id of ["bootView", "setupView", "loginView", "appView", "planView", "dashView"]) $(id).hidden = id !== v;
    const inApp = v === "appView" || v === "dashView";
    $("tagline").hidden = inApp || v === "planView";
    $("menuBtn").hidden = !inApp;
    $("dashBtn").hidden = !inApp;
    $("dashBtn").textContent = v === "dashView" ? "Today" : "Dashboard";
    $("menu").hidden = true;
    $("menuBtn").setAttribute("aria-expanded", "false");
  }

  /* ---------- rendering ---------- */
  // Workout status of a day, the same as the dashboard calendar: every planned lift done, some, or missed.
  // Steps and cardio have their own counts, so they don't colour the day.
  function dayState(k, start = firstDay()) {
    const p = planFor(k);
    if (!p.exercises.length || k < start) return "";
    const n = p.exercises.filter((x) => entry(k).exercises[x.name]?.done).length;
    if (n === p.exercises.length) return "done";
    if (n || worked(k)) return "part";
    return k < todayKey() ? "miss" : "";
  }
  const DAY_WORDS = { done: "done", part: "partly done", miss: "missed" };

  function renderWeek() {
    const mon = mondayOf(sel), t = todayKey(), w = $("week"), start = firstDay();
    w.innerHTML = "";
    const a = parseKey(mon), z = parseKey(addDays(mon, 6)), mo = (d) => d.toLocaleDateString("en-IN", { month: "short" });
    $("weekLabel").textContent = mo(a) === mo(z) ? `${a.getDate()}-${z.getDate()} ${mo(z)}` : `${a.getDate()} ${mo(a)} - ${z.getDate()} ${mo(z)}`;
    for (let i = 0; i < 7; i++) {
      const k = addDays(mon, i), p = planFor(k), b = document.createElement("button"), st = dayState(k, start);
      b.className = "dchip " + st + (k === sel ? " sel" : "") + (k === t ? " today" : "");
      b.innerHTML = `<span class="dw">${DOW[i]}</span><span class="dn">${parseKey(k).getDate()}</span><span class="dp"></span>`;
      b.querySelector(".dp").textContent = p.name;
      b.setAttribute("aria-label", `${DOW[i]} ${k}, ${p.name}${st ? ", " + DAY_WORDS[st] : ""}`);
      if (k === t) b.setAttribute("aria-current", "date");
      b.onclick = () => { sel = k; acts = null; render(); };
      w.appendChild(b);
    }
  }

  function liftPill(p, e) {
    if (!p.exercises.length) return `<span class="pill">Rest day</span>`;
    const done = p.exercises.filter((x) => e.exercises[x.name]?.done).length;
    const skipped = p.exercises.filter((x) => e.exercises[x.name]?.skipped).length;
    const cls = done === p.exercises.length ? "good" : done ? "part" : "";
    return `<span class="pill ${cls}">${done}/${p.exercises.length} lifts${skipped ? ` &middot; ${skipped} skipped` : ""}</span>`;
  }

  // A 0-10 knee pain scale in two rows of big buttons. Once scored it folds to one line with a Change button.
  function kneeBlock(e, field, title, sub, msg) {
    const lim = PLAN.kneeLimit, v = e[field], head = `<b>${title}</b>${sub ? ` <span class="sub">${sub}</span>` : ""}`;
    if (v != null && !(kneeEdit.day === sel && kneeEdit.fields.has(field))) {
      return `<div class="knee scored"><div class="kn-head">${head} <span class="kn-val num${v > lim ? " hi" : ""}">${v}/10</span>
        <button type="button" class="ghost tiny" data-kneeedit="${field}" aria-label="Change ${title.toLowerCase()}">Change</button></div>
        ${msg ? `<p class="kn-msg">${msg}</p>` : ""}</div>`;
    }
    return `<div class="knee"><div class="kn-head">${head}<span class="kn-lim">0 = none, 10 = worst &middot; limit ${lim}</span></div>
      <div class="kn-scale" role="group" aria-label="${title}, 0 to 10">${Array.from({ length: 11 }, (_, n) =>
        `<button type="button" class="kn${v === n ? " on" : ""}${n > lim ? " hi" : ""}" data-knee="${field}:${n}" aria-pressed="${v === n}">${n}</button>`).join("")}</div>
      ${msg ? `<p class="kn-msg">${msg}</p>` : ""}</div>`;
  }

  function liftHtml(it, i, e, marks) {
    const { x, name, extra } = it, r = e.exercises[name] || {};
    const did = performed(name, r), L = lastDone(did, sel), next = r.skipped ? null : nextWeight(x, did, sel);
    const sets = setsOf(r), min = extra ? 1 : minSets(x), rows = Math.max(min, sets.length);
    const open = acts && acts.day === sel && acts.name === name ? acts.mode : null;
    const cls = [r.done ? "checked" : "", r.skipped ? "skipped" : "", r.swap ? "swapped" : ""].join(" ").trim();

    let menu = "";
    if (open === "menu") {
      menu = `<div class="acts">${r.skipped
        ? `<label class="field grow" for="reason${i}"><span>Reason (optional)</span><input id="reason${i}" data-reason="${i}" value="${esc(r.reason)}" placeholder="e.g. machine busy" autocomplete="off"></label>
           <button class="ghost tiny" data-unskip="${i}">Undo skip</button>`
        : r.swap
          ? `<button class="ghost tiny" data-unswap="${i}">Back to ${esc(name)}</button>`
          : `<button class="ghost tiny" data-skip="${i}">Skip today</button><button class="ghost tiny" data-swapopen="${i}">Swap for another lift</button>`}</div>`;
    } else if (open === "swap") {
      menu = `<form class="acts" data-swapform="${i}">
          <label class="field grow" for="swap${i}"><span>Did instead</span><input id="swap${i}" list="swapList" placeholder="e.g. Smith machine squat" autocomplete="off" required></label>
          <button class="ghost tiny" type="submit">Swap</button><button class="ghost tiny" type="button" data-actsclose>Cancel</button>
        </form>
        <datalist id="swapList">${swapSuggestions(name).map((n) => `<option value="${esc(n)}">`).join("")}</datalist>`;
    }

    const body = r.skipped
      ? `<div class="skipnote">Skipped${r.reason ? " &middot; " + esc(r.reason) : ""}</div>`
      : `${next ? `<div class="prog${next.held ? " hold" : ""}">${next.held
          ? `Hold ${next.from} kg: your knee was sore after ${dayMonth(next.day)}.`
          : `Go up to <b>${next.to} kg</b>: every set hit ${next.top} reps last time.`}</div>` : ""}
        <div class="sets">${Array.from({ length: rows }, (_, j) => {
          const s = sets[j] || {}, [phR, phK] = placeholders(x, L, j, next), pr = marks.get(`${did}|${j}`);
          return `<div class="set${pr ? " pr" : ""}${s.reps > 0 ? " logged" : ""}"><span class="sn">${j + 1}</span>
            <input id="s${i}_${j}_r" data-set="${i}:${j}:reps" type="number" inputmode="numeric" min="0" step="1" placeholder="${esc(phR)}" value="${s.reps ?? ""}" aria-label="${esc(did)}, set ${j + 1}, reps">
            <span class="x">&times;</span>
            <input id="s${i}_${j}_k" data-set="${i}:${j}:kg" type="number" inputmode="decimal" min="0" step="0.5" placeholder="${esc(phK)}" value="${s.kg ?? ""}" aria-label="${esc(did)}, set ${j + 1}, weight in kg">
            <span class="u">kg</span><span class="prb" title="${prTitle(pr)}">PR</span></div>`;
        }).join("")}
        <div class="setbtns"><button class="ghost tiny" data-addset="${i}">+ Set</button>${sets.length > min ? `<button class="ghost tiny" data-rmset="${i}">&minus; Set</button>` : ""}</div></div>`;

    return `<li class="${cls}"><div class="exrow"><label for="ex${i}">
        <input type="checkbox" id="ex${i}" data-i="${i}" ${r.done ? "checked" : ""} ${r.skipped ? "disabled" : ""}>
        <span><div class="nm">${esc(did)}${r.swap ? ` <span class="was">instead of ${esc(name)}</span>` : ""}</div>
          ${r.skipped || r.swap || !x.cue ? "" : `<div class="nt">${esc(x.cue)}</div>`}
          ${x.flag && !r.skipped && !r.swap ? `<div class="ch">${esc(x.flag)}</div>` : ""}
          ${extra ? `<div class="ch">Not in this workout</div>` : ""}</span>
      </label>
      <div class="load">
        ${x.sets || x.reps ? `<span class="sr">${esc(x.sets)} &times; ${esc(x.reps)}</span>` : ""}
        ${r.skipped ? "" : `<span class="hint">${lastHint(did, sel, r.kg ?? null)}</span>`}
        <button class="ghost tiny more" data-more="${i}" aria-expanded="${open ? "true" : "false"}" aria-label="More for ${esc(did)}">&middot;&middot;&middot;</button>
      </div></div>${menu}${body}</li>`;
  }

  function renderSession() {
    const p = planFor(sel), e = entry(sel), el = $("session"), d = parseKey(sel), items = liftsFor(sel);
    const wus = PLAN.warmups.concat(e.warmup.filter((w) => !PLAN.warmups.includes(w)));
    const slot = slotFor(sel), own = wdIndex(sel), t = todayKey();
    const missed = !p.exercises.length && sel >= t ? missedThisWeek(sel) : [];
    const marks = recordsOn(sel), kneeHere = kneeDay(sel), yest = addDays(sel, -1);
    const wake = kneeDay(yest) && (worked(yest) || entry(yest).kneeAfter != null);
    const wakeMsg = e.kneeWake == null ? "" : kneeBad(yest) ? "Not settled since yesterday: knee lifts will hold their weight next time." : "Settled since yesterday.";
    const afterMsg = e.kneeAfter != null && e.kneeAfter > PLAN.kneeLimit ? "Above your limit: knee lifts will hold their weight next time." : "";
    el.innerHTML = `
      <div class="sess-head">
        <div><h2>${esc(p.name)}</h2><div class="sub">${esc(p.focus)} &middot; ${d.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</div>
          <div class="sess-pick">
            <select id="sessionSel" class="ghost tiny" aria-label="Workout for this day">${PLAN.days.map((x, i) =>
              `<option value="${i}" ${i === slot ? "selected" : ""}>${esc(x.name)} (${DOW[i]}${i === own ? ", usual" : ""})</option>`).join("")}</select>
            ${slot !== own ? `<span class="moved">Usually ${esc(PLAN.days[own].name)} &middot; changed for this day</span>` : ""}
          </div></div>
        <span id="liftPill">${liftPill(p, e)}</span>
      </div>
      ${missed.length ? `<div class="catchup">
        <p>Missed this week: ${missed.map((i) => `<b>${esc(PLAN.days[i].name)}</b> (${DOW[i]})`).join(", ")}. Do ${missed.length > 1 ? "one" : "it"} ${sel === t ? "today" : "on " + DOW[own]}?</p>
        <div class="catchup-btns">${missed.map((i) => `<button class="ghost" data-catch="${i}">Do ${esc(PLAN.days[i].name)}</button>`).join("")}</div>
      </div>` : ""}
      ${wake ? kneeBlock(e, "kneeWake", "Knee on waking", `after ${esc(planFor(yest).name)} yesterday`, wakeMsg) : ""}
      ${p.exercises.length || e.warmup.length ? `<div class="wu">
        <button type="button" class="wu-toggle" id="wuToggle" aria-expanded="${warmOpen === sel}" aria-controls="wuChips">
          <b>Warm-up</b> <span class="sub">${e.warmup.length} of ${wus.length} done</span> <span class="wu-act">${warmOpen === sel ? "Hide" : "Show"}</span></button>
        <div class="chips" id="wuChips" ${warmOpen === sel ? "" : "hidden"}>${wus.map((w, i) => `<label class="chip" for="wu${i}"><input type="checkbox" id="wu${i}" data-w="${esc(w)}" ${e.warmup.includes(w) ? "checked" : ""}><span>${esc(w)}</span></label>`).join("")}</div>
      </div>` : ""}
      ${kneeHere ? kneeBlock(e, "kneeBefore", "Knee pain before you start", "", "") : ""}
      <ul class="ex">${items.map((it, i) => liftHtml(it, i, e, marks)).join("")}</ul>
      ${kneeHere ? kneeBlock(e, "kneeAfter", "Knee pain after the session", "", afterMsg) : ""}
      <ul class="ex cardio"><li class="${e.cardio ? "checked" : ""}"><label for="cardio">
        <input type="checkbox" id="cardio" ${e.cardio ? "checked" : ""}>
        <span><div class="nm">${esc(p.cardio.name || "Cardio")}</div><div class="nt">${esc(p.cardio.detail)}</div></span><span class="sr">cardio</span>
      </label>
      <div class="cardio-log">
        <label for="cMin"><input id="cMin" data-num="cardioMin" type="number" inputmode="numeric" min="0" step="1" placeholder="-" value="${e.cardioMin ?? ""}"><span>min</span></label>
        <label for="cKmh"><input id="cKmh" data-num="cardioKmh" type="number" inputmode="decimal" min="0" step="0.1" placeholder="-" value="${e.cardioKmh ?? ""}"><span>km/h</span></label>
        <label for="cInc"><input id="cInc" data-num="cardioIncline" type="number" inputmode="decimal" min="0" step="0.5" placeholder="-" value="${e.cardioIncline ?? ""}"><span>% incline</span></label>
      </div></li></ul>
      <div class="inputs">
        <label class="field" for="steps"><span>Steps</span>
          <input id="steps" type="number" inputmode="numeric" min="0" step="100" placeholder="0" value="${e.steps ?? ""}">
          <div class="bar"><i style="width:${Math.min(100, (e.steps || 0) / PLAN.stepGoal * 100)}%"></i></div>
        </label>
        <label class="field" for="weight"><span>Body weight (kg)</span>
          <input id="weight" type="number" inputmode="decimal" min="0" step="0.1" placeholder="optional" value="${e.weight ?? ""}">
        </label>
        <label class="field" for="waist"><span>Waist (cm)</span>
          <input id="waist" data-num="waist" type="number" inputmode="decimal" min="0" step="0.5" placeholder="weekly" value="${e.waist ?? ""}">
        </label>
        <label class="field wide" for="note"><span>Notes / extra exercise</span>
          <textarea id="note" placeholder="e.g. 65 jumping jacks, knee felt fine">${esc(e.note)}</textarea>
        </label>
      </div>`;

    // Applies a change to one lift of the selected day and saves it.
    const edit = (i, fn, immediate) => {
      const n = clone(sel), name = items[i].name;
      const r = n.exercises[name] || (n.exercises[name] = { done: false, kg: null });
      fn(r);
      save(sel, n, immediate);
      return r;
    };

    const useSlot = (v) => {
      const n = clone(sel);
      if (v === own) delete n.session; else n.session = v;
      acts = null;
      save(sel, n, true);
    };
    $("sessionSel").onchange = (ev) => useSlot(+ev.target.value);
    $("wuToggle")?.addEventListener("click", () => {
      warmOpen = warmOpen === sel ? null : sel;
      const open = warmOpen === sel;
      $("wuChips").hidden = !open;
      $("wuToggle").setAttribute("aria-expanded", String(open));
      $("wuToggle").querySelector(".wu-act").textContent = open ? "Hide" : "Show";
    });
    el.querySelectorAll("button[data-catch]").forEach((b) => b.onclick = () => useSlot(+b.dataset.catch));
    el.querySelectorAll("input[data-w]").forEach((c) => c.onchange = () => {
      const n = clone(sel), w = c.dataset.w;
      n.warmup = n.warmup.filter((x) => x !== w);
      if (c.checked) n.warmup.push(w);
      n.warmup.sort((a, b) => wus.indexOf(a) - wus.indexOf(b));
      save(sel, n, true);
    });
    el.querySelectorAll("input[data-i]").forEach((c) => c.onchange = () => edit(+c.dataset.i, (r) => { r.done = c.checked; }, true));
    el.querySelectorAll("input[data-set]").forEach((c) => c.oninput = () => {
      const [i, j, f] = c.dataset.set.split(":"), ii = +i, jj = +j, it = items[ii];
      const r = edit(ii, (r) => {
        const sets = setsOf(r).map((s) => ({ reps: s.reps ?? null, kg: s.kg ?? null }));
        while (sets.length <= jj) sets.push({ reps: null, kg: null });
        const v = num(c.value);
        sets[jj][f] = v == null ? null : f === "kg" ? Math.round(v * 2) / 2 : Math.max(0, Math.round(v));
        // A new set usually uses the same weight as the one before it.
        if (f === "reps" && v != null && jj > 0 && sets[jj].kg == null && sets[jj - 1].kg != null) {
          sets[jj].kg = sets[jj - 1].kg;
          $(`s${ii}_${jj}_k`).value = sets[jj].kg;
        }
        r.sets = sets;
        r.kg = topKg(sets);
        // Logging the planned number of sets ticks the lift off.
        if (!r.done && !r.skipped && sets.filter((s) => s.reps > 0).length >= (it.extra ? 1 : minSets(it.x))) {
          r.done = true;
          $(`ex${ii}`).checked = true;
          c.closest("li").classList.add("checked");
        }
      }, false);
      const did = performed(it.name, r), now = recordsOn(sel);
      c.closest("li").querySelector(".hint").innerHTML = lastHint(did, sel, r.kg);
      const logged = setsOf(r);
      c.closest("li").querySelectorAll(".set").forEach((row, n) => {
        const kinds = now.get(`${did}|${n}`);
        row.classList.toggle("pr", !!kinds);
        row.classList.toggle("logged", logged[n]?.reps > 0);
        row.querySelector(".prb").title = prTitle(kinds);
      });
      $("liftPill").innerHTML = liftPill(p, entry(sel));
    });
    el.querySelectorAll("button[data-addset]").forEach((b) => b.onclick = () => {
      const it = items[+b.dataset.addset];
      edit(+b.dataset.addset, (r) => {
        const sets = setsOf(r).map((s) => ({ ...s }));
        while (sets.length < (it.extra ? 1 : minSets(it.x))) sets.push({ reps: null, kg: null });
        sets.push({ reps: null, kg: null });
        r.sets = sets;
      }, true);
    });
    el.querySelectorAll("button[data-rmset]").forEach((b) => b.onclick = () => edit(+b.dataset.rmset, (r) => {
      r.sets = setsOf(r).slice(0, -1);
      r.kg = topKg(r.sets);
    }, true));
    el.querySelectorAll("button[data-more]").forEach((b) => b.onclick = () => {
      const name = items[+b.dataset.more].name;
      acts = acts && acts.day === sel && acts.name === name ? null : { day: sel, name, mode: "menu" };
      renderSession();
    });
    el.querySelectorAll("button[data-skip]").forEach((b) => b.onclick = () => {
      edit(+b.dataset.skip, (r) => { r.skipped = true; r.done = false; }, true);
      $("reason" + b.dataset.skip)?.focus();
    });
    el.querySelectorAll("input[data-reason]").forEach((c) => c.oninput = () => {
      const r = edit(+c.dataset.reason, (r) => { r.reason = c.value; }, false);
      c.closest("li").querySelector(".skipnote").innerHTML = "Skipped" + (r.reason ? " &middot; " + esc(r.reason) : "");
    });
    el.querySelectorAll("button[data-unskip]").forEach((b) => b.onclick = () => {
      acts = null;
      edit(+b.dataset.unskip, (r) => { delete r.skipped; delete r.reason; }, true);
    });
    el.querySelectorAll("button[data-swapopen]").forEach((b) => b.onclick = () => {
      acts = { day: sel, name: items[+b.dataset.swapopen].name, mode: "swap" };
      renderSession();
      $("swap" + b.dataset.swapopen).focus();
    });
    el.querySelectorAll("form[data-swapform]").forEach((f) => f.onsubmit = (ev) => {
      ev.preventDefault();
      const i = +f.dataset.swapform, v = $("swap" + i).value.trim();
      if (!v || v === items[i].name) return;
      acts = null;
      edit(i, (r) => { r.swap = v; }, true);
    });
    el.querySelectorAll("[data-actsclose]").forEach((b) => b.onclick = () => { acts = null; renderSession(); });
    el.querySelectorAll("button[data-unswap]").forEach((b) => b.onclick = () => {
      acts = null;
      edit(+b.dataset.unswap, (r) => { delete r.swap; }, true);
    });
    el.querySelectorAll("button[data-knee]").forEach((b) => b.onclick = () => {
      const [f, v] = b.dataset.knee.split(":"), n = clone(sel);
      if (n[f] === +v) delete n[f]; else n[f] = +v;
      kneeEdit.fields.delete(f);
      save(sel, n, true);
    });
    el.querySelectorAll("button[data-kneeedit]").forEach((b) => b.onclick = () => {
      const f = b.dataset.kneeedit;
      if (kneeEdit.day !== sel) kneeEdit = { day: sel, fields: new Set() };
      kneeEdit.fields.add(f);
      renderSession();
      el.querySelector(`button[data-knee^="${f}:"]`)?.focus();
    });
    el.querySelectorAll("input[data-num]").forEach((c) => c.oninput = () => {
      const n = clone(sel), f = c.dataset.num, v = num(c.value);
      if (v == null || v < 0) delete n[f]; else n[f] = Math.round(v * 10) / 10;
      // Entering cardio minutes ticks the finisher off.
      if (f === "cardioMin" && v > 0 && !n.cardio) { n.cardio = true; $("cardio").checked = true; $("cardio").closest("li").classList.add("checked"); }
      save(sel, n, false);
    });
    $("cardio").onchange = (ev) => { const n = clone(sel); n.cardio = ev.target.checked; save(sel, n, true); };
    $("steps").oninput = () => {
      const n = clone(sel), v = $("steps").value;
      n.steps = v === "" ? null : Math.max(0, Math.round(+v));
      el.querySelector(".bar i").style.width = Math.min(100, (n.steps || 0) / PLAN.stepGoal * 100) + "%";
      save(sel, n, false);
    };
    $("weight").oninput = () => { const n = clone(sel), v = $("weight").value; n.weight = v === "" ? null : Math.round(+v * 10) / 10; save(sel, n, false); };
    // The note grows with its text instead of scrolling inside a small box: CSS does it where the browser
    // supports field-sizing (Chrome), this does it elsewhere.
    const grow = () => { const ta = $("note"); if (GROWS || !ta.offsetParent) return; ta.style.height = "auto"; ta.style.height = ta.scrollHeight + 2 + "px"; };
    grow();
    $("note").oninput = () => { grow(); const n = clone(sel); n.note = $("note").value; save(sel, n, false); };
  }

  // Planned gym sessions done in the week starting `mon`: each counts once, on whichever day it was done.
  function weekSessions(mon) {
    const days = DOW.map((_, i) => addDays(mon, i));
    const gym = PLAN.days.map((p, s) => (p.exercises.length ? s : -1)).filter((s) => s >= 0);
    const done = gym.filter((s) => days.some((k) => slotFor(k) === s && PLAN.days[s].exercises.every((x) => entry(k).exercises[x.name]?.done))).length;
    return { days, done, planned: gym.length };
  }

  function renderStats() {
    const { days, done: sess, planned } = weekSessions(mondayOf(sel));
    let cardio = 0, steps = 0, stepDays = 0;
    for (const k of days) {
      const e = entry(k);
      if (e.cardio) cardio++;
      if (e.steps != null) { steps += e.steps; stepDays++; }
    }
    const avg = stepDays ? Math.round(steps / stepDays) : null;
    $("stats").innerHTML = [
      [sess + "/" + planned, "gym sessions complete"],
      [cardio + "/7", "cardio finishers"],
      [fmt(avg), "avg steps / logged day"],
      [fmt(steps), "total steps"]
    ].map(([v, l]) => `<div class="stat"><div class="v num">${v}</div><div class="l">${l}</div></div>`).join("");
  }

  function weightSeries() { return G.weightTrend(Object.keys(logs).filter((k) => logs[k].weight != null).map((k) => [k, +logs[k].weight])); }
  function ago(n) { return n <= 0 ? "today" : n === 1 ? "yesterday" : `${n} days ago`; }
  function signed(v, dp = 1) { return (v > 0 ? "+" : v < 0 ? "−" : "±") + Math.abs(v).toFixed(dp); }
  function dm(k) { return parseKey(k).toLocaleDateString("en-IN", { day: "numeric", month: "short" }); }
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  const avg = (a) => (a.length ? sum(a) / a.length : null);

  // The Today screen keeps a one-line trend; the chart lives on the dashboard.
  function renderChart() {
    const s = weightSeries(), el = $("chart");
    if (!s.length) { el.innerHTML = `<p class="empty">Log your weight to start the trend.</p>`; return; }
    const last = s[s.length - 1], rate = G.weeklyRate(s), lastIn = s.filter((p) => p.measured).pop().day;
    el.innerHTML = `<p class="sub"><span class="num">${last.trend.toFixed(1)} kg</span> trend${rate != null ? `, <span class="num">${signed(rate, 2)} kg</span> a week` : ""} &middot; weighed ${ago(G.daysBetween(lastIn, todayKey()))}</p>
      <button class="ghost tiny" id="toDash">Open dashboard</button>`;
    $("toDash").onclick = openDash;
  }

  /* ---------- dashboard ---------- */
  function openDash() { view = "dash"; acts = null; show("dashView"); renderDash(); window.scrollTo(0, 0); }
  function closeDash() { view = "day"; show("appView"); render(); }

  function renderDash() {
    const t = todayKey(), flags = [];
    $("dashAsOf").textContent = parseKey(t).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" });
    $("dashWeight").innerHTML = dashWeight(t, flags);
    $("dashWeight").querySelector("[data-goto]")?.addEventListener("click", (ev) => {
      const id = ev.currentTarget.dataset.goto;
      openPlan();
      $(id).scrollIntoView({ block: "center" });
      $(id).focus({ preventScroll: true });
    });
    $("dashPlan").innerHTML = dashPlan(t);
    $("dashSteps").innerHTML = dashSteps(t);
    $("dashStrength").innerHTML = dashStrength(t, flags);
    $("dashKnee").innerHTML = dashKnee(t, flags);
    flags.sort((a, b) => a.pri - b.pri);
    $("dashFlags").innerHTML = `<ul class="flags">${flags.map((f) => `<li class="${f.warn ? "warn" : ""}">${f.text}</li>`).join("")}</ul>`;
    $("dashFlags").hidden = !flags.length;
  }

  // Is the weight trend moving at the intended pace?
  function dashWeight(t, flags) {
    const s = weightSeries(), head = `<h2>Weight trend</h2>`;
    if (!s.length) return head + `<p class="empty">Log your body weight on the Today screen to start the trend.</p>`;
    const first = s[0], last = s[s.length - 1], since = G.daysBetween(s.filter((p) => p.measured).pop().day, t);
    const rate = G.weeklyRate(s), pct = rate != null ? (rate / last.trend) * 100 : null, goal = PLAN.goalWeight, target = PLAN.weeklyRatePct;
    if (since >= 5) flags.push({ pri: 2, warn: true, text: `No weigh-in for ${since} days. A few weigh-ins a week keep the trend honest.` });
    if (target && pct != null && s.length >= 21) {
      const loss = -pct;
      if (loss < target / 2) flags.push({ pri: 3, text: loss > 0 ? `Losing ${loss.toFixed(2)}% a week, well under your ${target}% target.` : `The trend isn't going down yet (${signed(pct, 2)}% a week) against your ${target}% target.` });
      else if (loss > target * 1.5) flags.push({ pri: 3, warn: true, text: `Losing ${loss.toFixed(2)}% a week, faster than your ${target}% target.` });
    }
    let goalKpi;
    if (goal == null) goalKpi = `<div class="v">-</div><div class="l">no goal weight yet</div><button class="ghost tiny" data-goto="pe_goalw">Set a goal</button>`;
    else if ((last.trend - goal) * (first.trend - goal) <= 0) goalKpi = `<div class="v">Reached</div><div class="l">goal ${goal} kg</div>`;
    else {
      const gd = G.goalDate(s, rate, goal);
      goalKpi = gd ? `<div class="v num">${dm(gd)}</div><div class="l">goal ${goal} kg at this pace</div>`
        : `<div class="v">-</div><div class="l">goal ${goal} kg: ${rate == null ? "needs 2 weeks of weigh-ins" : "not heading there yet"}</div>`;
    }
    const changes = [7, 14, 28].map((d) => [d / 7, G.trendChange(s, d)]).filter(([, v]) => v != null);
    const wd = Object.keys(logs).filter((k) => logs[k].waist != null).sort(), wl = wd[wd.length - 1];
    const w4 = wl && wd.filter((k) => G.daysBetween(k, wl) >= 28).pop();
    return head + `<div class="kpis">
        <div class="kpi"><div class="v num">${last.trend.toFixed(1)} kg</div><div class="l">trend weight &middot; weighed ${ago(since)}</div></div>
        <div class="kpi"><div class="v num">${rate != null ? signed(rate, 2) + " kg" : "-"}</div><div class="l">${rate != null ? `a week (${signed(pct, 2)}% of body weight)` : "a week: needs 6 weigh-ins over 2 weeks"}</div></div>
        <div class="kpi">${goalKpi}</div>
      </div>
      ${changes.length ? `<p class="sub">Change over ${changes.map(([w, v]) => `${w} wk <span class="num">${signed(v)} kg</span>`).join(", ")}</p>` : ""}
      ${s.length >= 2 ? lineChart(s.map((p) => [p.day, p.trend]), s.filter((p) => p.measured).map((p) => [p.day, p.weight]), goal != null && Math.abs(goal - last.trend) <= 8 ? goal : null, chartWidth("dashWeight"))
        : `<p class="empty">One weigh-in so far. The trend line starts after a few more.</p>`}
      ${wl ? `<p class="sub">Waist <span class="num">${logs[wl].waist} cm</span> on ${dm(wl)}${w4 ? ` &middot; <span class="num">${signed(logs[wl].waist - logs[w4].waist)} cm</span> since ${dm(w4)}` : ""}</p>` : ""}`;
  }

  // Charts are drawn at the panel's real width, so their 11px labels stay readable on a phone.
  function chartWidth(id) { return Math.max(260, $(id).clientWidth - 36); }

  // Trend line over real dates, the weigh-ins as pale dots, and an optional goal line.
  function lineChart(line, dots, goal, W) {
    const H = 180, L = 40, R = 8, T = 10, B = 22;
    const n0 = G.dayNum(line[0][0]), n1 = G.dayNum(line[line.length - 1][0]);
    const vals = line.map((p) => p[1]).concat(dots.map((p) => p[1]), goal != null ? [goal] : []);
    const pad = Math.max(0.3, (Math.max(...vals) - Math.min(...vals)) * 0.1);
    const lo = Math.floor((Math.min(...vals) - pad) * 2) / 2, hi = Math.ceil((Math.max(...vals) + pad) * 2) / 2;
    const x = (k) => (L + ((G.dayNum(k) - n0) * (W - L - R)) / Math.max(1, n1 - n0)).toFixed(1);
    const y = (v) => (T + ((hi - v) * (H - T - B)) / (hi - lo)).toFixed(1);
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Body weight trend">
      ${[lo, (lo + hi) / 2, hi].map((v) => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${L - 6}" y="${+y(v) + 4}" text-anchor="end">${v.toFixed(1)}</text>`).join("")}
      ${goal != null ? `<line x1="${L}" x2="${W - R}" y1="${y(goal)}" y2="${y(goal)}" class="goal"/><text x="${W - R}" y="${+y(goal) - 5}" text-anchor="end">goal ${goal}</text>` : ""}
      ${dots.map(([k, v]) => `<circle cx="${x(k)}" cy="${y(v)}" r="3" class="dot"/>`).join("")}
      <path d="${line.map(([k, v], i) => `${i ? "L" : "M"}${x(k)} ${y(v)}`).join(" ")}" class="trendline"/>
      <text x="${L}" y="${H - 6}">${dm(line[0][0])}</text><text x="${W - R}" y="${H - 6}" text-anchor="end">${dm(line[line.length - 1][0])}</text>
    </svg>`;
  }

  // Am I keeping the plan?
  function dashPlan(t) {
    const start = firstDay(), mon = mondayOf(t), weeks = [];
    for (let m = mondayOf(start); m <= mon; m = addDays(m, 7)) weeks.push({ mon: m, ...weekSessions(m) });
    let streak = 0; // full weeks in a row; the current week only counts once it's full
    for (let i = weeks.length - 1; i >= 0; i--) {
      if (weeks[i].planned && weeks[i].done >= weeks[i].planned) streak++;
      else if (weeks[i].mon !== mon) break;
    }
    const recent = weeks.slice(-12), done = sum(recent.map((w) => w.done)), planned = sum(recent.map((w) => w.planned));
    const tw = weeks[weeks.length - 1], wk = tw.days.filter((k) => k <= t && k >= start);
    const cardioDays = wk.filter((k) => entry(k).cardio).length, cardioMin = sum(wk.map((k) => entry(k).cardioMin || 0));
    const weighIns = wk.filter((k) => entry(k).weight != null).length;
    return `<h2>Plan kept</h2>
      <div class="kpis">
        <div class="kpi"><div class="v num">${tw.done}/${tw.planned}</div><div class="l">sessions this week</div></div>
        <div class="kpi"><div class="v num">${streak}</div><div class="l">full week${streak === 1 ? "" : "s"} in a row</div></div>
        <div class="kpi"><div class="v num">${planned ? Math.round((done / planned) * 100) : 0}%</div><div class="l">${done} of ${planned} sessions ${recent.length > 1 ? `in ${recent.length} weeks` : "this week"}</div></div>
      </div>
      <p class="sub">This week: cardio on ${cardioDays} day${cardioDays === 1 ? "" : "s"}${cardioMin ? ` (<span class="num">${cardioMin}</span> min)` : ""} &middot; ${weighIns} weigh-in${weighIns === 1 ? "" : "s"}</p>
      ${heatmap(weeks.slice(-16).map((w) => w.mon), t, start)}`;
  }

  const HEAT = { done: "all lifts done", part: "some lifts done", miss: "missed", todo: "to do", rest: "rest day", fut: "ahead", pre: "before you started" };
  // Workout days only: steps and weigh-ins have their own cards.
  function heatmap(mons, t, start) {
    const cls = (k) => {
      if (k > t) return "fut";
      if (k < start) return "pre";
      const p = planFor(k), n = p.exercises.filter((x) => entry(k).exercises[x.name]?.done).length;
      if (!p.exercises.length) return "rest";
      return n === p.exercises.length ? "done" : n || worked(k) ? "part" : k < t ? "miss" : "todo";
    };
    return `<div class="heat" role="img" aria-label="Calendar of the last ${mons.length} week${mons.length === 1 ? "" : "s"}">${mons.map((m) =>
      `<div class="hw">${DOW.map((_, i) => { const k = addDays(m, i), c = cls(k); return `<i class="${c}${k === t ? " now" : ""}" title="${dm(k)}: ${HEAT[c]}"></i>`; }).join("")}</div>`).join("")}</div>
      <p class="legend"><i class="done"></i>all lifts <i class="part"></i>some lifts <i class="miss"></i>missed <i class="rest"></i>rest</p>`;
  }

  // Am I walking enough?
  function dashSteps(t) {
    const start = firstDay(), goal = PLAN.stepGoal, mon = mondayOf(t);
    const a7 = avg(DOW.map((_, i) => addDays(t, -i)).filter((k) => k >= start).map((k) => entry(k).steps).filter((v) => v != null));
    const wk = DOW.map((_, i) => addDays(mon, i)).filter((k) => k <= t && k >= start);
    const atGoal = wk.filter((k) => (entry(k).steps || 0) >= goal).length, weeks = [];
    for (let m = mondayOf(start); m <= mon; m = addDays(m, 7)) weeks.push(m);
    const bars = weeks.slice(-12).map((m) => [m, avg(DOW.map((_, i) => entry(addDays(m, i)).steps).filter((v) => v != null))]);
    return `<h2>Steps</h2>
      <div class="kpis">
        <div class="kpi"><div class="v num">${a7 != null ? fmt(Math.round(a7)) : "-"}</div><div class="l">7-day average (goal ${fmt(goal)})</div></div>
        <div class="kpi"><div class="v num">${atGoal}/${wk.length}</div><div class="l">days at goal this week</div></div>
      </div>
      ${bars.some(([, v]) => v != null) ? barChart(bars, [[goal, fmt(goal)], [7000, "7,000"]], chartWidth("dashSteps")) : `<p class="empty">Log your daily steps on the Today screen to see weekly averages.</p>`}
      <p class="note">Most of the health benefit of walking is in by about 7,000 steps a day, so days between that line and your goal still count.</p>`;
  }

  function barChart(bars, lines, W) {
    const H = 150, L = 54, R = 8, T = 10, B = 22;
    const hi = Math.max(...bars.map(([, v]) => v || 0), ...lines.map(([v]) => v)) * 1.1;
    const bw = Math.min((W - L - R) / bars.length, 44), y = (v) => (T + ((hi - v) * (H - T - B)) / hi).toFixed(1);
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Average daily steps by week">
      ${lines.map(([v, lab]) => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="ref"/><text x="${L - 6}" y="${+y(v) + 4}" text-anchor="end">${lab}</text>`).join("")}
      ${bars.map(([m, v], i) => (v == null ? "" : `<rect x="${(L + i * bw + bw * 0.15).toFixed(1)}" y="${y(v)}" width="${(bw * 0.7).toFixed(1)}" height="${(H - B - y(v)).toFixed(1)}" rx="4" class="wbar${v >= lines[0][0] ? " met" : ""}"><title>Week of ${dm(m)}: ${fmt(Math.round(v))} a day</title></rect>`)).join("")}
      <text x="${L}" y="${H - 6}">wk of ${dm(bars[0][0])}</text>${bars.length > 1 ? `<text x="${W - R}" y="${H - 6}" text-anchor="end">${dm(bars[bars.length - 1][0])}</text>` : ""}
    </svg>`;
  }

  function sparkline(vals) {
    if (vals.length < 2) return `<svg class="spark" viewBox="0 0 120 32" aria-hidden="true"></svg>`;
    const lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1;
    const pts = vals.map((v, i) => `${((i * 116) / (vals.length - 1) + 2).toFixed(1)},${(28 - ((v - lo) * 24) / span).toFixed(1)}`).join(" ");
    return `<svg class="spark" viewBox="0 0 120 32" aria-hidden="true"><polyline points="${pts}"/></svg>`;
  }

  // Is strength holding during the cut?
  function dashStrength(t, flags) {
    const rows = PLAN.days.filter((d) => d.exercises.length).map((d) => {
      const x = d.exercises[0];
      const pts = Object.keys(logs).filter((k) => k <= t).sort().map((k) => [k, Math.max(0, ...liftSets(k).filter((l) => l.name === x.name).flatMap((l) => l.sets.map((s) => G.e1rm(s.kg, s.reps) || 0)))]).filter(([, v]) => v > 0);
      let change = "";
      if (pts.length >= 2) {
        const [lk, lv] = pts[pts.length - 1], base = pts.filter(([k]) => G.daysBetween(k, lk) >= 28).pop() || pts[0], pc = ((lv - base[1]) / base[1]) * 100;
        change = Math.abs(pc) < 2.5 ? `holding since ${dm(base[0])}` : `${signed(pc, 0)}% since ${dm(base[0])}`;
      }
      const logged = pts.length || Object.keys(logs).some((k) => k <= t && liftSets(k).some((l) => l.name === x.name));
      return `<li><span class="ln">${esc(x.name)} <span class="sub">${esc(d.name)}</span></span>${sparkline(pts.map((p) => p[1]))}
        <span class="lv num">${pts.length ? Math.round(pts[pts.length - 1][1]) + " kg" : "-"}</span> <span class="lc">${pts.length ? change || "first session" : logged ? "no estimate yet: needs a set with weight and 1-12 reps" : "not logged yet"}</span></li>`;
    });
    const tomorrow = addDays(t, 1), seen = new Set(), ready = [], held = [];
    PLAN.days.forEach((d) => d.exercises.forEach((x) => {
      if (seen.has(x.name)) return;
      seen.add(x.name);
      const nw = nextWeight(x, x.name, tomorrow);
      if (nw) (nw.held ? held : ready).push(`<li><b>${esc(x.name)}</b> <span class="sub">${esc(d.name)}</span>: ${nw.held ? `hold ${nw.from} kg (knee)` : `${nw.from} → <b>${nw.to} kg</b>`}</li>`);
    }));
    if (ready.length) flags.push({ pri: 4, text: `${ready.length} lift${ready.length === 1 ? " is" : "s are"} ready for more weight. See Strength.` });
    const recs = recentRecords(t, 30).reverse().slice(0, 8);
    return `<h2>Strength</h2>
      <p class="note">Estimated 1RM of each day's first lift, from sets of 12 reps or fewer. Holding steady is a win during a cut.</p>
      ${Object.keys(logs).some((k) => k <= t && liftSets(k).length) ? `<ul class="lifts">${rows.join("")}</ul>` : `<p class="empty">Log a session to start tracking strength.</p>`}
      <h3 class="dh">Ready to add weight</h3>
      ${ready.length || held.length ? `<ul class="plain">${ready.join("")}${held.join("")}</ul>` : `<p class="empty">Nothing yet. A lift is ready once every set reaches the top of its rep range.</p>`}
      <h3 class="dh">Records in the last 30 days</h3>
      ${recs.length ? `<ul class="plain">${recs.map((r) => `<li><span class="num">${dayMonth(r.day)}</span> <b>${esc(r.name)}</b> ${r.reps != null ? `${r.reps} × ` : ""}${r.kg} kg <span class="sub">${r.kinds.map((k) => PR_WORDS[k]).join(", ")}</span></li>`).join("")}</ul>`
        : `<p class="empty">None yet. Records show up once a lift beats an earlier session.</p>`}`;
  }

  // How is the knee responding?
  function dashKnee(t, flags) {
    const lim = PLAN.kneeLimit, head = `<h2>Knee</h2>`, kneeDays = PLAN.days.filter((d) => kneeLifts(d).length);
    if (!kneeDays.length) return head + `<p class="empty">No lifts are marked knee-sensitive. Mark them in Edit plan to track knee pain around them.</p>`;
    const scored = (k) => entry(k).kneeBefore != null || entry(k).kneeAfter != null || entry(addDays(k, 1)).kneeWake != null;
    const sess = Object.keys(logs).filter((k) => k <= t && kneeDay(k) && (worked(k) || scored(k))).sort().slice(-10);
    if (!sess.some(scored)) {
      return head + `<p class="empty">Tap your knee pain (0 to 10) before and after ${[...new Set(kneeDays.map((d) => esc(d.name)))].join(" and ")} sessions, and on waking the next morning. Scores above ${lim} are flagged, and knee lifts hold their weight after a bad day.</p>`;
    }
    const last = sess[sess.length - 1];
    if (kneeBad(last)) flags.push({ pri: 1, warn: true, text: `Knee was above your limit after ${esc(planFor(last).name)} on ${dm(last)}. Knee lifts hold their weight until a better session.` });
    const mon = mondayOf(t), vals = (m) => DOW.map((_, i) => addDays(m, i)).flatMap((k) => [entry(k).kneeAfter, entry(k).kneeWake]).filter((v) => v != null);
    const now = avg(vals(mon)), prev = avg(vals(addDays(mon, -7)));
    if (now != null && prev != null && now > prev + 0.5) flags.push({ pri: 1, warn: true, text: `Knee pain is up this week: ${now.toFixed(1)} on average, against ${prev.toFixed(1)} last week.` });
    const hi = (v, notSettled) => (v != null && (v > lim || notSettled) ? " hi" : "");
    return head + `${now != null ? `<p class="sub">This week, after sessions and on waking: <span class="num">${now.toFixed(1)}</span> on average${prev != null ? ` (last week ${prev.toFixed(1)})` : ""}</p>` : ""}
      <table class="knee-t"><thead><tr><th>Session</th><th class="r">Before</th><th class="r">After</th><th class="r">Next morning</th></tr></thead><tbody>
      ${sess.slice().reverse().map((k) => {
        const e = entry(k), w = entry(addDays(k, 1)).kneeWake;
        const loads = kneeLifts(planFor(k)).map((x) => { const r = e.exercises[x.name], top = r && !r.skipped ? topKg(setsOf(r)) : null; return top != null ? `${esc(r.swap || x.name)} ${top} kg` : ""; }).filter(Boolean);
        return `<tr><td>${dm(k)} ${esc(planFor(k).name)}${loads.length ? `<div class="loads">${loads.join(" &middot; ")}</div>` : ""}</td>
          <td class="r num">${e.kneeBefore ?? "-"}</td><td class="r num${hi(e.kneeAfter)}">${e.kneeAfter ?? "-"}</td><td class="r num${hi(w, w != null && e.kneeBefore != null && w > e.kneeBefore)}">${w ?? "-"}</td></tr>`;
      }).join("")}</tbody></table>
      <p class="note">Your limit is ${lim}/10 (change it in Edit plan). Pain above it, or not settled by the next morning, holds the weight on knee lifts. Worth agreeing the limit with a physio.</p>`;
  }

  function renderHist() {
    const rows = [], t = todayKey(), start = firstDay();
    for (let i = 0; i < 14; i++) {
      const k = addDays(t, -i), p = planFor(k), e = entry(k);
      if (k < start) break;
      const exDone = p.exercises.filter((x) => e.exercises[x.name]?.done).length;
      rows.push(`<tr><td><span class="num">${DOW[wdIndex(k)]} ${+k.slice(8)}</span><div class="hs">${esc(p.name)}</div></td>
        <td class="r num">${p.exercises.length ? exDone + "/" + p.exercises.length : "-"}</td><td class="c">${e.cardio ? "&check;" : "-"}</td>
        <td class="r num">${fmt(e.steps)}</td><td class="r num">${e.weight ?? "-"}</td></tr>`);
    }
    $("histTitle").textContent = rows.length === 1 ? "Today" : `Last ${rows.length} days`;
    $("hist").innerHTML = `<table><thead><tr><th>Day</th><th class="r">Lifts</th><th class="c">Cardio</th><th class="r">Steps</th><th class="r">kg</th></tr></thead><tbody>${rows.join("")}</tbody></table>`;
  }

  function renderTempo() {
    $("tempoNote").textContent = PLAN.tempo
      ? `Tempo on every lift: ${PLAN.tempo} (seconds down, pause, up, pause). Warm up at 60 to 75% of working weight before the first main lift.`
      : "";
  }

  function render() { renderWeek(); renderSession(); renderStats(); renderChart(); renderHist(); renderTempo(); }
  function renderLight() { renderWeek(); renderStats(); renderChart(); renderHist(); }
  function editing() { const a = document.activeElement; return !!a && (a.tagName === "TEXTAREA" || (a.tagName === "INPUT" && a.type !== "checkbox")); }

  /* ---------- plan editor ---------- */
  function openPlan() {
    view = "plan";
    editDay = wdIndex(sel);
    show("planView");
    renderPlanEditor();
    window.scrollTo(0, 0);
  }
  function closePlan() {
    PLAN = normalizePlan(PLAN);
    persistPlan();
    view = "day";
    acts = null;
    show("appView");
    render();
    flushPlan();
  }
  function planChanged(structural) {
    planRev++;
    planDirty = true;
    persistPlan();
    if (structural) renderPlanEditor(); else renderPlanDays();
    setPlanMsg("Saving…");
    clearTimeout(planTimer);
    planTimer = setTimeout(flushPlan, 800);
  }
  function checkPlanDay() {
    const names = PLAN.days[editDay].exercises.map((x) => x.name.trim());
    const dup = names.find((n, i) => n && names.indexOf(n) !== i);
    const msg = names.some((n) => !n) ? "Lifts without a name aren't saved. Give each one a name."
      : dup ? `Two lifts are called “${dup}”. Rename one so their logs stay separate.` : "";
    $("peWarn").textContent = msg;
    $("peWarn").hidden = !msg;
  }

  function renderPlanDays() {
    const w = $("planDays");
    w.innerHTML = "";
    PLAN.days.forEach((d, i) => {
      const b = document.createElement("button");
      b.className = "dchip" + (i === editDay ? " sel" : "");
      b.innerHTML = `<span class="dw">${DOW[i]}</span><span class="dp"></span>`;
      b.querySelector(".dp").textContent = d.name;
      b.setAttribute("aria-label", `Edit ${DOW[i]}, ${d.name}`);
      b.onclick = () => { editDay = i; renderPlanEditor(); };
      w.appendChild(b);
    });
  }

  function renderPlanEditor() {
    renderPlanDays();
    const d = PLAN.days[editDay], last = d.exercises.length - 1;
    $("planDay").innerHTML = `
      <div class="pe-grid">
        <label class="field" for="pe_name"><span>${DOW[editDay]} session name</span><input id="pe_name" value="${esc(d.name)}" placeholder="e.g. Push" autocomplete="off"></label>
        <label class="field" for="pe_focus"><span>Focus</span><input id="pe_focus" value="${esc(d.focus)}" placeholder="e.g. Chest / Shoulders" autocomplete="off"></label>
      </div>
      <h3 class="pe-h">Lifts</h3>
      <p class="warn" id="peWarn" hidden></p>
      ${d.exercises.length ? "" : `<p class="empty">No lifts: this is a rest day. Add one to make it a gym day.</p>`}
      <ol class="pe-list">${d.exercises.map((x, j) => `
        <li class="pe-ex">
          <div class="pe-row">
            <label class="field" for="pe_x${j}_name"><span>Lift ${j + 1}</span><input id="pe_x${j}_name" data-px="${j}:name" value="${esc(x.name)}" placeholder="Exercise name" autocomplete="off"></label>
            <label class="field" for="pe_x${j}_sets"><span>Sets</span><input id="pe_x${j}_sets" data-px="${j}:sets" value="${esc(x.sets)}" placeholder="3" autocomplete="off"></label>
            <label class="field" for="pe_x${j}_reps"><span>Reps</span><input id="pe_x${j}_reps" data-px="${j}:reps" value="${esc(x.reps)}" placeholder="8-10" autocomplete="off"></label>
          </div>
          <label class="field" for="pe_x${j}_cue"><span>How to do it</span><textarea id="pe_x${j}_cue" data-px="${j}:cue" rows="2">${esc(x.cue)}</textarea></label>
          <label class="field" for="pe_x${j}_flag"><span>Warning note (optional)</span><input id="pe_x${j}_flag" data-px="${j}:flag" value="${esc(x.flag)}" placeholder="e.g. KNEE NOTE: pain-free range only" autocomplete="off"></label>
          <div class="pe-row2">
            <label class="field" for="pe_x${j}_step"><span>Add per increase (kg)</span><input id="pe_x${j}_step" data-px="${j}:step" inputmode="decimal" value="${esc(x.step)}" placeholder="2.5" autocomplete="off"></label>
            <label class="pe-check" for="pe_x${j}_knee"><input type="checkbox" id="pe_x${j}_knee" data-pknee="${j}" ${x.knee ? "checked" : ""}> Knee-sensitive</label>
          </div>
          <div class="pe-btns">
            <button class="ghost tiny" data-pmove="${j}:-1" ${j === 0 ? "disabled" : ""} aria-label="Move lift ${j + 1} up">&uarr; Up</button>
            <button class="ghost tiny" data-pmove="${j}:1" ${j === last ? "disabled" : ""} aria-label="Move lift ${j + 1} down">&darr; Down</button>
            <button class="ghost tiny danger" data-pdel="${j}">Remove</button>
          </div>
        </li>`).join("")}
      </ol>
      <button class="ghost" id="pe_add">+ Add lift</button>
      <h3 class="pe-h">Cardio finisher</h3>
      <div class="pe-stack">
        <label class="field" for="pe_cname"><span>Name</span><input id="pe_cname" value="${esc(d.cardio.name)}" placeholder="e.g. Cycling - 15-20 min" autocomplete="off"></label>
        <label class="field" for="pe_cdetail"><span>Details</span><textarea id="pe_cdetail" rows="2">${esc(d.cardio.detail)}</textarea></label>
      </div>`;
    $("planGeneral").innerHTML = `
      <h2>Every day</h2>
      <div class="pe-grid">
        <label class="field" for="pe_goal"><span>Daily step goal</span><input id="pe_goal" type="number" inputmode="numeric" min="1" step="500" value="${PLAN.stepGoal}"></label>
        <label class="field" for="pe_tempo"><span>Lift tempo</span><input id="pe_tempo" value="${esc(PLAN.tempo)}" placeholder="3:1:2:1" autocomplete="off"></label>
      </div>
      <div class="pe-grid">
        <label class="field" for="pe_goalw"><span>Goal weight (kg)</span><input id="pe_goalw" type="number" inputmode="decimal" min="0" step="0.1" value="${PLAN.goalWeight ?? ""}" placeholder="optional"></label>
        <label class="field" for="pe_rate"><span>Target loss a week (% of body weight)</span><input id="pe_rate" type="number" inputmode="decimal" min="0" step="0.1" value="${PLAN.weeklyRatePct ?? ""}" placeholder="optional, e.g. 0.7"></label>
        <label class="field" for="pe_klim"><span>Knee pain limit (0 to 10)</span><input id="pe_klim" type="number" inputmode="numeric" min="0" max="10" step="1" value="${PLAN.kneeLimit}"></label>
      </div>
      <label class="field" for="pe_warm"><span>Warm-ups, one per line</span><textarea id="pe_warm" rows="7">${esc(PLAN.warmups.join("\n"))}</textarea></label>
      <p class="note">Your history follows each lift by its name, so renaming a lift starts a fresh history for it. Days you've already logged keep what you logged.</p>
      <div class="pe-btns"><button class="ghost danger" id="pe_reset">Reset to the default plan</button></div>`;

    $("pe_name").oninput = (ev) => { d.name = ev.target.value; planChanged(); };
    $("pe_focus").oninput = (ev) => { d.focus = ev.target.value; planChanged(); };
    $("planDay").querySelectorAll("[data-px]").forEach((c) => c.oninput = () => {
      const [j, f] = c.dataset.px.split(":");
      d.exercises[+j][f] = c.value;
      planChanged();
      if (f === "name") checkPlanDay();
    });
    $("planDay").querySelectorAll("[data-pmove]").forEach((b) => b.onclick = () => {
      const [j, dir] = b.dataset.pmove.split(":").map(Number), k = j + dir;
      [d.exercises[j], d.exercises[k]] = [d.exercises[k], d.exercises[j]];
      planChanged(true);
    });
    $("planDay").querySelectorAll("[data-pdel]").forEach((b) => b.onclick = () => {
      const j = +b.dataset.pdel, nm = d.exercises[j].name.trim() || "this lift";
      if (!confirm(`Remove ${nm} from ${DOW[editDay]}? Days you've already logged keep it.`)) return;
      d.exercises.splice(j, 1);
      planChanged(true);
    });
    $("planDay").querySelectorAll("[data-pknee]").forEach((c) => c.onchange = () => { d.exercises[+c.dataset.pknee].knee = c.checked; planChanged(); });
    $("pe_add").onclick = () => {
      d.exercises.push({ name: "", sets: "3", reps: "10-12", cue: "", flag: "", step: "", knee: false });
      planChanged(true);
      $(`pe_x${d.exercises.length - 1}_name`).focus();
    };
    $("pe_cname").oninput = (ev) => { d.cardio.name = ev.target.value; planChanged(); };
    $("pe_cdetail").oninput = (ev) => { d.cardio.detail = ev.target.value; planChanged(); };
    $("pe_goal").oninput = (ev) => { const v = Math.round(+ev.target.value); if (v > 0) { PLAN.stepGoal = v; planChanged(); } };
    $("pe_tempo").oninput = (ev) => { PLAN.tempo = ev.target.value; planChanged(); };
    $("pe_goalw").oninput = (ev) => { const v = num(ev.target.value); PLAN.goalWeight = v > 0 ? v : null; planChanged(); };
    $("pe_rate").oninput = (ev) => { const v = num(ev.target.value); PLAN.weeklyRatePct = v > 0 ? v : null; planChanged(); };
    $("pe_klim").oninput = (ev) => { const v = num(ev.target.value); if (Number.isInteger(v) && v >= 0 && v <= 10) { PLAN.kneeLimit = v; planChanged(); } };
    $("pe_warm").oninput = (ev) => { PLAN.warmups = [...new Set(ev.target.value.split("\n").map((s) => s.trim()).filter(Boolean))]; planChanged(); };
    $("pe_reset").onclick = () => {
      if (!confirm("Replace your plan with the default plan? Days you've already logged are kept.")) return;
      PLAN = copy(DEFAULT_PLAN);
      planChanged(true);
    };
    checkPlanDay();
  }

  /* ---------- data: local cache + Supabase ---------- */
  function persistLocal() { lsSet(CACHE_KEY, { user: user?.id, logs }); lsSet(PENDING_KEY, { user: user?.id, pending }); }
  function persistPlan() { lsSet(PLAN_KEY, { user: user?.id, plan: PLAN, dirty: planDirty }); }

  function save(day, data, immediate) {
    if (recBefore && day < recBefore.upTo) recBefore = null;
    logs[day] = data;
    pending[day] = data;
    persistLocal();
    renderSyncBar();
    immediate ? render() : renderLight();
    clearTimeout(flushTimer);
    flushTimer = setTimeout(flush, immediate ? 200 : 900);
  }

  async function flush() {
    if (flushing) { flushTimer = setTimeout(flush, 400); return; }
    const days = Object.keys(pending);
    if (!days.length || !user) return;
    if (!navigator.onLine) { setStatus("Offline. Saved on this phone, will sync"); renderSyncBar(); return; }
    flushing = true;
    setStatus("Saving…");
    const batch = days.map((d) => ({ user_id: user.id, day: d, data: pending[d] }));
    const { error } = await sb.from("logs").upsert(batch, { onConflict: "user_id,day" });
    flushing = false;
    if (error) { syncTrouble = true; setStatus("Not synced yet. Will retry"); renderSyncBar(); console.warn(error); flushTimer = setTimeout(flush, 15000); return; }
    syncTrouble = false;
    for (const b of batch) if (pending[b.day] === b.data) delete pending[b.day];
    persistLocal();
    renderSyncBar();
    setStatus(Object.keys(pending).length ? "Saving…" : "Saved");
  }

  async function pull() {
    if (!user || !navigator.onLine) return;
    const { data, error } = await sb.from("logs").select("day,data").order("day", { ascending: true }).limit(5000);
    if (error) { setStatus("Couldn't load. Showing saved copy"); console.warn(error); return; }
    const next = {};
    for (const r of data) next[r.day] = r.data;
    for (const d of Object.keys(pending)) next[d] = pending[d]; // local unsaved edits win
    logs = next;
    recBefore = null;
    persistLocal();
    if (view === "day") editing() ? renderLight() : render();
    else if (view === "dash") renderDash();
    if (!Object.keys(pending).length) setStatus("Synced");
  }

  async function flushPlan() {
    if (!planDirty || !user || planFlushing) return;
    if (!navigator.onLine) { setPlanMsg("Offline. Saved on this phone, will sync"); return; }
    planFlushing = true;
    const rev = planRev;
    const { error } = await sb.from("plans").upsert({ user_id: user.id, plan: normalizePlan(PLAN) }, { onConflict: "user_id" });
    planFlushing = false;
    clearTimeout(planTimer);
    if (error) { setPlanMsg("Not synced yet. Will retry"); console.warn(error); planTimer = setTimeout(flushPlan, 15000); return; }
    if (rev !== planRev) { planTimer = setTimeout(flushPlan, 400); return; } // edited while saving
    planDirty = false;
    persistPlan();
    setPlanMsg("Saved");
  }

  async function pullPlan() {
    if (!user || !navigator.onLine || planDirty) return;
    const { data, error } = await sb.from("plans").select("plan").eq("user_id", user.id).maybeSingle();
    if (error) { console.warn(error); return; }
    if (planDirty) return; // edited while loading
    PLAN = data?.plan ? normalizePlan(data.plan) : copy(DEFAULT_PLAN);
    persistPlan();
    if (editing()) return;
    if (view === "plan") renderPlanEditor(); else if (view === "dash") renderDash(); else render();
  }

  /* ---------- import / export ---------- */
  function exportData() {
    const rows = Object.keys(logs).sort().map((day) => ({ day, data: logs[day] }));
    const blob = new Blob([JSON.stringify(rows, null, 1)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `gym-log-${todayKey()}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    $("menuMsg").textContent = `Exported ${rows.length} days.`;
  }

  async function importData(file) {
    try {
      const rows = JSON.parse(await file.text());
      if (!Array.isArray(rows)) throw new Error("Expected a list of days");
      let n = 0;
      for (const r of rows) {
        if (!r || !/^\d{4}-\d{2}-\d{2}$/.test(r.day) || typeof r.data !== "object") continue;
        logs[r.day] = r.data; pending[r.day] = r.data; n++;
      }
      recBefore = null; persistLocal(); render(); await flush();
      $("menuMsg").textContent = `Imported ${n} day${n === 1 ? "" : "s"}.`;
    } catch (err) {
      $("menuMsg").textContent = "That file couldn't be imported: " + err.message;
    }
  }

  /* ---------- auth ---------- */
  async function onSignedIn(u) {
    user = u;
    $("whoami").textContent = "Signed in as " + (u.email || "you");
    const cache = lsGet(CACHE_KEY, null), pend = lsGet(PENDING_KEY, null), pc = lsGet(PLAN_KEY, null);
    logs = cache && cache.user === u.id ? cache.logs || {} : {};
    pending = pend && pend.user === u.id ? pend.pending || {} : {};
    recBefore = null; syncTrouble = false;
    const mine = pc && pc.user === u.id && pc.plan;
    PLAN = mine ? normalizePlan(pc.plan) : copy(DEFAULT_PLAN);
    planDirty = !!(mine && pc.dirty);
    view = "day";
    show("appView");
    render();
    renderSyncBar();
    openShortcut();
    // Ask Chrome to keep this site's storage, so edits waiting to sync can't be evicted.
    if (navigator.storage?.persist) navigator.storage.persisted().then((p) => p || navigator.storage.persist()).catch(() => {});
    setStatus(Object.keys(pending).length ? "Syncing…" : "Loading…");
    await Promise.all([flush(), flushPlan()]);
    await Promise.all([pull(), pullPlan()]);
  }

  // Home-screen shortcuts (manifest.webmanifest) open ./?go=today, weight or steps.
  function openShortcut() {
    const u = new URL(location.href), go = u.searchParams.get("go");
    if (!go) return;
    u.searchParams.delete("go");
    history.replaceState(null, "", u.pathname + u.search + u.hash);
    sel = todayKey();
    render();
    const f = go === "weight" || go === "steps" ? $(go) : null;
    if (f) { f.scrollIntoView({ block: "center" }); f.focus({ preventScroll: true }); }
  }

  function onSignedOut() {
    user = null; logs = {}; pending = {}; recBefore = null; syncTrouble = false;
    renderSyncBar();
    PLAN = copy(DEFAULT_PLAN); planDirty = false;
    view = "day"; acts = null;
    show("loginView");
    setStatus("");
  }

  /* ---------- boot ---------- */
  async function boot() {
    try {
      DEFAULT_PLAN = normalizePlan(await (await fetch("plan.json", { cache: "no-cache" })).json());
    } catch {
      $("bootView").hidden = true;
      document.body.insertAdjacentHTML("afterbegin", `<p class="panel">Couldn't load plan.json. Check your connection and reload.</p>`);
      return;
    }
    PLAN = copy(DEFAULT_PLAN);
    renderTempo();

    const cfg = window.GYMLOG_CONFIG || {};
    if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY || !window.supabase) { show("setupView"); return; }
    sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "pkce" }
    });

    $("loginForm").onsubmit = async (ev) => {
      ev.preventDefault();
      const email = $("email").value.trim();
      $("loginBtn").disabled = true;
      $("loginMsg").textContent = "Sending…";
      const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname } });
      $("loginBtn").disabled = false;
      $("loginMsg").textContent = error
        ? "Couldn't send the link: " + error.message
        : `Check ${email} for a sign-in link. Open it on this device.`;
    };
    $("menuBtn").onclick = () => { const m = $("menu"); m.hidden = !m.hidden; $("menuBtn").setAttribute("aria-expanded", String(!m.hidden)); };
    $("planBtn").onclick = openPlan;
    $("dashBtn").onclick = () => (view === "dash" ? closeDash() : openDash());
    $("planDone").onclick = closePlan;
    $("exportBtn").onclick = exportData;
    $("importBtn").onclick = () => $("importFile").click();
    $("importFile").onchange = (ev) => { const f = ev.target.files[0]; if (f) importData(f); ev.target.value = ""; };
    $("syncRetry").onclick = () => { clearTimeout(flushTimer); flush(); };
    $("signOutBtn").onclick = async () => { await Promise.all([flush(), flushPlan()]); await sb.auth.signOut(); };
    $("prevW").onclick = () => { sel = addDays(sel, -7); acts = null; render(); };
    $("nextW").onclick = () => { sel = addDays(sel, 7); acts = null; render(); };
    $("todayB").onclick = () => { sel = todayKey(); acts = null; render(); };

    sb.auth.onAuthStateChange((event, session) => {
      if (session?.user && session.user.id !== user?.id) onSignedIn(session.user);
      else if (!session && user) onSignedOut();
    });
    const { data } = await sb.auth.getSession();
    if (data.session?.user) { if (!user) onSignedIn(data.session.user); }
    else show("loginView");

    // keep in sync: when the app comes back to the foreground or the phone reconnects
    const sync = () => { flush().then(pull); flushPlan().then(pullPlan); };
    document.addEventListener("visibilitychange", () => { if (!document.hidden) sync(); });
    window.addEventListener("online", () => { setStatus("Back online. Syncing…"); renderSyncBar(); sync(); });
    window.addEventListener("offline", () => { setStatus("Offline. Changes stay on this phone"); renderSyncBar(); });
    // roll the date over if the app stays open past midnight
    setInterval(() => { const t = todayKey(); if (view === "day" && sel !== t && sel === addDays(t, -1) && !editing()) { sel = t; acts = null; render(); } }, 60000);
  }

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  }
  boot();
})();

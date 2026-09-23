/* Gym Log — installable web app backed by Supabase.
 * Data model: one row per (user, day) in table `logs`, with a JSON `data` column:
 *   { exercises: { "<planned exercise name>": {
 *       done: bool, kg: number|null,            // kg = heaviest set (also what older entries hold)
 *       sets?: [{ reps: number|null, kg: number|null }],
 *       skipped?: bool, reason?: string,        // skipped that day, e.g. machine busy
 *       swap?: string } },                      // did this exercise instead that day
 *     warmup: [names], cardio: bool, steps: number|null, weight: number|null, note: string }
 * Exercises are keyed by their planned name, so editing the plan never scrambles old logs.
 * The plan itself is one row per user in table `plans`; plan.json is the default until it's edited.
 */
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const CACHE_KEY = "gymlog.cache.v1";
  const PENDING_KEY = "gymlog.pending.v1";
  const PLAN_KEY = "gymlog.plan.v1";

  let DEFAULT_PLAN = null;  // plan.json
  let PLAN = null;          // the signed-in user's plan (a copy of DEFAULT_PLAN until they edit it)
  let sb = null;            // supabase client
  let user = null;          // signed-in user
  let logs = {};            // day -> data
  let pending = {};         // day -> data not yet saved to Supabase
  let sel = todayKey();
  let flushTimer = null, flushing = false;
  let planDirty = false, planRev = 0, planTimer = null, planFlushing = false;
  let view = "day";         // "day" or "plan" (the plan editor)
  let editDay = 0;          // weekday open in the plan editor
  let acts = null;          // open lift menu: { day, name, mode: "menu" | "swap" }

  /* ---------- small helpers ---------- */
  function pad(n) { return String(n).padStart(2, "0"); }
  function keyOf(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function todayKey() { return keyOf(new Date()); }
  function parseKey(k) { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); }
  function addDays(k, n) { const d = parseKey(k); d.setDate(d.getDate() + n); return keyOf(d); }
  function wdIndex(k) { return (parseKey(k).getDay() + 6) % 7; }
  function planFor(k) { return PLAN.days[wdIndex(k)]; }
  function mondayOf(k) { return addDays(k, -wdIndex(k)); }
  function dayMonth(k) { return k.slice(8) + "/" + k.slice(5, 7); }
  function fmt(n) { return n == null || n === "" ? "–" : Number(n).toLocaleString("en-IN"); }
  function num(v) { return v === "" || v == null || isNaN(+v) ? null : +v; }
  function esc(s) { return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
  function setStatus(t) { $("status").textContent = t; }
  function setPlanMsg(t) { $("planMsg").textContent = t; }
  function lsGet(k, fb) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fb; } catch { return fb; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full or blocked */ } }
  function copy(v) { return JSON.parse(JSON.stringify(v)); }

  function entry(k) {
    const e = logs[k] || {};
    return {
      exercises: e.exercises || {},
      warmup: Array.isArray(e.warmup) ? e.warmup : [],
      cardio: !!e.cardio,
      steps: e.steps ?? null,
      weight: e.weight ?? null,
      note: e.note || ""
    };
  }
  function clone(k) { return copy(entry(k)); }
  function hasData(e) {
    return Object.keys(e.exercises).length || e.warmup.length || e.cardio || e.steps != null || e.weight != null || e.note;
  }

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
  // Placeholders show what you did last time, so there's something to beat.
  function placeholders(x, L, j) {
    const ls = L ? setsOf(L.r) : [], s = ls[j] || ls[ls.length - 1] || {};
    return [s.reps ?? (parseInt(x.reps, 10) || "–"), s.kg ?? "–"];
  }
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
    const goal = Math.round(+p?.stepGoal);
    return {
      tempo: typeof p?.tempo === "string" ? p.tempo : d ? d.tempo : "",
      stepGoal: goal > 0 ? goal : d ? d.stepGoal : 10000,
      warmups: Array.isArray(p?.warmups) ? [...new Set(p.warmups.map((w) => str(w).trim()).filter(Boolean))] : d ? d.warmups.slice() : [],
      days: DOW.map((wd, i) => {
        const s = (Array.isArray(p?.days) && p.days[i]) || d?.days[i] || {};
        return {
          weekday: wd,
          name: str(s.name).trim() || wd,
          focus: str(s.focus),
          exercises: (Array.isArray(s.exercises) ? s.exercises : [])
            .map((x) => ({ name: str(x?.name).trim(), sets: str(x?.sets), reps: str(x?.reps), cue: str(x?.cue), flag: str(x?.flag) }))
            .filter((x) => x.name),
          cardio: { name: str(s.cardio?.name), detail: str(s.cardio?.detail) }
        };
      })
    };
  }

  /* ---------- views ---------- */
  function show(v) {
    for (const id of ["setupView", "loginView", "appView", "planView"]) $(id).hidden = id !== v;
    $("menuBtn").hidden = v !== "appView";
    if (v !== "appView") { $("menu").hidden = true; $("menuBtn").setAttribute("aria-expanded", "false"); }
  }

  /* ---------- rendering ---------- */
  function dayState(k) {
    if (!logs[k]) return "";
    const p = planFor(k), e = entry(k);
    const need = p.exercises.length + 2;
    const got = p.exercises.filter((x) => e.exercises[x.name]?.done).length + (e.cardio ? 1 : 0) + ((e.steps || 0) >= PLAN.stepGoal ? 1 : 0);
    if (got >= need) return "done";
    return got > 0 || hasData(e) ? "part" : "";
  }

  function renderWeek() {
    const mon = mondayOf(sel), t = todayKey(), w = $("week");
    w.innerHTML = "";
    const f = (k) => parseKey(k).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
    $("weekLabel").textContent = f(mon) + " – " + f(addDays(mon, 6));
    for (let i = 0; i < 7; i++) {
      const k = addDays(mon, i), p = PLAN.days[i], b = document.createElement("button");
      b.className = "dchip " + dayState(k) + (k === sel ? " sel" : "") + (k === t ? " today" : "");
      b.innerHTML = `<span class="dw">${DOW[i]}</span><span class="dn">${parseKey(k).getDate()}</span><span class="dp"></span>`;
      b.querySelector(".dp").textContent = p.name;
      b.setAttribute("aria-label", `${DOW[i]} ${k}, ${p.name}`);
      b.onclick = () => { sel = k; acts = null; render(); };
      w.appendChild(b);
    }
  }

  function liftPill(p, e) {
    if (!p.exercises.length) return `<span class="pill">Rest day</span>`;
    const done = p.exercises.filter((x) => e.exercises[x.name]?.done).length;
    const skipped = p.exercises.filter((x) => e.exercises[x.name]?.skipped).length;
    const cls = done === p.exercises.length ? "good" : done ? "warn" : "";
    return `<span class="pill ${cls}">${done}/${p.exercises.length} lifts${skipped ? ` &middot; ${skipped} skipped` : ""}</span>`;
  }

  function liftHtml(it, i, e) {
    const { x, name, extra } = it, r = e.exercises[name] || {};
    const did = performed(name, r), L = lastDone(did, sel);
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
      : `<div class="sets">${Array.from({ length: rows }, (_, j) => {
          const s = sets[j] || {}, [phR, phK] = placeholders(x, L, j);
          return `<div class="set"><span class="sn">${j + 1}</span>
            <input id="s${i}_${j}_r" data-set="${i}:${j}:reps" type="number" inputmode="numeric" min="0" step="1" placeholder="${esc(phR)}" value="${s.reps ?? ""}" aria-label="${esc(did)}, set ${j + 1}, reps">
            <span class="x">&times;</span>
            <input id="s${i}_${j}_k" data-set="${i}:${j}:kg" type="number" inputmode="decimal" min="0" step="0.5" placeholder="${esc(phK)}" value="${s.kg ?? ""}" aria-label="${esc(did)}, set ${j + 1}, weight in kg">
            <span class="u">kg</span></div>`;
        }).join("")}
        <div class="setbtns"><button class="ghost tiny" data-addset="${i}">+ Set</button>${sets.length > min ? `<button class="ghost tiny" data-rmset="${i}">&minus; Set</button>` : ""}</div></div>`;

    return `<li class="${cls}"><div class="exrow"><label for="ex${i}">
        <input type="checkbox" id="ex${i}" data-i="${i}" ${r.done ? "checked" : ""} ${r.skipped ? "disabled" : ""}>
        <span><div class="nm">${esc(did)}${r.swap ? ` <span class="was">instead of ${esc(name)}</span>` : ""}</div>
          ${r.skipped || r.swap || !x.cue ? "" : `<div class="nt">${esc(x.cue)}</div>`}
          ${x.flag && !r.skipped && !r.swap ? `<div class="ch">${esc(x.flag)}</div>` : ""}
          ${extra ? `<div class="ch">Not in your current plan</div>` : ""}</span>
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
    el.innerHTML = `
      <div class="sess-head">
        <div><h2>${esc(p.name)}</h2><div class="sub">${esc(p.focus)} &middot; ${d.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}</div></div>
        <span id="liftPill">${liftPill(p, e)}</span>
      </div>
      <div class="wu"><h3>Warm-up <span style="text-transform:none;letter-spacing:0;font-weight:400">&middot; ${e.warmup.length} done</span></h3>
        <div class="chips">${wus.map((w, i) => `<label class="chip" for="wu${i}"><input type="checkbox" id="wu${i}" data-w="${esc(w)}" ${e.warmup.includes(w) ? "checked" : ""}><span>${esc(w)}</span></label>`).join("")}</div>
      </div>
      <ul class="ex">${items.map((it, i) => liftHtml(it, i, e)).join("")}</ul>
      <ul class="ex cardio"><li class="${e.cardio ? "checked" : ""}"><label for="cardio">
        <input type="checkbox" id="cardio" ${e.cardio ? "checked" : ""}>
        <span><div class="nm">${esc(p.cardio.name || "Cardio")}</div><div class="nt">${esc(p.cardio.detail)}</div></span><span class="sr">cardio</span>
      </label></li></ul>
      <div class="inputs">
        <label class="field" for="steps"><span>Steps</span>
          <input id="steps" type="number" inputmode="numeric" min="0" step="100" placeholder="0" value="${e.steps ?? ""}">
          <div class="bar"><i style="width:${Math.min(100, (e.steps || 0) / PLAN.stepGoal * 100)}%"></i></div>
        </label>
        <label class="field" for="weight"><span>Body weight (kg)</span>
          <input id="weight" type="number" inputmode="decimal" min="0" step="0.1" placeholder="optional" value="${e.weight ?? ""}">
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
      c.closest("li").querySelector(".hint").innerHTML = lastHint(performed(it.name, r), sel, r.kg);
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
    $("cardio").onchange = (ev) => { const n = clone(sel); n.cardio = ev.target.checked; save(sel, n, true); };
    $("steps").oninput = () => {
      const n = clone(sel), v = $("steps").value;
      n.steps = v === "" ? null : Math.max(0, Math.round(+v));
      el.querySelector(".bar i").style.width = Math.min(100, (n.steps || 0) / PLAN.stepGoal * 100) + "%";
      save(sel, n, false);
    };
    $("weight").oninput = () => { const n = clone(sel), v = $("weight").value; n.weight = v === "" ? null : Math.round(+v * 10) / 10; save(sel, n, false); };
    $("note").oninput = () => { const n = clone(sel); n.note = $("note").value; save(sel, n, false); };
  }

  function renderStats() {
    const mon = mondayOf(sel);
    let sess = 0, gymDays = 0, cardio = 0, steps = 0, stepDays = 0;
    for (let i = 0; i < 7; i++) {
      const k = addDays(mon, i), p = PLAN.days[i], e = entry(k);
      if (p.exercises.length) { gymDays++; if (p.exercises.every((x) => e.exercises[x.name]?.done)) sess++; }
      if (e.cardio) cardio++;
      if (e.steps != null) { steps += e.steps; stepDays++; }
    }
    const avg = stepDays ? Math.round(steps / stepDays) : null;
    $("stats").innerHTML = [
      [sess + "/" + gymDays, "gym sessions complete"],
      [cardio + "/7", "cardio finishers"],
      [fmt(avg), "avg steps / logged day"],
      [fmt(steps), "total steps"]
    ].map(([v, l]) => `<div class="stat"><div class="v num">${v}</div><div class="l">${l}</div></div>`).join("");
  }

  function renderChart() {
    const pts = Object.keys(logs).sort().filter((k) => logs[k].weight != null).map((k) => [k, logs[k].weight]);
    const el = $("chart");
    if (pts.length < 2) {
      el.innerHTML = `<p class="empty">Log your weight on two or more days to see the trend.${pts.length ? ` Latest: <span class="num">${pts[0][1]} kg</span>.` : ""}</p>`;
      return;
    }
    const W = 700, H = 180, L = 44, R = 14, T = 12, B = 26;
    const ys = pts.map((p) => p[1]);
    const lo = Math.floor(Math.min(...ys) - 0.5), hi = Math.ceil(Math.max(...ys) + 0.5);
    const x = (i) => L + i * (W - L - R) / (pts.length - 1), y = (v) => T + (hi - v) * (H - T - B) / (hi - lo);
    const ticks = [lo, (lo + hi) / 2, hi];
    const path = pts.map((p, i) => (i ? "L" : "M") + x(i).toFixed(1) + " " + y(p[1]).toFixed(1)).join(" ");
    const area = path + ` L${x(pts.length - 1).toFixed(1)} ${H - B} L${L} ${H - B} Z`;
    const last = pts[pts.length - 1], first = pts[0], diff = (last[1] - first[1]).toFixed(1);
    el.innerHTML = `<p class="sub" style="margin-bottom:6px"><span class="num">${last[1]} kg</span> now &middot; <span class="num">${diff > 0 ? "+" : ""}${diff} kg</span> since ${parseKey(first[0]).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</p>
    <svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Body weight trend">
      ${ticks.map((t) => `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" stroke="var(--line)"/><text x="${L - 6}" y="${y(t) + 4}" text-anchor="end">${t.toFixed(1)}</text>`).join("")}
      <path d="${area}" fill="var(--good-soft)"/>
      <path d="${path}" fill="none" stroke="var(--good)" stroke-width="2"/>
      <circle cx="${x(pts.length - 1)}" cy="${y(last[1])}" r="4" fill="var(--good)"/>
      <text x="${L}" y="${H - 6}">${first[0].slice(5)}</text><text x="${W - R}" y="${H - 6}" text-anchor="end">${last[0].slice(5)}</text>
    </svg>`;
  }

  function renderHist() {
    const rows = [], t = todayKey();
    for (let i = 0; i < 14; i++) {
      const k = addDays(t, -i), p = planFor(k), e = entry(k);
      const exDone = p.exercises.filter((x) => e.exercises[x.name]?.done).length;
      rows.push(`<tr><td class="num">${k.slice(5)} ${DOW[wdIndex(k)]}</td><td>${esc(p.name)}</td>
        <td class="r num">${p.exercises.length ? exDone + "/" + p.exercises.length : "–"}</td><td>${e.cardio ? "&check;" : "–"}</td>
        <td class="r num">${fmt(e.steps)}</td><td class="r num">${e.weight ?? "–"}</td></tr>`);
    }
    $("hist").innerHTML = `<table><thead><tr><th>Date</th><th>Session</th><th class="r">Lifts</th><th>Cardio</th><th class="r">Steps</th><th class="r">kg</th></tr></thead><tbody>${rows.join("")}</tbody></table>`;
  }

  function renderTempo() {
    $("tempoNote").textContent = PLAN.tempo
      ? `Tempo on every lift: ${PLAN.tempo} (seconds down, pause, up, pause). Warm up at 60–75% of working weight before the first main lift.`
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
          <label class="field" for="pe_x${j}_flag"><span>Note shown in orange (optional)</span><input id="pe_x${j}_flag" data-px="${j}:flag" value="${esc(x.flag)}" placeholder="e.g. KNEE NOTE: pain-free range only" autocomplete="off"></label>
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
    $("pe_add").onclick = () => {
      d.exercises.push({ name: "", sets: "3", reps: "10-12", cue: "", flag: "" });
      planChanged(true);
      $(`pe_x${d.exercises.length - 1}_name`).focus();
    };
    $("pe_cname").oninput = (ev) => { d.cardio.name = ev.target.value; planChanged(); };
    $("pe_cdetail").oninput = (ev) => { d.cardio.detail = ev.target.value; planChanged(); };
    $("pe_goal").oninput = (ev) => { const v = Math.round(+ev.target.value); if (v > 0) { PLAN.stepGoal = v; planChanged(); } };
    $("pe_tempo").oninput = (ev) => { PLAN.tempo = ev.target.value; planChanged(); };
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
    logs[day] = data;
    pending[day] = data;
    persistLocal();
    immediate ? render() : renderLight();
    clearTimeout(flushTimer);
    flushTimer = setTimeout(flush, immediate ? 200 : 900);
  }

  async function flush() {
    if (flushing) { flushTimer = setTimeout(flush, 400); return; }
    const days = Object.keys(pending);
    if (!days.length || !user) return;
    if (!navigator.onLine) { setStatus("Offline — saved on this phone, will sync"); return; }
    flushing = true;
    setStatus("Saving…");
    const batch = days.map((d) => ({ user_id: user.id, day: d, data: pending[d] }));
    const { error } = await sb.from("logs").upsert(batch, { onConflict: "user_id,day" });
    flushing = false;
    if (error) { setStatus("Not synced yet — will retry"); console.warn(error); flushTimer = setTimeout(flush, 15000); return; }
    for (const b of batch) if (pending[b.day] === b.data) delete pending[b.day];
    persistLocal();
    setStatus(Object.keys(pending).length ? "Saving…" : "Saved");
  }

  async function pull() {
    if (!user || !navigator.onLine) return;
    const { data, error } = await sb.from("logs").select("day,data").order("day", { ascending: true }).limit(5000);
    if (error) { setStatus("Couldn't load — showing saved copy"); console.warn(error); return; }
    const next = {};
    for (const r of data) next[r.day] = r.data;
    for (const d of Object.keys(pending)) next[d] = pending[d]; // local unsaved edits win
    logs = next;
    persistLocal();
    if (view === "day") editing() ? renderLight() : render();
    if (!Object.keys(pending).length) setStatus("Synced");
  }

  async function flushPlan() {
    if (!planDirty || !user || planFlushing) return;
    if (!navigator.onLine) { setPlanMsg("Offline — saved on this phone, will sync"); return; }
    planFlushing = true;
    const rev = planRev;
    const { error } = await sb.from("plans").upsert({ user_id: user.id, plan: normalizePlan(PLAN) }, { onConflict: "user_id" });
    planFlushing = false;
    clearTimeout(planTimer);
    if (error) { setPlanMsg("Not synced yet — will retry"); console.warn(error); planTimer = setTimeout(flushPlan, 15000); return; }
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
    view === "plan" ? renderPlanEditor() : render();
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
      persistLocal(); render(); await flush();
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
    const mine = pc && pc.user === u.id && pc.plan;
    PLAN = mine ? normalizePlan(pc.plan) : copy(DEFAULT_PLAN);
    planDirty = !!(mine && pc.dirty);
    view = "day";
    show("appView");
    render();
    setStatus(Object.keys(pending).length ? "Syncing…" : "Loading…");
    await Promise.all([flush(), flushPlan()]);
    await Promise.all([pull(), pullPlan()]);
  }

  function onSignedOut() {
    user = null; logs = {}; pending = {};
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
    $("planDone").onclick = closePlan;
    $("exportBtn").onclick = exportData;
    $("importFile").onchange = (ev) => { const f = ev.target.files[0]; if (f) importData(f); ev.target.value = ""; };
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
    window.addEventListener("online", () => { setStatus("Back online — syncing…"); sync(); });
    window.addEventListener("offline", () => setStatus("Offline — changes stay on this phone"));
    // roll the date over if the app stays open past midnight
    setInterval(() => { const t = todayKey(); if (view === "day" && sel !== t && sel === addDays(t, -1) && !editing()) { sel = t; acts = null; render(); } }, 60000);
  }

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  }
  boot();
})();

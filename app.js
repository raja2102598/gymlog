/* Gym Log — installable web app backed by Supabase.
 * Data model: one row per (user, day) in table `logs`, with a JSON `data` column:
 *   { exercises: { "<exercise name>": { done: bool, kg: number|null } },
 *     warmup: [names], cardio: bool, steps: number|null, weight: number|null, note: string }
 * Exercises are keyed by name, so editing plan.json never scrambles old logs.
 */
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const CACHE_KEY = "gymlog.cache.v1";
  const PENDING_KEY = "gymlog.pending.v1";

  let PLAN = null;          // loaded from plan.json
  let sb = null;            // supabase client
  let user = null;          // signed-in user
  let logs = {};            // day -> data
  let pending = {};         // day -> data not yet saved to Supabase
  let sel = todayKey();
  let flushTimer = null, flushing = false;

  /* ---------- small helpers ---------- */
  function pad(n) { return String(n).padStart(2, "0"); }
  function keyOf(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function todayKey() { return keyOf(new Date()); }
  function parseKey(k) { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); }
  function addDays(k, n) { const d = parseKey(k); d.setDate(d.getDate() + n); return keyOf(d); }
  function wdIndex(k) { return (parseKey(k).getDay() + 6) % 7; }
  function planFor(k) { return PLAN.days[wdIndex(k)]; }
  function mondayOf(k) { return addDays(k, -wdIndex(k)); }
  function fmt(n) { return n == null || n === "" ? "–" : Number(n).toLocaleString("en-IN"); }
  function esc(s) { return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
  function setStatus(t) { $("status").textContent = t; }
  function lsGet(k, fb) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fb; } catch { return fb; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full or blocked */ } }

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
  function clone(k) { const e = entry(k); return JSON.parse(JSON.stringify(e)); }
  function hasData(e) {
    return Object.keys(e.exercises).length || e.warmup.length || e.cardio || e.steps != null || e.weight != null || e.note;
  }

  /* ---------- views ---------- */
  function show(view) {
    for (const v of ["setupView", "loginView", "appView"]) $(v).hidden = v !== view;
    $("menuBtn").hidden = view !== "appView";
    if (view !== "appView") $("menu").hidden = true;
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
      b.onclick = () => { sel = k; render(); };
      w.appendChild(b);
    }
  }

  function lastLoad(name, before) {
    const ks = Object.keys(logs).filter((k) => k < before).sort().reverse();
    for (const k of ks) {
      const x = logs[k].exercises?.[name];
      if (x && x.kg != null) return [k, x.kg];
    }
    return null;
  }
  function lastHint(name, k, cur) {
    const L = lastLoad(name, k);
    if (!L) return `<span class="last">first time</span>`;
    const up = cur != null && cur > L[1];
    return `<span class="last${up ? " up" : ""}">last ${L[1]} kg &middot; ${L[0].slice(8)}/${L[0].slice(5, 7)}${up ? " &uarr;" : ""}</span>`;
  }

  function renderSession() {
    const p = planFor(sel), e = entry(sel), el = $("session"), d = parseKey(sel);
    const exDone = p.exercises.filter((x) => e.exercises[x.name]?.done).length;
    const pill = p.exercises.length
      ? `<span class="pill ${exDone === p.exercises.length ? "good" : exDone ? "warn" : ""}">${exDone}/${p.exercises.length} lifts</span>`
      : `<span class="pill">Rest day</span>`;
    el.innerHTML = `
      <div class="sess-head">
        <div><h2>${esc(p.name)}</h2><div class="sub">${esc(p.focus)} &middot; ${d.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}</div></div>
        ${pill}
      </div>
      <div class="wu"><h3>Warm-up <span style="text-transform:none;letter-spacing:0;font-weight:400">&middot; ${e.warmup.length} done</span></h3>
        <div class="chips">${PLAN.warmups.map((w, i) => `<label class="chip" for="wu${i}"><input type="checkbox" id="wu${i}" data-w="${esc(w)}" ${e.warmup.includes(w) ? "checked" : ""}><span>${esc(w)}</span></label>`).join("")}</div>
      </div>
      <ul class="ex">${p.exercises.map((x, i) => {
        const r = e.exercises[x.name] || {};
        return `<li class="${r.done ? "checked" : ""}"><div class="exrow"><label for="ex${i}">
          <input type="checkbox" id="ex${i}" data-i="${i}" ${r.done ? "checked" : ""}>
          <span><div class="nm">${esc(x.name)}</div><div class="nt">${esc(x.cue)}</div>${x.flag ? `<div class="ch">${esc(x.flag)}</div>` : ""}</span>
        </label>
        <div class="load">
          <span class="sr">${esc(x.sets)} &times; ${esc(x.reps)}</span>
          <span class="kg"><input id="ld${i}" data-l="${i}" type="number" inputmode="decimal" min="0" step="0.5" placeholder="–" aria-label="Weight used for ${esc(x.name)} in kg" value="${r.kg ?? ""}"><span class="u">kg</span></span>
          ${lastHint(x.name, sel, r.kg ?? null)}
        </div></div></li>`;
      }).join("")}</ul>
      <ul class="ex cardio"><li class="${e.cardio ? "checked" : ""}"><label for="cardio">
        <input type="checkbox" id="cardio" ${e.cardio ? "checked" : ""}>
        <span><div class="nm">${esc(p.cardio.name)}</div><div class="nt">${esc(p.cardio.detail)}</div></span><span class="sr">cardio</span>
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

    el.querySelectorAll("input[data-w]").forEach((c) => c.onchange = () => {
      const n = clone(sel), w = c.dataset.w;
      n.warmup = n.warmup.filter((x) => x !== w);
      if (c.checked) n.warmup.push(w);
      n.warmup.sort((a, b) => PLAN.warmups.indexOf(a) - PLAN.warmups.indexOf(b));
      save(sel, n, true);
    });
    el.querySelectorAll("input[data-i]").forEach((c) => c.onchange = () => {
      const n = clone(sel), name = p.exercises[+c.dataset.i].name;
      n.exercises[name] = { ...(n.exercises[name] || { kg: null }), done: c.checked };
      save(sel, n, true);
    });
    el.querySelectorAll("input[data-l]").forEach((c) => c.oninput = () => {
      const n = clone(sel), name = p.exercises[+c.dataset.l].name;
      const v = c.value === "" ? null : Math.round(+c.value * 2) / 2;
      n.exercises[name] = { ...(n.exercises[name] || { done: false }), kg: v };
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

  function render() { renderWeek(); renderSession(); renderStats(); renderChart(); renderHist(); }
  function renderLight() { renderWeek(); renderStats(); renderChart(); renderHist(); }
  function editing() { const a = document.activeElement; return a && /^(steps|weight|note|ld\d+)$/.test(a.id); }

  /* ---------- data: local cache + Supabase ---------- */
  function persistLocal() { lsSet(CACHE_KEY, { user: user?.id, logs }); lsSet(PENDING_KEY, { user: user?.id, pending }); }

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
    editing() ? renderLight() : render();
    if (!Object.keys(pending).length) setStatus("Synced");
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
    const cache = lsGet(CACHE_KEY, null), pend = lsGet(PENDING_KEY, null);
    logs = cache && cache.user === u.id ? cache.logs || {} : {};
    pending = pend && pend.user === u.id ? pend.pending || {} : {};
    show("appView");
    render();
    setStatus(Object.keys(pending).length ? "Syncing…" : "Loading…");
    await flush();
    await pull();
  }

  function onSignedOut() {
    user = null; logs = {}; pending = {};
    show("loginView");
    setStatus("");
  }

  /* ---------- boot ---------- */
  async function boot() {
    try {
      PLAN = await (await fetch("plan.json", { cache: "no-cache" })).json();
    } catch {
      document.body.insertAdjacentHTML("afterbegin", `<p class="panel">Couldn't load plan.json. Check your connection and reload.</p>`);
      return;
    }
    $("tempoNote").textContent = `Tempo on every lift: ${PLAN.tempo} (seconds down, pause, up, pause). Warm up at 60–75% of working weight before the first main lift.`;

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
    $("exportBtn").onclick = exportData;
    $("importFile").onchange = (ev) => { const f = ev.target.files[0]; if (f) importData(f); ev.target.value = ""; };
    $("signOutBtn").onclick = async () => { await flush(); await sb.auth.signOut(); };
    $("prevW").onclick = () => { sel = addDays(sel, -7); render(); };
    $("nextW").onclick = () => { sel = addDays(sel, 7); render(); };
    $("todayB").onclick = () => { sel = todayKey(); render(); };

    sb.auth.onAuthStateChange((event, session) => {
      if (session?.user && session.user.id !== user?.id) onSignedIn(session.user);
      else if (!session && user) onSignedOut();
    });
    const { data } = await sb.auth.getSession();
    if (data.session?.user) { if (!user) onSignedIn(data.session.user); }
    else show("loginView");

    // keep in sync: when the app comes back to the foreground or the phone reconnects
    document.addEventListener("visibilitychange", () => { if (!document.hidden) { flush().then(pull); } });
    window.addEventListener("online", () => { setStatus("Back online — syncing…"); flush().then(pull); });
    window.addEventListener("offline", () => setStatus("Offline — changes stay on this phone"));
    // roll the date over if the app stays open past midnight
    setInterval(() => { const t = todayKey(); if (sel !== t && sel === addDays(t, -1) && !editing()) { sel = t; render(); } }, 60000);
  }

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  }
  boot();
})();

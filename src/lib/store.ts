/* The app's data and sync engine, outside React so its timing (debounced saves, retries, offline queue)
 * doesn't depend on rendering. Screens subscribe with useGym() and call the actions here.
 *
 * Everything is kept on the phone first (localStorage) and saved to Supabase in the background: `pending`
 * holds days not yet saved, and a failed save retries every 15 seconds. */
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./config";
import { addDays, DOW, keyOf, mondayOf, todayKey, wdIndex } from "./dates";
import { DEFAULT_PLAN, normalizePlan } from "./plan";
import * as S from "./stats";
import { CACHE_KEY, copy, lsGet, lsSet, PENDING_KEY, PLAN_KEY } from "./storage";
import { EXTRA_FIELDS, type DayKey, type DayLog, type LiftLog, type Plan, type PlanDay, type PlanExercise, type SetLog } from "./types";

export type AuthState = "starting" | "setup" | "signedOut" | "signedIn";
export type DayState = "" | "done" | "part" | "miss";
export interface LiftItem {
  x: PlanExercise;
  name: string;
  /** Logged that day but no longer in the plan. */
  extra: boolean;
}
export interface LastDone {
  day: DayKey;
  r: LiftLog;
}
export interface NextWeight extends S.NextStep {
  day: DayKey;
  /** Held back because the knee was sore after that session. */
  held: boolean;
}

const isSlot = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) < 7;
export const minSets = (x: PlanExercise) => {
  const n = parseInt(x.sets, 10);
  return n > 0 ? Math.min(n, 10) : 1;
};
// Older entries have only one weight per lift: show it as set 1.
export const setsOf = (r?: LiftLog | null): SetLog[] => (Array.isArray(r?.sets) ? r.sets : r?.kg != null ? [{ reps: null, kg: r.kg }] : []);
export const topKg = (sets: SetLog[]) => {
  const ks = sets.map((s) => s.kg).filter((k): k is number => k != null);
  return ks.length ? Math.max(...ks) : null;
};
export const performed = (name: string, r?: LiftLog | null) => r?.swap || name;
const liftHasData = (r?: LiftLog | null) => !!r && (r.done || !!r.skipped || !!r.swap || setsOf(r).some((s) => s.reps != null || s.kg != null));
export const stepOf = (x: PlanExercise) => {
  const v = parseFloat(x.step);
  return v > 0 ? v : 2.5;
};
export const PR_WORDS: Record<S.RecordKind, string> = { weight: "heaviest yet", e1rm: "best estimated 1RM", reps: "most reps at this weight" };
export const prTitle = (kinds?: S.RecordKind[]) => (kinds ? "Personal record: " + kinds.map((k) => PR_WORDS[k]).join(", ") : "");

export class GymStore {
  plan: Plan = copy(DEFAULT_PLAN);
  logs: Record<DayKey, DayLog> = {};
  /** Days changed on this phone and not yet saved to Supabase. */
  pending: Record<DayKey, DayLog> = {};
  user: User | null = null;
  auth: AuthState = "starting";
  status = "";
  planMsg = "Changes save as you type.";
  planDirty = false;
  /** The last save to Supabase failed. */
  syncTrouble = false;
  online = true;
  /** Bumped when the plan's shape changes, so the plan editor's fields reload. */
  planShape = 0;
  sb: SupabaseClient | null = null;

  private planRev = 0;
  private flushTimer: ReturnType<typeof setTimeout> | undefined;
  private flushing = false;
  private planTimer: ReturnType<typeof setTimeout> | undefined;
  private planFlushing = false;
  private recBefore: { upTo: DayKey; best: S.RecordFold } | null = null;
  private sorted: { rev: number; keys: DayKey[] } | null = null;
  private logsRev = 0;
  private version = 0;
  private listeners = new Set<() => void>();
  private started = false;

  /* ---------- subscription (for useSyncExternalStore) ---------- */
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  getVersion = () => this.version;
  private changed() {
    this.version++;
    for (const fn of this.listeners) fn();
  }
  private logsChanged() {
    this.logsRev++;
    this.recBefore = null;
  }
  setStatus(t: string) {
    this.status = t;
    this.changed();
  }
  private setPlanMsg(t: string) {
    this.planMsg = t;
    this.changed();
  }

  /** Connects to Supabase and follows sign-in, connectivity and the app coming back to the front. Runs once, in the browser. */
  start() {
    if (this.started) return;
    this.started = true;
    this.online = navigator.onLine;
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      this.auth = "setup";
      this.changed();
      return;
    }
    const sb = (this.sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "pkce" },
    }));
    sb.auth.onAuthStateChange((_event, session) => {
      if (session?.user && session.user.id !== this.user?.id) void this.onSignedIn(session.user);
      else if (!session && this.user) this.onSignedOut();
    });
    void sb.auth.getSession().then(({ data }) => {
      if (data.session?.user) {
        if (!this.user) void this.onSignedIn(data.session.user);
      } else if (!this.user) {
        this.auth = "signedOut";
        this.changed();
      }
    });
    // Keep in sync when the app comes back to the foreground or the phone reconnects.
    const sync = () => {
      void this.flush().then(() => this.pull());
      void this.flushPlan().then(() => this.pullPlan());
    };
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) sync();
    });
    window.addEventListener("online", () => {
      this.online = true;
      this.setStatus("Back online. Syncing…");
      sync();
    });
    window.addEventListener("offline", () => {
      this.online = false;
      this.setStatus("Offline. Changes stay on this phone");
    });
  }

  /* ---------- auth ---------- */
  private async onSignedIn(u: User) {
    this.user = u;
    const cache = lsGet<{ user?: string; logs?: Record<DayKey, DayLog> } | null>(CACHE_KEY, null);
    const pend = lsGet<{ user?: string; pending?: Record<DayKey, DayLog> } | null>(PENDING_KEY, null);
    const pc = lsGet<{ user?: string; plan?: unknown; dirty?: boolean } | null>(PLAN_KEY, null);
    this.logs = cache && cache.user === u.id ? cache.logs || {} : {};
    this.pending = pend && pend.user === u.id ? pend.pending || {} : {};
    this.logsChanged();
    this.syncTrouble = false;
    const mine = !!(pc && pc.user === u.id && pc.plan);
    this.plan = mine ? normalizePlan(pc!.plan, DEFAULT_PLAN) : copy(DEFAULT_PLAN);
    this.planDirty = !!(mine && pc!.dirty);
    this.planShape++;
    this.auth = "signedIn";
    this.status = Object.keys(this.pending).length ? "Syncing…" : "Loading…";
    this.changed();
    // Ask Chrome to keep this site's storage, so edits waiting to sync can't be evicted.
    if (navigator.storage?.persist) navigator.storage.persisted().then((p) => p || navigator.storage.persist()).catch(() => {});
    await Promise.all([this.flush(), this.flushPlan()]);
    await Promise.all([this.pull(), this.pullPlan()]);
  }

  private onSignedOut() {
    this.user = null;
    this.logs = {};
    this.pending = {};
    this.logsChanged();
    this.syncTrouble = false;
    this.plan = copy(DEFAULT_PLAN);
    this.planDirty = false;
    this.planShape++;
    this.auth = "signedOut";
    this.status = "";
    this.changed();
  }

  async sendLink(email: string): Promise<string> {
    const { error } = await this.sb!.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname } });
    return error ? "Couldn't send the link: " + error.message : `Check ${email} for a sign-in link. Open it on this device.`;
  }

  async signOut() {
    await Promise.all([this.flush(), this.flushPlan()]);
    await this.sb?.auth.signOut();
  }

  /* ---------- reading a day ---------- */
  entry(k: DayKey): DayLog {
    const e = (this.logs[k] || {}) as Partial<DayLog>;
    const out: DayLog = {
      exercises: e.exercises || {},
      warmup: Array.isArray(e.warmup) ? e.warmup : [],
      cardio: !!e.cardio,
      steps: e.steps ?? null,
      weight: e.weight ?? null,
      note: e.note || "",
    };
    if (isSlot(e.session)) out.session = e.session;
    for (const f of EXTRA_FIELDS) if (e[f] != null) out[f] = e[f];
    return out;
  }
  clone(k: DayKey): DayLog {
    return copy(this.entry(k));
  }
  /** Logged days, oldest first. */
  days(): DayKey[] {
    if (!this.sorted || this.sorted.rev !== this.logsRev) this.sorted = { rev: this.logsRev, keys: Object.keys(this.logs).sort() };
    return this.sorted.keys;
  }
  // Which weekday's workout day k uses: its own, unless the day was switched to another one.
  slotFor(k: DayKey): number {
    const s = this.logs[k]?.session;
    return isSlot(s) ? s : wdIndex(k);
  }
  planFor(k: DayKey): PlanDay {
    return this.plan.days[this.slotFor(k)];
  }
  // Planned lifts for the day, plus anything logged that day that is no longer in the plan.
  liftsFor(k: DayKey): LiftItem[] {
    const p = this.planFor(k), e = this.entry(k);
    const items: LiftItem[] = p.exercises.map((x) => ({ x, name: x.name, extra: false }));
    const planned = new Set(items.map((it) => it.name));
    for (const [name, r] of Object.entries(e.exercises)) {
      if (!planned.has(name) && liftHasData(r)) items.push({ x: { name, sets: "", reps: "", cue: "", flag: "", step: "", knee: false }, name, extra: true });
    }
    return items;
  }
  // Most recent earlier day this exercise was actually done (as planned or as a swap).
  lastDone(name: string, before: DayKey): LastDone | null {
    const ks = this.days();
    for (let i = ks.length - 1; i >= 0; i--) {
      const k = ks[i];
      if (k >= before) continue;
      for (const [key, r] of Object.entries(this.logs[k].exercises || {})) {
        if (r && !r.skipped && performed(key, r) === name && setsOf(r).some((s) => s.reps != null || s.kg != null)) return { day: k, r };
      }
    }
    return null;
  }
  // Placeholders show what you did last time, so there's something to beat; when it's time to add
  // weight, they show the new weight at the bottom of the rep range.
  placeholders(x: PlanExercise, L: LastDone | null, j: number, next: NextWeight | null): [string, string] {
    if (next && !next.held) return [String(S.repRange(x.reps)![0]), String(next.to)];
    const ls = L ? setsOf(L.r) : [], s = ls[j] || ls[ls.length - 1] || ({} as Partial<SetLog>);
    return [String(s.reps ?? (parseInt(x.reps, 10) || "-")), String(s.kg ?? "-")];
  }
  worked(k: DayKey): boolean {
    return Object.values(this.entry(k).exercises).some((r) => r.done || setsOf(r).some((s) => s.reps != null));
  }
  // Gym sessions planned for days before today in k's week that no day of that week has done,
  // or taken over for today or later.
  missedThisWeek(k: DayKey): number[] {
    const mon = mondayOf(k), t = todayKey(), days = DOW.map((_, i) => addDays(mon, i));
    const covered = (s: number) => days.some((d) => this.slotFor(d) === s && (this.worked(d) || (d >= t && this.logs[d]?.session === s)));
    return days.map((d, i) => (d < t && d < k && this.plan.days[i].exercises.length && !covered(i) ? i : -1)).filter((i) => i >= 0);
  }
  // First day worth showing in history: the earliest log or the day the account was created.
  firstDay(): DayKey {
    const created = this.user?.created_at ? keyOf(new Date(this.user.created_at)) : null;
    return [this.days()[0], created, todayKey()].filter((v): v is string => !!v).sort()[0];
  }
  // Workout status of a day, the same as the dashboard calendar: every planned lift done, some, or missed.
  // Steps and cardio have their own counts, so they don't colour the day.
  dayState(k: DayKey, start = this.firstDay()): DayState {
    const p = this.planFor(k);
    if (!p.exercises.length || k < start) return "";
    const n = p.exercises.filter((x) => this.entry(k).exercises[x.name]?.done).length;
    if (n === p.exercises.length) return "done";
    if (n || this.worked(k)) return "part";
    return k < todayKey() ? "miss" : "";
  }
  // Planned gym sessions done in the week starting `mon`: each counts once, on whichever day it was done.
  weekSessions(mon: DayKey) {
    const days = DOW.map((_, i) => addDays(mon, i));
    const gym = this.plan.days.map((p, s) => (p.exercises.length ? s : -1)).filter((s) => s >= 0);
    const done = gym.filter((s) => days.some((k) => this.slotFor(k) === s && this.plan.days[s].exercises.every((x) => this.entry(k).exercises[x.name]?.done))).length;
    return { days, done, planned: gym.length };
  }
  weightSeries(): S.TrendPoint[] {
    return S.weightTrend(this.days().filter((k) => this.logs[k].weight != null).map((k) => [k, +(this.logs[k].weight as number)]));
  }
  swapSuggestions(exclude: string): string[] {
    const s = new Set<string>();
    for (const d of this.plan.days) for (const x of d.exercises) s.add(x.name);
    for (const k of this.days()) for (const r of Object.values(this.logs[k].exercises || {})) if (r?.swap) s.add(r.swap);
    s.delete(exclude);
    return [...s].sort((a, b) => a.localeCompare(b));
  }

  /* ---------- knee, next weight and records ---------- */
  kneeLifts(p: PlanDay) {
    return p.exercises.filter((x) => x.knee);
  }
  kneeDay(k: DayKey) {
    return this.kneeLifts(this.planFor(k)).length > 0;
  }
  // Pain-monitoring model: a session was hard on the knee when pain after it or on waking the next
  // morning passed the limit, or the knee hadn't settled back to its pre-session level by morning.
  kneeBad(k: DayKey): boolean {
    const e = this.entry(k), w = this.entry(addDays(k, 1)).kneeWake, lim = this.plan.kneeLimit;
    return [e.kneeAfter, w].some((v) => v != null && v > lim) || (w != null && e.kneeBefore != null && w > e.kneeBefore);
  }
  // Double progression from the last time this exercise was done, held back on knee-sensitive lifts
  // when that session was hard on the knee.
  nextWeight(x: PlanExercise, did: string, k: DayKey): NextWeight | null {
    const L = this.lastDone(did, k);
    const r = L && S.readyToAdd(setsOf(L.r), x.reps, minSets(x), stepOf(x));
    return r && L ? { ...r, day: L.day, held: !!x.knee && this.kneeBad(L.day) } : null;
  }
  liftSets(d: DayKey) {
    return Object.entries(this.logs[d]?.exercises || {})
      .filter(([, r]) => r && !r.skipped)
      .map(([key, r]) => ({ name: performed(key, r), sets: setsOf(r) }));
  }
  // Records set in the `n` days up to and including k. Earlier days are only folded in, not checked.
  recentRecords(k: DayKey, n: number): S.LiftRecord[] {
    const from = addDays(k, -n), best: S.RecordFold = new Map(), out: S.LiftRecord[] = [];
    for (const d of this.days()) {
      if (d > k) break;
      const day = { day: d, lifts: this.liftSets(d) };
      if (d > from) out.push(...S.checkDay(best, day));
      S.foldDay(best, day);
    }
    return out;
  }
  // Records set on day k, as "exercise|set index" -> kinds. The fold of the days before k is kept, so
  // typing a set re-checks only that day; saving an earlier day, or loading new logs, drops it.
  recordsOn(k: DayKey): Map<string, S.RecordKind[]> {
    if (!this.recBefore || this.recBefore.upTo !== k) {
      const best: S.RecordFold = new Map();
      for (const d of this.days()) {
        if (d >= k) break;
        S.foldDay(best, { day: d, lifts: this.liftSets(d) });
      }
      this.recBefore = { upTo: k, best };
    }
    return new Map(S.checkDay(this.recBefore.best, { day: k, lifts: this.liftSets(k) }).map((r) => [`${r.name}|${r.set}`, r.kinds]));
  }

  /* ---------- saving a day ---------- */
  save(day: DayKey, data: DayLog, immediate: boolean) {
    if (this.recBefore && day < this.recBefore.upTo) this.recBefore = null;
    if (!(day in this.logs)) this.logsRev++;
    this.logs[day] = data;
    this.pending[day] = data;
    this.persistLocal();
    clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => void this.flush(), immediate ? 200 : 900);
    this.changed();
  }
  /** Applies a change to a copy of a day and saves it. */
  editDay(day: DayKey, fn: (n: DayLog) => void, immediate: boolean): DayLog {
    const n = this.clone(day);
    fn(n);
    this.save(day, n, immediate);
    return n;
  }
  /** Applies a change to one lift of a day and saves it. */
  editLift(day: DayKey, name: string, fn: (r: LiftLog) => void, immediate: boolean): LiftLog {
    const n = this.clone(day);
    const r = n.exercises[name] || (n.exercises[name] = { done: false, kg: null });
    fn(r);
    this.save(day, n, immediate);
    return r;
  }

  private persistLocal() {
    lsSet(CACHE_KEY, { user: this.user?.id, logs: this.logs });
    lsSet(PENDING_KEY, { user: this.user?.id, pending: this.pending });
  }
  private persistPlan() {
    lsSet(PLAN_KEY, { user: this.user?.id, plan: this.plan, dirty: this.planDirty });
  }

  /** How many days wait on a failed save or on the phone being offline, or null when all is well. */
  syncWaiting(): { days: number; offline: boolean } | null {
    const days = Object.keys(this.pending).length, offline = !this.online;
    return this.user && days > 0 && (this.syncTrouble || offline) ? { days, offline } : null;
  }
  retrySync() {
    clearTimeout(this.flushTimer);
    void this.flush();
  }

  async flush(): Promise<void> {
    if (this.flushing) {
      this.flushTimer = setTimeout(() => void this.flush(), 400);
      return;
    }
    const days = Object.keys(this.pending);
    if (!days.length || !this.user || !this.sb) return;
    if (!navigator.onLine) {
      this.setStatus("Offline. Saved on this phone, will sync");
      return;
    }
    this.flushing = true;
    this.setStatus("Saving…");
    const batch = days.map((d) => ({ user_id: this.user!.id, day: d, data: this.pending[d] }));
    const { error } = await this.sb.from("logs").upsert(batch, { onConflict: "user_id,day" });
    this.flushing = false;
    if (error) {
      this.syncTrouble = true;
      this.setStatus("Not synced yet. Will retry");
      console.warn(error);
      this.flushTimer = setTimeout(() => void this.flush(), 15000);
      return;
    }
    this.syncTrouble = false;
    for (const b of batch) if (this.pending[b.day] === b.data) delete this.pending[b.day];
    this.persistLocal();
    this.setStatus(Object.keys(this.pending).length ? "Saving…" : "Saved");
  }

  async pull(): Promise<void> {
    if (!this.user || !navigator.onLine || !this.sb) return;
    const { data, error } = await this.sb.from("logs").select("day,data").order("day", { ascending: true }).limit(5000);
    if (error) {
      this.setStatus("Couldn't load. Showing saved copy");
      console.warn(error);
      return;
    }
    const next: Record<DayKey, DayLog> = {};
    for (const r of data as { day: DayKey; data: DayLog }[]) next[r.day] = r.data;
    for (const d of Object.keys(this.pending)) next[d] = this.pending[d]; // local unsaved edits win
    this.logs = next;
    this.logsChanged();
    this.persistLocal();
    if (!Object.keys(this.pending).length) this.status = "Synced";
    this.changed();
  }

  /* ---------- the plan ---------- */
  /** Changes the plan in place and saves it; `shape` when lifts were added, moved or removed. */
  editPlan(fn: (p: Plan) => void, shape = false) {
    fn(this.plan);
    this.planChanged(shape);
  }
  private planChanged(shape: boolean) {
    this.planRev++;
    this.planDirty = true;
    if (shape) this.planShape++;
    this.persistPlan();
    this.planMsg = "Saving…";
    clearTimeout(this.planTimer);
    this.planTimer = setTimeout(() => void this.flushPlan(), 800);
    this.changed();
  }
  resetPlan() {
    this.plan = copy(DEFAULT_PLAN);
    this.planChanged(true);
  }
  /** Leaving the plan editor: tidy the plan and save it now. */
  closePlan() {
    this.plan = normalizePlan(this.plan, DEFAULT_PLAN);
    this.planShape++;
    this.persistPlan();
    this.changed();
    void this.flushPlan();
  }

  async flushPlan(): Promise<void> {
    if (!this.planDirty || !this.user || this.planFlushing || !this.sb) return;
    if (!navigator.onLine) {
      this.setPlanMsg("Offline. Saved on this phone, will sync");
      return;
    }
    this.planFlushing = true;
    const rev = this.planRev;
    const { error } = await this.sb.from("plans").upsert({ user_id: this.user.id, plan: normalizePlan(this.plan, DEFAULT_PLAN) }, { onConflict: "user_id" });
    this.planFlushing = false;
    clearTimeout(this.planTimer);
    if (error) {
      this.setPlanMsg("Not synced yet. Will retry");
      console.warn(error);
      this.planTimer = setTimeout(() => void this.flushPlan(), 15000);
      return;
    }
    if (rev !== this.planRev) {
      this.planTimer = setTimeout(() => void this.flushPlan(), 400); // edited while saving
      return;
    }
    this.planDirty = false;
    this.persistPlan();
    this.setPlanMsg("Saved");
  }

  async pullPlan(): Promise<void> {
    if (!this.user || !navigator.onLine || this.planDirty || !this.sb) return;
    const { data, error } = await this.sb.from("plans").select("plan").eq("user_id", this.user.id).maybeSingle();
    if (error) {
      console.warn(error);
      return;
    }
    if (this.planDirty) return; // edited while loading
    const next = data?.plan ? normalizePlan(data.plan, DEFAULT_PLAN) : copy(DEFAULT_PLAN);
    // Unchanged (the usual case): leave the plan editor's fields alone, in case one is being typed in.
    if (JSON.stringify(next) === JSON.stringify(this.plan)) return;
    this.plan = next;
    this.planShape++;
    this.persistPlan();
    this.changed();
  }

  /* ---------- import / export ---------- */
  exportRows() {
    return this.days().map((day) => ({ day, data: this.logs[day] }));
  }
  async importFile(file: File): Promise<string> {
    try {
      const rows = JSON.parse(await file.text()) as unknown;
      if (!Array.isArray(rows)) throw new Error("Expected a list of days");
      let n = 0;
      for (const r of rows as { day?: unknown; data?: unknown }[]) {
        if (!r || typeof r.day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(r.day) || typeof r.data !== "object" || !r.data) continue;
        this.logs[r.day] = r.data as DayLog;
        this.pending[r.day] = r.data as DayLog;
        n++;
      }
      this.logsChanged();
      this.persistLocal();
      this.changed();
      await this.flush();
      return `Imported ${n} day${n === 1 ? "" : "s"}.`;
    } catch (err) {
      return "That file couldn't be imported: " + (err as Error).message;
    }
  }
}

let store: GymStore | null = null;
/** The one store for the page. */
export const getStore = () => (store ??= new GymStore());

/* The app's data and sync engine, outside React so its timing (debounced saves, retries, offline queue)
 * doesn't depend on rendering. Screens subscribe with useGym() and call the actions here.
 *
 * Everything is kept on the phone first (localStorage) and saved to Supabase in the background: `pending`
 * holds days not yet saved, and a failed save retries every 15 seconds. */
import { createClient, type Session, type SupabaseClient, type User } from "@supabase/supabase-js";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./config";
import { BACKUP_FORMAT, BACKUP_VERSION, backupWords, ImportError, readBackup, type Backup, type BackupContents, type CsvValue } from "./backup";
import { addDays, DOW, keyOf, mondayOf, todayKey, wdIndex } from "./dates";
import { DEFAULT_PLAN, normalizePlan } from "./plan";
import { canon } from "./health";
import * as S from "./stats";
import { APP_LOGIN_PAGE, GOOGLE_WEB_CLIENT_ID, isNative } from "./native";
import { CACHE_KEY, copy, HEALTH_KEY, lsGet, lsSet, PENDING_KEY, PLAN_KEY } from "./storage";
import { EXTRA_FIELDS, type DayKey, type DayLog, type HealthDay, type LiftLog, type Plan, type PlanDay, type PlanExercise, type SetLog } from "./types";

export type AuthState = "starting" | "setup" | "signedOut" | "signedIn";
/** Health Connect in the Android app: not there (the website), not set up, working, or what went wrong. */
export interface HealthLink {
  state: "web" | "unavailable" | "off" | "syncing" | "ok" | "error";
  msg: string;
}
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
/** What an import would replace: how many logged days the file has differently, and whether its plan differs. */
export interface Replacing {
  days: number;
  plan: boolean;
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

/** Why a sign-in link didn't work, and what to do, from the error Supabase or the auth client gave. */
function linkTrouble(e: { message: string; code?: string }): string {
  if (e.code === "otp_expired") return "That sign-in link has expired or was already used. Send a new one from this app.";
  if (e.code === "pkce_code_verifier_not_found" || e.code === "flow_state_not_found" || e.code === "flow_state_expired" || e.code === "bad_code_verifier")
    return "That link belongs to an older request or another phone. Send a new one from this app, and open the newest email on this phone.";
  return `That sign-in link didn’t work (${e.message.replace(/\.$/, "")}). Send a new one from this app, and open it on this phone.`;
}

/** Why Continue with Google didn't work, and what to do instead. */
function googleTrouble(e: { message: string; code?: string }): string {
  if (e.code === "provider_disabled" || /not enabled/i.test(e.message)) return "Google sign-in isn’t switched on yet. Sign in with your email for now.";
  return `Couldn’t sign in with Google: ${e.message.replace(/\.$/, "")}. Try again, or sign in with your email.`;
}

/** A sign-in that came back to this page with an error instead of a code (Google cancelled, a link expired, …). */
function returnedTrouble(q: URLSearchParams): string {
  const code = q.get("error_code") ?? undefined, desc = q.get("error_description") || q.get("error") || "";
  if (code === "otp_expired") return linkTrouble({ message: desc, code });
  if (q.get("error") === "access_denied") return "Sign-in was cancelled. Try again, or use another way below.";
  return `That sign-in didn’t work (${desc.replace(/\.$/, "")}). Try again.`;
}

/** How a session signed in ("password", "otp", …), from its access token's amr claim. */
export function signInMethods(accessToken: string): string[] {
  try {
    const body = JSON.parse(atob(accessToken.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))) as { amr?: { method?: string }[] };
    return (body.amr ?? []).map((a) => a.method ?? "");
  } catch {
    return [];
  }
}

export class GymStore {
  plan: Plan = copy(DEFAULT_PLAN);
  logs: Record<DayKey, DayLog> = {};
  /** Days changed on this phone and not yet saved to Supabase. */
  pending: Record<DayKey, DayLog> = {};
  /** Health Connect data by day, saved by the Android app. Apart from `logs`, so neither overwrites the other. */
  health: Record<DayKey, HealthDay> = {};
  /** When the Android app last saved Health Connect data (ISO), or null. */
  healthSyncedAt: string | null = null;
  healthLink: HealthLink = { state: "web", msg: "" };
  /** Why the last sign-in link didn't work, for the sign-in screen. */
  authMsg = "";
  user: User | null = null;
  /** The account has a password: one was set here (flagged in its metadata), or this session signed in with it. */
  hasPassword = false;
  /** Continue with Google is set up (Supabase has it on and, in the Android app, the client ID is set). */
  googleSignIn = false;
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
  private beforeSignOut: (() => Promise<unknown>)[] = [];

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
    this.readReturnedError();
    const sb = (this.sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      // Each emailed link carries the id of its own request (sb_flow_id), so asking for a second link, or one
      // that fails, can't leave the first without the key it needs. The redirect URLs allow the extra parameter.
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "pkce", experimental: { appendPkceFlowIdToRedirects: true } },
    }));
    sb.auth.onAuthStateChange((_event, session) => {
      if (session?.user && session.user.id !== this.user?.id) void this.onSignedIn(session.user, session);
      else if (session?.user && this.user && this.notePassword(session)) this.changed();
      else if (!session && this.user) this.onSignedOut();
    });
    void sb.auth.getSession().then(({ data }) => {
      if (data.session?.user) {
        if (!this.user) void this.onSignedIn(data.session.user, data.session);
      } else if (!this.user) {
        this.auth = "signedOut";
        this.changed();
        void this.loadSignInOptions();
      }
    });
    // Keep in sync when the app comes back to the foreground or the phone reconnects.
    const sync = () => {
      void this.flush().then(() => this.pull());
      void this.flushPlan().then(() => this.pullPlan());
      void this.pullHealth();
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
  /** On the website, a sign-in (Google, an email link) can come back with an error in the address instead of a code:
   *  say why on the sign-in screen, and take it out of the address. */
  private readReturnedError() {
    if (isNative()) return;
    const u = new URL(location.href), q = u.searchParams, h = new URLSearchParams(u.hash.slice(1));
    const from = q.has("error_description") || q.has("error") ? q : h.has("error_description") || h.has("error") ? h : null;
    if (!from || from.has("code")) return;
    this.authMsg = returnedTrouble(from);
    for (const k of ["error", "error_code", "error_description", "sb_flow_id"]) q.delete(k);
    const rest = q.toString();
    history.replaceState(history.state, "", u.pathname + (rest ? `?${rest}` : "") + (from === h ? "" : u.hash));
  }

  /** Whether to offer Continue with Google: Supabase says which ways in are switched on. Asked on the sign-in screen. */
  private async loadSignInOptions() {
    if (!this.sb || (isNative() && !GOOGLE_WEB_CLIENT_ID)) return;
    try {
      const r = await fetch(`${SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: SUPABASE_ANON_KEY } });
      const on = r.ok && (await r.json()).external?.google === true;
      if (on === this.googleSignIn) return;
      this.googleSignIn = on;
      this.changed();
    } catch {
      /* offline: no Google button until next time */
    }
  }

  /** Settings offers "Change password" once the account has one. A sign-in with the password proves it; the flag
   *  in the account's metadata remembers it for sign-ins with a link. Returns whether it just became known. */
  private notePassword(session: Session): boolean {
    const flagged = session.user.user_metadata?.has_password === true, used = signInMethods(session.access_token).includes("password");
    // After this auth event is handled: Supabase calls made inside one wait for it to finish.
    if (used && !flagged) setTimeout(() => void this.sb?.auth.updateUser({ data: { has_password: true } }), 0);
    if (this.hasPassword || !(flagged || used)) return false;
    this.hasPassword = true;
    return true;
  }

  private async onSignedIn(u: User, session: Session) {
    this.user = u;
    this.hasPassword = false;
    this.notePassword(session);
    const cache = lsGet<{ user?: string; logs?: Record<DayKey, DayLog> } | null>(CACHE_KEY, null);
    const pend = lsGet<{ user?: string; pending?: Record<DayKey, DayLog> } | null>(PENDING_KEY, null);
    const pc = lsGet<{ user?: string; plan?: unknown; dirty?: boolean } | null>(PLAN_KEY, null);
    const hc = lsGet<{ user?: string; health?: Record<DayKey, HealthDay>; at?: string | null } | null>(HEALTH_KEY, null);
    this.logs = cache && cache.user === u.id ? cache.logs || {} : {};
    this.health = hc && hc.user === u.id ? hc.health || {} : {};
    this.healthSyncedAt = hc && hc.user === u.id ? hc.at ?? null : null;
    this.authMsg = "";
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
    await Promise.all([this.pull(), this.pullPlan(), this.pullHealth()]);
  }

  private onSignedOut() {
    void this.loadSignInOptions();
    this.user = null;
    this.hasPassword = false;
    this.logs = {};
    this.pending = {};
    this.health = {};
    this.healthSyncedAt = null;
    this.logsChanged();
    this.syncTrouble = false;
    this.plan = copy(DEFAULT_PLAN);
    this.planDirty = false;
    this.planShape++;
    this.auth = "signedOut";
    this.status = "";
    this.authMsg = "";
    this.changed();
  }

  /** Emails a sign-in link. On the web it comes back to this page; in the Android app, to the site's
   *  app-login page, which hands it to the app (see src/native/app.ts). */
  async sendLink(email: string): Promise<{ sent: boolean; msg: string }> {
    const redirect = isNative() ? APP_LOGIN_PAGE : location.origin + location.pathname;
    this.authMsg = "";
    const { error } = await this.sb!.auth.signInWithOtp({ email, options: { emailRedirectTo: redirect } });
    if (!error) return { sent: true, msg: `Check ${email} for a sign-in link and open it on this ${isNative() ? "phone" : "device"}. If you ask for another, use the newest email.` };
    const wait = /after (\d+) seconds?/.exec(error.message)?.[1];
    if (wait) return { sent: false, msg: `Wait ${wait} seconds before asking for another link. The one already sent still works.` };
    if (error.code === "over_email_send_rate_limit" || error.status === 429)
      return { sent: false, msg: "Supabase only sends a few sign-in emails an hour, and they’re used up. Try again in an hour, or sign in with a password." };
    return { sent: false, msg: `Couldn’t send the link: ${error.message.replace(/\.$/, "")}. Check the address and your connection, then try again.` };
  }

  /** Finishes sign-in from a link that opened the Android app: ...://login?sb_flow_id=…&code=… */
  async finishSignIn(url: string): Promise<void> {
    // Signed in already: the same link again (say, from the app-login page's button) has nothing left to do.
    if (!this.sb || this.user) return;
    const u = new URL(url), q = u.searchParams, h = new URLSearchParams(u.hash.slice(1));
    const code = q.get("code"), flowId = q.get("sb_flow_id");
    const { error } = code
      ? await this.sb.auth.exchangeCodeForSession(code, flowId ? { flowId } : undefined)
      : { error: { message: q.get("error_description") || h.get("error_description") || "the link had no sign-in code", code: q.get("error_code") || h.get("error_code") || undefined } };
    if (error) {
      this.authMsg = linkTrouble(error);
      this.changed();
    }
  }

  /** Continue with Google on the website: off to Google's page, and back here signed in (as with an email link, the
   *  code in the address is exchanged for a session). Returns what to show if it can't start. */
  async signInWithGoogle(): Promise<string> {
    this.authMsg = "";
    const { error } = await this.sb!.auth.signInWithOAuth({ provider: "google", options: { redirectTo: location.origin + location.pathname } });
    return error ? googleTrouble(error) : "";
  }

  /** Finishes Continue with Google in the Android app, with the ID token from the phone's account sheet and the nonce
   *  its hash was made from. Returns what to show; empty once signed in. */
  async signInWithIdToken(token: string, nonce: string): Promise<string> {
    this.authMsg = "";
    const { error } = await this.sb!.auth.signInWithIdToken({ provider: "google", token, nonce });
    return error ? googleTrouble(error) : "";
  }

  /** Signs in with a password set in Settings. Returns what to show; empty once signed in. */
  async signInWithPassword(email: string, password: string): Promise<string> {
    this.authMsg = "";
    const { error } = await this.sb!.auth.signInWithPassword({ email, password });
    if (!error) return "";
    if (error.code === "invalid_credentials")
      return "That email and password don’t match. No password yet? Sign in with an email link, then set one in Settings.";
    return `Couldn’t sign in: ${error.message.replace(/\.$/, "")}. Check your connection, then try again.`;
  }

  /** Sets or changes the account's password, so you can sign in without waiting for an email. */
  async setPassword(password: string): Promise<{ ok: boolean; msg: string }> {
    const had = this.hasPassword;
    const { error } = await this.sb!.auth.updateUser({ password, data: { has_password: true } });
    if (!error || error.code === "same_password") {
      if (error) void this.sb!.auth.updateUser({ data: { has_password: true } });
      this.hasPassword = true;
      this.changed();
    }
    if (!error) return { ok: true, msg: had ? "Password changed." : "Password saved. Sign in with your email and this password, in the Android app too." };
    if (error.code === "same_password") return { ok: true, msg: "That’s already your password." };
    if (error.code === "weak_password") return { ok: false, msg: `Choose a stronger password: ${error.message.replace(/\.$/, "")}.` };
    if (error.code === "reauthentication_needed")
      return { ok: false, msg: "Supabase wants a fresh sign-in before a password change. Sign out, sign in again with an email link, then set it straight away." };
    return { ok: false, msg: `Couldn’t save the password: ${error.message.replace(/\.$/, "")}. Check your connection, then try again.` };
  }

  /** Runs `fn` on signing out, while the session still works. (The Android app turns background sync off.) */
  onSignOut(fn: () => Promise<unknown>) {
    this.beforeSignOut.push(fn);
  }

  async signOut() {
    await Promise.all([this.flush(), this.flushPlan(), ...this.beforeSignOut.map((fn) => fn().catch(() => {}))]);
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
  /** Health Connect's data for a day, or null. */
  healthOf(k: DayKey): HealthDay | null {
    return this.health[k] ?? null;
  }
  /** The day's steps: what you typed, or else Health Connect's count. */
  stepsOf(k: DayKey): number | null {
    return this.logs[k]?.steps ?? this.health[k]?.steps ?? null;
  }
  /** The day's weight: what you typed, or else Health Connect's first weigh-in. */
  weightOf(k: DayKey): number | null {
    return this.logs[k]?.weight ?? this.health[k]?.weight ?? null;
  }
  weightSeries(): S.TrendPoint[] {
    const days = [...new Set([...this.days(), ...Object.keys(this.health)])].sort();
    return S.weightTrend(days.filter((k) => this.weightOf(k) != null).map((k) => [k, +(this.weightOf(k) as number)]));
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
  private persistHealth() {
    lsSet(HEALTH_KEY, { user: this.user?.id, health: this.health, at: this.healthSyncedAt });
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
      this.setStatus("Couldn’t load. Showing saved copy");
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

  /* ---------- Health Connect ---------- */
  async pullHealth(): Promise<void> {
    if (!this.user || !navigator.onLine || !this.sb) return;
    const { data, error } = await this.sb.from("health_days").select("day,data,updated_at").order("day", { ascending: true }).limit(5000);
    if (error) {
      console.warn(error);
      return;
    }
    const next: Record<DayKey, HealthDay> = {};
    let at: string | null = null;
    for (const r of data as { day: DayKey; data: HealthDay; updated_at: string }[]) {
      next[r.day] = r.data;
      if (!at || r.updated_at > at) at = r.updated_at;
    }
    if (at === this.healthSyncedAt && canon(next) === canon(this.health)) return;
    this.health = next;
    this.healthSyncedAt = at;
    this.persistHealth();
    this.changed();
  }
  /** Saves days read from Health Connect on this phone; only days that changed are written. Returns how many. */
  async saveHealth(days: Record<DayKey, HealthDay>): Promise<number> {
    if (!this.user || !this.sb) return 0;
    // Compared key-order blind: rows read back from Supabase have jsonb's key order, not ours.
    const changed = Object.entries(days).filter(([k, d]) => canon(d) !== canon(this.health[k]));
    if (changed.length) {
      const { error } = await this.sb.from("health_days").upsert(
        changed.map(([day, data]) => ({ user_id: this.user!.id, day, data })),
        { onConflict: "user_id,day" },
      );
      if (error) throw error;
      for (const [k, d] of changed) this.health[k] = d;
    }
    this.healthSyncedAt = new Date().toISOString();
    this.persistHealth();
    this.changed();
    return changed.length;
  }
  setHealthLink(link: HealthLink) {
    this.healthLink = link;
    this.changed();
  }

  /* ---------- import / export ---------- */
  /** Export data: the plan, every logged day and the Health Connect days, as one versioned file (lib/backup.ts). */
  exportBackup(): Backup {
    const plan = normalizePlan(this.plan, DEFAULT_PLAN);
    return {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      // Null for the app's default plan, which is what an account that never saved one has.
      plan: JSON.stringify(plan) === JSON.stringify(DEFAULT_PLAN) ? null : plan,
      logs: this.days().map((day) => ({ day, data: this.logs[day] })),
      healthDays: Object.fromEntries(Object.keys(this.health).sort().map((k) => [k, this.health[k]])),
    };
  }
  /** Export workouts as CSV: a row for each set with reps or weight, oldest day first and lifts in the plan's order,
   *  under CSV_COLUMNS. A lift is its planned name; a swap names what was done instead. */
  workoutRows(): CsvValue[][] {
    const rows: CsvValue[][] = [];
    for (const day of this.days()) {
      const e = this.entry(day), session = this.planFor(day).name;
      for (const name of new Set(this.liftsFor(day).map((it) => it.name))) {
        const r = e.exercises[name];
        setsOf(r).forEach((s, j) => {
          if (s.reps != null || s.kg != null) rows.push([day, session, name, j + 1, s.reps, s.kg, !!r.skipped, r.swap ?? "", e.note]);
        });
      }
    }
    return rows;
  }
  /** Reads an export back in: its logged days and, from a backup, the plan and the Health Connect days. `replace` is
   *  asked first when the file would change days already logged or the plan. */
  async importFile(file: File, replace: (what: Replacing) => boolean): Promise<string> {
    let b: BackupContents;
    try {
      b = readBackup(await file.text());
    } catch (err) {
      const e = err instanceof ImportError ? err : new ImportError((err as Error).message);
      return `That file couldn’t be imported: ${e.message.replace(/\.$/, "")}. ${e.hint}`;
    }
    const days = b.logs.filter((r) => this.logs[r.day] && JSON.stringify(this.logs[r.day]) !== JSON.stringify(r.data)).length;
    const plan = b.plan ? normalizePlan(b.plan, DEFAULT_PLAN) : null;
    const newPlan = plan !== null && JSON.stringify(plan) !== JSON.stringify(normalizePlan(this.plan, DEFAULT_PLAN));
    if ((days || newPlan) && !replace({ days, plan: newPlan })) return "Import cancelled. Nothing changed.";
    for (const r of b.logs) {
      this.logs[r.day] = r.data;
      this.pending[r.day] = r.data;
    }
    this.logsChanged();
    this.persistLocal();
    // Saved the way the plan editor's Reset saves one, so it syncs.
    if (newPlan) {
      this.plan = plan;
      this.planChanged(true);
    }
    this.changed();
    const health = Object.keys(b.healthDays).length;
    const [saved] = await Promise.all([health ? this.restoreHealth(b.healthDays) : true, this.flush(), this.flushPlan()]);
    const done = `Imported ${backupWords(b.logs.length, !!plan, saved ? health : 0)}.`;
    return saved ? done : `${done} The Health Connect days couldn’t be saved: import the file again when you’re online.`;
  }
  /** Health Connect days from a backup, into Supabase: only the days it doesn't have, since the ones it has may be
   *  newer. This device's copy then comes from Supabase, as always. Returns whether they were saved; unsaved, none are
   *  kept here. */
  private async restoreHealth(days: Record<DayKey, HealthDay>): Promise<boolean> {
    if (!this.user || !this.sb || !navigator.onLine) return false;
    const uid = this.user.id;
    const rows = Object.entries(days).map(([day, data]) => ({ user_id: uid, day, data }));
    const { error } = await this.sb.from("health_days").upsert(rows, { onConflict: "user_id,day", ignoreDuplicates: true });
    if (error) {
      console.warn(error);
      return false;
    }
    await this.pullHealth();
    return true;
  }
}

let store: GymStore | null = null;
/** The one store for the page. */
export const getStore = () => (store ??= new GymStore());

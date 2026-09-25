/* The app's data and sync engine, outside React so its timing (debounced saves, retries, offline queue)
 * doesn't depend on rendering. Screens subscribe with useGym() and call the actions here.
 *
 * Everything is kept on the phone first (localStorage) and saved to Supabase in the background: `pending`
 * holds days not yet saved, and a failed save retries every 15 seconds. */
import { createClient, type Session, type SupabaseClient, type User } from "@supabase/supabase-js";
import { TEMPLATES } from "@/data/templates";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./config";
import { BACKUP_FORMAT, BACKUP_VERSION, backupWords, ImportError, readBackup, type Backup, type BackupContents, type CsvValue } from "./backup";
import { addDays, dayMonth, DOW, keyOf, mondayOf, todayKey, wdIndex } from "./dates";
import { createDemoSupabase } from "./demoSupabase";
import { CATALOGUE, closeMatches, customLift, EQUIPMENT, exerciseFor, gymCan, gymLacks, isBar, libraryLift, libraryNamed, loadOf, type Equip, type Exercise, type Load } from "./library";
import { DEFAULT_PLAN, DEFAULT_WEIGHTS, normalizeCustom, normalizeGym, normalizePlan, normalizeWeights, orderBlocks, planBlocks } from "./plan";
import { sampleDays } from "./sampleData";
import { canon } from "./health";
import * as S from "./stats";
import { APP_LOGIN_PAGE, GOOGLE_WEB_CLIENT_ID, isNative } from "./native";
import { CACHE_KEY, copy, HEALTH_KEY, lsDel, lsGet, lsSet, PENDING_KEY, PLAN_KEY, REST_KEY } from "./storage";
import { EXTRA_FIELDS, MEASURE_FIELDS, type CustomExercise, type DayKey, type Gym, type DayLog, type FreeWorkout, type HealthDay, type LiftLog, type MeasureField, type Plan, type PlanDay, type PlanExercise, type SetLog, type Weights } from "./types";

export type AuthState = "starting" | "setup" | "signedOut" | "signedIn";
/** Where the plan comes from: the account's own, saved in Supabase or kept on this phone from before ("server"); the
 *  default, because the account has none ("default"); or not known yet ("unknown": not loaded, or the load failed). */
export type PlanSource = "server" | "default" | "unknown";
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
/** The rest timer, shown in the top bar: counts from `endAt` down to zero, not from ticks, so a throttled background
 *  tab or a reload can't make it drift. Kept on this device only (REST_KEY): a timer only means something where
 *  you're actually lifting. */
export interface RestTimer {
  /** Which lift this rest follows and the day it was logged on, for the top bar's wording only: neither changes
   *  when a set restarts the timer, and switching screens or days never touches it. */
  lift: string;
  day: DayKey;
  /** Epoch ms it reaches zero, kept up to date whether running or paused (see pausedAt). */
  endAt: number;
  /** Epoch ms it was paused, or null while running: what's left is then endAt - pausedAt, frozen until resumed. */
  pausedAt: number | null;
  /** Reached zero and said so already (vibrated, marked for screen readers): stays true until skipped or a set
   *  restarts it, so that only happens once. */
  ended: boolean;
}
/** What an import would replace: how many logged days the file has differently, and whether its plan differs. */
export interface Replacing {
  days: number;
  plan: boolean;
}

const isSlot = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) < 7;
/** A day's free-form workout, when it has one that reads right: a name and a list of lift names. */
const freeOf = (d?: Partial<DayLog> | null): FreeWorkout | null => {
  const f = d?.free as Partial<FreeWorkout> | undefined;
  return f && typeof f === "object" && typeof f.name === "string" && Array.isArray(f.lifts) && f.lifts.every((n) => typeof n === "string") ? (f as FreeWorkout) : null;
};
/** What a free-form workout is called when it isn't given a name. */
export const FREE_NAME = "Free workout";
export const minSets = (x: { sets: string }) => {
  const n = parseInt(x.sets, 10);
  return n > 0 ? Math.min(n, 10) : 1;
};
/** The sets and reps to check a logged lift against: what it was actually asked for that day, once stored
 *  (LiftLog.target), else today's plan for it. A lift never logged that day, or logged before targets were
 *  stored, reads the plan, exactly as every lift did before. */
export const targetOf = (r: Partial<LiftLog> | null | undefined, x: PlanExercise): { sets: string; reps: string } => r?.target ?? { sets: x.sets, reps: x.reps };
// Older entries have only one weight per lift: show it as set 1.
export const setsOf = (r?: LiftLog | null): SetLog[] => (Array.isArray(r?.sets) ? r.sets : r?.kg != null ? [{ reps: null, kg: r.kg }] : []);
/** Heaviest working set: a warm-up never counts, however heavy. */
export const topKg = (sets: SetLog[]) => {
  const ks = sets.filter(S.isWorkingSet).map((s) => s.kg).filter((k): k is number => k != null);
  return ks.length ? Math.max(...ks) : null;
};
export const performed = (name: string, r?: LiftLog | null) => r?.swap || name;
const liftHasData = (r?: LiftLog | null) => !!r && (r.done || !!r.skipped || !!r.swap || setsOf(r).some((s) => s.reps != null || s.kg != null));
/** Whether `min` working sets have reps logged: warm-ups don't move it any closer. */
export const setsComplete = (sets: SetLog[], min: number) => sets.filter((s) => S.isStraightSet(s) && (s.reps ?? 0) > 0).length >= min;
/** A saved rest timer worth bringing back after a reload or a sign-in: not one that ran out over ten minutes ago,
 *  or was left paused for over an hour, which would only show a stale "Rest over" or countdown. */
export const liveRest = (r: RestTimer | null | undefined, now = Date.now()): RestTimer | null =>
  r && (r.pausedAt != null ? now - r.pausedAt < 3_600_000 : now - r.endAt < 600_000) ? r : null;
/** The rest timer's length for this lift, seconds: its own override (the plan editor's lift row), kept within
 *  5 s and 10 minutes as the plan's default is, or else the plan's. */
export const restSecFor = (plan: Plan, x: PlanExercise) => {
  const v = parseInt(x.rest ?? "", 10);
  return v > 0 ? Math.min(600, Math.max(5, v)) : plan.restSec;
};
export const PR_WORDS: Record<S.RecordKind, string> = { weight: "heaviest yet", e1rm: "best estimated 1RM", reps: "most reps at this weight" };
export const prTitle = (kinds?: S.RecordKind[]) => (kinds ? "Personal record: " + kinds.map((k) => PR_WORDS[k]).join(", ") : "");
/** A lift's next-weight hint, in words that name the rule behind it: what to do, the weight (bold on Today, empty
 *  for a knee hold, whose weight is in `lead`), and why. */
export function progWords(n: NextWeight): { lead: string; kg: string; why: string } {
  const kg = String(n.to);
  if (n.held) return { lead: `Hold ${n.from}\u00a0kg: your knee was sore after ${dayMonth(n.day)}.`, kg: "", why: "" };
  if (n.rule === "linear") return { lead: "Go up to ", kg, why: `: linear, +${Math.round((n.to - (n.from ?? n.to)) * 100) / 100}\u00a0kg a session while every set hits ${n.top} reps.` };
  if (n.rule === "percent") return { lead: "Work at ", kg, why: `: ${n.pct}% of your ${n.oneRm}\u00a0kg 1RM.` };
  if (n.rule === "deload") {
    const short = n.fails === 1 ? "last session fell short" : `${n.fails} sessions in a row fell short`;
    return { lead: "Deload to ", kg, why: `: ${short}, so ${n.off}% off ${n.from}\u00a0kg.` };
  }
  return { lead: "Go up to ", kg, why: `: every set hit ${n.top} reps last time.` };
}

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

/** A day's log with every field in place, as the screens read it: older rows can lack some. */
function fullDay(d?: Partial<DayLog> | null): DayLog {
  const e = d || {};
  const out: DayLog = {
    exercises: e.exercises || {},
    warmup: Array.isArray(e.warmup) ? e.warmup : [],
    cardio: !!e.cardio,
    steps: e.steps ?? null,
    weight: e.weight ?? null,
    note: e.note || "",
  };
  if (isSlot(e.session)) out.session = e.session;
  if (Array.isArray(e.order) && e.order.every((n) => typeof n === "string")) out.order = e.order;
  const free = freeOf(e);
  if (free) out.free = free;
  for (const f of EXTRA_FIELDS) if (e[f] != null) out[f] = e[f];
  return out;
}
/** The same day, whatever order its keys come in (Supabase's jsonb keeps its own order). */
const sameDay = (a: DayLog, b: DayLog) => canon(fullDay(a)) === canon(fullDay(b));

/** Two copies of a day that differ only in lifts one has and the other doesn't, made one: every lift of both.
 *  Null when they differ in anything else: a lift both have, the steps, the note, … */
export function mergeDays(mine: DayLog, theirs: DayLog): DayLog | null {
  const a = fullDay(mine), b = fullDay(theirs);
  if (canon({ ...a, exercises: {} }) !== canon({ ...b, exercises: {} })) return null;
  const lifts = { ...b.exercises };
  for (const [name, r] of Object.entries(a.exercises)) {
    if (Object.prototype.hasOwnProperty.call(lifts, name) && canon(lifts[name]) !== canon(r)) return null;
    lifts[name] = r;
  }
  return { ...a, exercises: lifts };
}

/** Postgres's answer to adding a row that's there already. */
const UNIQUE_VIOLATION = "23505";
/** Days new here are added this many to a request: a restore into a new account brings hundreds. */
const INSERT_CHUNK = 200;
/** Days saved one by one go this many at once. */
const SAVES_AT_ONCE = 4;
/** The updated_at a write returned, or null when it wrote nothing: another device changed the row first. */
const writtenAt = (rows: unknown) => (rows as { updated_at?: string }[] | null)?.[0]?.updated_at ?? null;
/** What the plan editor and Settings say while the plan waits for you to choose a version. */
const PLAN_HELD = "Not synced yet: the plan was changed on another device too.";
/** The library lift picked by hand for each name in the plans the app comes with (the default plan and the
 *  templates), by name in lower case: asked about first when a plan saved before the library uses the name. */
const SHIPPED = new Map<string, string>();
for (const p of [DEFAULT_PLAN, ...TEMPLATES.map((t) => t.plan)])
  for (const d of p.days) for (const x of d.exercises) if (x.lib && !SHIPPED.has(x.name.toLowerCase())) SHIPPED.set(x.name.toLowerCase(), x.lib);
/** The account a demo shows: not a real one, so nothing here is ever sent anywhere (GymStore.startDemo). */
const DEMO_USER: User = { id: "00000000-0000-0000-0000-000000000000", aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "" };

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
  /** Days changed here and on another device since this phone last had them, each with the other device's copy
   *  and its version, until you choose one. This phone's copy waits in `pending`. */
  conflicts: Record<DayKey, { data: DayLog; at: string }> = {};
  /** The plan, changed here and on another device: the other device's copy and its version, until you choose one. */
  planConflict: { plan: Plan; at: string } | null = null;
  /** Health Connect data by day, saved by the Android app. Apart from `logs`, so neither overwrites the other. */
  health: Record<DayKey, HealthDay> = {};
  /** When the Android app last saved Health Connect data (ISO), or null. */
  healthSyncedAt: string | null = null;
  healthLink: HealthLink = { state: "web", msg: "" };
  /** The rest timer. Null when none is running, paused or waiting to be dismissed. */
  rest: RestTimer | null = null;
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
  planSource: PlanSource = "unknown";
  /** Signed in, and the first load from Supabase since then hasn't finished. */
  firstLoad = false;
  /** The last save to Supabase failed. */
  syncTrouble = false;
  /** The phone wouldn't keep its copy of the days, plan or Health Connect data (storage full or blocked), so
   *  edits could be lost on reload. Stays set until each of those saves works again. */
  localSaveFailed = false;
  online = true;
  /** Bumped when the plan's shape changes, so the plan editor's fields reload. */
  planShape = 0;
  sb: SupabaseClient | null = null;
  /** Trying the app with sample data (GymStore.startDemo): fully signed in, but `sb` is a fake and nothing is
   *  written to the phone (see saveLocal). Screens use this to hide or refuse whatever needs a real account. */
  demo = false;
  /** The real client, set aside while the demo's fake stands in for it, and back on leaving the demo. */
  private liveSb: SupabaseClient | null = null;

  private planRev = 0;
  /** The logged days have been loaded from Supabase since signing in, not only read from this phone's copy. */
  private logsLoaded = false;
  private flushTimer: ReturnType<typeof setTimeout> | undefined;
  private flushing = false;
  private planTimer: ReturnType<typeof setTimeout> | undefined;
  private planFlushing = false;
  private restTimeout: ReturnType<typeof setTimeout> | undefined;
  private recBefore: { upTo: DayKey; best: S.RecordFold } | null = null;
  private sorted: { rev: number; keys: DayKey[] } | null = null;
  private logsRev = 0;
  private version = 0;
  private listeners = new Set<() => void>();
  private started = false;
  private beforeSignOut: (() => Promise<unknown>)[] = [];
  /** The storage keys whose last save on the phone failed. */
  private unsaved = new Set<string>();
  /** Each day's version on Supabase (its updated_at) that this phone's copy started from. Kept with the cache. */
  private bases: Record<DayKey, string> = {};
  /** The plan's version on Supabase that this phone's copy started from, or null while it has none there. */
  private planBase: string | null = null;

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
      // A real sign-in (a link opened in another tab, say) ends the demo; nothing else here concerns it.
      if (this.demo) {
        if (!session?.user) return;
        this.exitDemo();
      }
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
      if (!document.hidden) {
        sync();
        this.checkRest(); // a background tab can throttle the timer that would otherwise have caught this
      }
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

  /* ---------- demo mode ---------- */
  /** "Try it with sample data": skips Supabase entirely and drops straight into a signed-in, fully usable app,
   *  seeded like scripts/screenshots.mjs (lib/sampleData.js) with four weeks of history ending today. `sb` becomes
   *  a small fake (lib/demoSupabase.ts) that answers from this store's own fields, so flush, pull and the rest run
   *  unchanged and nothing ever reaches a network. Nothing here is written to the phone either (see saveLocal): the
   *  whole demo lives in memory, and a reload starts over at the sign-in screen. */
  startDemo() {
    if (this.demo || this.user) return;
    this.demo = true;
    this.liveSb = this.sb;
    this.sb = createDemoSupabase(this);
    const today = todayKey();
    this.user = { ...DEMO_USER, created_at: `${addDays(today, -27)}T05:00:00.000Z` };
    this.plan = copy(DEFAULT_PLAN);
    const { logs, health } = sampleDays(today, DEFAULT_PLAN.days);
    this.logs = logs;
    this.health = health;
    this.healthSyncedAt = new Date().toISOString();
    this.pending = {};
    this.conflicts = {};
    this.planConflict = null;
    this.planDirty = false;
    this.planSource = "server"; // acts as an account that already has its plan: no "choose a plan" first
    this.logsLoaded = true;
    this.firstLoad = false;
    this.hasPassword = false;
    this.syncTrouble = false;
    this.status = "Synced";
    this.logsChanged();
    this.planShape++;
    this.auth = "signedIn";
    this.changed();
  }

  /** Leaves the demo for the real sign-in screen, with the real client back in place so signing in works. There was
   *  never a real session to sign out of, so this is onSignedOut's own reset rather than a sign-out. A build with no
   *  Supabase project goes back to the setup screen it came from. */
  exitDemo() {
    if (!this.demo) return;
    this.demo = false;
    this.sb = this.liveSb;
    this.liveSb = null;
    this.onSignedOut();
    if (!this.sb) {
      this.auth = "setup";
      this.changed();
    }
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
    const cache = lsGet<{ user?: string; logs?: Record<DayKey, DayLog>; bases?: Record<DayKey, string> } | null>(CACHE_KEY, null);
    const pend = lsGet<{ user?: string; pending?: Record<DayKey, DayLog> } | null>(PENDING_KEY, null);
    const pc = lsGet<{ user?: string; plan?: unknown; dirty?: boolean; base?: string | null } | null>(PLAN_KEY, null);
    const hc = lsGet<{ user?: string; health?: Record<DayKey, HealthDay>; at?: string | null } | null>(HEALTH_KEY, null);
    const rc = lsGet<{ user?: string; rest?: RestTimer | null } | null>(REST_KEY, null);
    this.logs = cache && cache.user === u.id ? cache.logs || {} : {};
    this.bases = cache && cache.user === u.id ? cache.bases || {} : {};
    this.health = hc && hc.user === u.id ? hc.health || {} : {};
    this.healthSyncedAt = hc && hc.user === u.id ? hc.at ?? null : null;
    // A reload or a tab switch keeps the rest timer (this phone only: it never came from Supabase or another device).
    this.rest = rc && rc.user === u.id ? liveRest(rc.rest) : null;
    this.armRest();
    this.checkRest();
    this.authMsg = "";
    this.pending = pend && pend.user === u.id ? pend.pending || {} : {};
    // Not kept: the first save of such a day finds the other device's copy again.
    this.conflicts = {};
    this.logsChanged();
    this.syncTrouble = false;
    const mine = !!(pc && pc.user === u.id && pc.plan);
    this.plan = mine ? normalizePlan(pc!.plan, DEFAULT_PLAN) : copy(DEFAULT_PLAN);
    this.planDirty = !!(mine && pc!.dirty);
    this.planBase = mine ? pc!.base ?? null : null;
    this.planConflict = null;
    this.planShape++;
    this.planSource = mine ? "server" : "unknown";
    this.logsLoaded = false;
    this.firstLoad = true;
    this.auth = "signedIn";
    this.status = Object.keys(this.pending).length ? "Syncing…" : "Loading…";
    this.changed();
    // Ask Chrome to keep this site's storage, so edits waiting to sync can't be evicted.
    if (navigator.storage?.persist) navigator.storage.persisted().then((p) => p || navigator.storage.persist()).catch(() => {});
    try {
      await Promise.all([this.flush(), this.flushPlan()]);
      await Promise.all([this.pull(), this.pullPlan(), this.pullHealth()]);
    } finally {
      if (this.user === u) {
        this.firstLoad = false;
        this.changed();
      }
    }
  }

  private onSignedOut() {
    void this.loadSignInOptions();
    this.user = null;
    this.hasPassword = false;
    this.logs = {};
    this.pending = {};
    this.bases = {};
    this.conflicts = {};
    this.health = {};
    this.healthSyncedAt = null;
    this.disarmRest();
    // Taken off this phone too, so signing back in doesn't bring back a timer the sign-out put away. (Removed rather
    // than saved as none, so leaving the demo, which ends here too, leaves nothing behind.)
    this.rest = null;
    lsDel(REST_KEY);
    this.logsChanged();
    this.syncTrouble = false;
    this.unsaved.clear();
    this.localSaveFailed = false;
    this.plan = copy(DEFAULT_PLAN);
    this.planDirty = false;
    this.planBase = null;
    this.planConflict = null;
    this.planShape++;
    this.planSource = "unknown";
    this.logsLoaded = false;
    this.firstLoad = false;
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
    // A sign-in link opened during the demo ends it, and signs in.
    this.exitDemo();
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
    return fullDay(this.logs[k]);
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
  /** The day's workout: its planned session, or its free-form workout as one. A free-form workout's lifts are the
   *  ones added to it, each with the plan's settings for a lift of that name (its sets and reps, cue, step, knee)
   *  when the plan has one, and nothing planned otherwise; the cardio finisher stays the usual day's. */
  planFor(k: DayKey): PlanDay {
    const p = this.plan.days[this.slotFor(k)], f = freeOf(this.logs[k]);
    if (!f) return p;
    const blank = (name: string): PlanExercise => ({ name, sets: "", reps: "", cue: "", flag: "", step: "", knee: false });
    return { weekday: p.weekday, name: f.name.trim() || FREE_NAME, focus: "", exercises: f.lifts.map((name) => this.planLift(name) ?? blank(name)), cardio: p.cardio };
  }
  /** Whether day k is a free-form workout rather than a planned session. */
  isFree(k: DayKey): boolean {
    return !!freeOf(this.logs[k]);
  }
  /** The plan's settings for a lift of this name, on whichever day has it first; never part of a superset. */
  private planLift(name: string): PlanExercise | null {
    for (const d of this.plan.days)
      for (const x of d.exercises)
        if (x.name === name) {
          const y = { ...x };
          delete y.superset;
          return y;
        }
    return null;
  }
  /** The day's lifts as Today shows them, in blocks: a superset of the plan's is one block, its lifts in the plan's
   *  order, and any other lift a block of its own, as is anything logged that day that's no longer in the plan.
   *  Blocks follow the day's own order once a lift was moved (DayLog.order), else the plan's. */
  liftBlocks(k: DayKey, order: string[] | null = this.entry(k).order ?? null): LiftItem[][] {
    const p = this.planFor(k), e = this.entry(k);
    const blocks = planBlocks(p.exercises).map((b) => b.map((x): LiftItem => ({ x, name: x.name, extra: false })));
    const planned = new Set(p.exercises.map((x) => x.name));
    for (const [name, r] of Object.entries(e.exercises)) {
      if (!planned.has(name) && liftHasData(r)) blocks.push([{ x: { name, sets: "", reps: "", cue: "", flag: "", step: "", knee: false }, name, extra: true }]);
    }
    return order ? orderBlocks(blocks, order) : blocks;
  }
  // The day's lifts, one after another, in the order they're shown.
  liftsFor(k: DayKey): LiftItem[] {
    return this.liftBlocks(k).flat();
  }
  /** Moves block `b` of the day's lifts (a lift, or a superset whole) one place up or down, kept with the day as
   *  the order its lifts were done in. Back in the plan's order, the day keeps none. */
  moveBlock(k: DayKey, b: number, dir: -1 | 1) {
    const blocks = this.liftBlocks(k), to = b + dir;
    if (b < 0 || to < 0 || to >= blocks.length) return;
    [blocks[b], blocks[to]] = [blocks[to], blocks[b]];
    const order = blocks.flat().map((it) => it.name);
    const planOrder = this.liftBlocks(k, null).flat().map((it) => it.name);
    this.editDay(
      k,
      (n) => {
        if (order.join("\n") === planOrder.join("\n")) delete n.order;
        else n.order = order;
      },
      true,
    );
  }
  /* ---------- a free-form workout ---------- */
  /** Starts an empty free-form workout on day k, in place of its planned session. */
  startFree(k: DayKey) {
    this.editDay(
      k,
      (n) => {
        n.free = { name: "", lifts: [] };
      },
      true,
    );
  }
  setFreeName(k: DayKey, name: string) {
    this.editDay(
      k,
      (n) => {
        if (n.free) n.free.name = name;
      },
      false,
    );
  }
  /** Adds a lift to day k's free-form workout, by name: false when there's no name, or it's there already. */
  addFreeLift(k: DayKey, name: string): boolean {
    return this.addFreeLifts(k, [name]) > 0;
  }
  /** Adds lifts to day k's free-form workout, by name, in one save; says how many were new. */
  addFreeLifts(k: DayKey, names: string[]): number {
    const f = freeOf(this.logs[k]);
    const add = [...new Set(names.map((n) => n.trim()).filter((v) => v && !f?.lifts.includes(v)))];
    if (!f || !add.length) return 0;
    this.editDay(
      k,
      (n) => {
        n.free?.lifts.push(...add);
      },
      true,
    );
    return add.length;
  }
  /** Takes a lift out of day k's free-form workout, with anything logged for it. */
  removeFreeLift(k: DayKey, name: string) {
    this.editDay(
      k,
      (n) => {
        if (n.free) n.free.lifts = n.free.lifts.filter((x) => x !== name);
        delete n.exercises[name];
        if (n.order) n.order = n.order.filter((x) => x !== name);
      },
      true,
    );
  }
  /** Back to day k's planned session. What was logged in the free-form workout stays, as lifts outside the plan. */
  endFree(k: DayKey) {
    this.editDay(
      k,
      (n) => {
        delete n.free;
      },
      true,
    );
  }
  /** Names to offer when adding a lift: the plan's lifts, anything swapped in, every lift logged, and the exercise
   *  library's that your gym can do, less `except`. */
  liftSuggestions(except: string[] = []): string[] {
    const s = new Set<string>();
    for (const d of this.plan.days) for (const x of d.exercises) s.add(x.name);
    for (const k of this.days())
      for (const [name, r] of Object.entries(this.logs[k].exercises || {})) {
        s.add(name);
        if (r?.swap) s.add(r.swap);
      }
    for (const x of this.library()) if (this.canDo(x)) s.add(x.name);
    for (const x of except) s.delete(x);
    return [...s].sort((a, b) => a.localeCompare(b));
  }

  /* ---------- the exercise library ---------- */
  /** Every lift the library offers: your own, then the catalogue's. */
  library(): Exercise[] {
    return [...(this.plan.custom ?? []).map(customLift), ...CATALOGUE];
  }
  /** My gym, as the plan holds it: everything on until it's set. */
  gym(): Gym {
    return this.plan.gym ?? { off: [], always: [], never: [] };
  }
  /** Whether the library offers lift x: My gym can do it. */
  canDo(x: Exercise): boolean {
    return gymCan(x, this.plan.gym);
  }
  /** The equipment lift x needs that My gym hasn't got. */
  lacks(x: Exercise): Equip[] {
    return gymLacks(x, this.plan.gym);
  }
  /** Turns a piece of equipment on or off in My gym: all of it, without one. */
  setEquip(on: boolean, e?: Equip) {
    this.editPlan((p) => {
      const g = normalizeGym(p.gym);
      p.gym = normalizeGym({ ...g, off: !e ? (on ? [] : Object.keys(EQUIPMENT)) : on ? g.off.filter((x) => x !== e) : [...g.off, e] });
    });
  }
  /** Puts lifts, by library id, on My gym's always or never list and off the other; off both with null. */
  showLifts(ids: string[], list: "always" | "never" | null) {
    this.editPlan((p) => {
      const g = normalizeGym(p.gym), rest = (l: string[]) => l.filter((id) => !ids.includes(id));
      p.gym = normalizeGym({ off: g.off, always: list === "always" ? [...rest(g.always), ...ids] : rest(g.always), never: list === "never" ? [...rest(g.never), ...ids] : rest(g.never) });
    });
  }
  /* ---------- weights ---------- */
  /** My gym's weights beyond the barbell's: each its default until changed. */
  weights(): Weights {
    return this.plan.weights ?? DEFAULT_WEIGHTS;
  }
  /** Sets one of My gym's weights, kept in range as the plan is read (normalizeWeights). */
  setWeight(k: keyof Weights, kg: number) {
    this.editPlan((p) => {
      p.weights = normalizeWeights({ ...(p.weights ?? DEFAULT_WEIGHTS), [k]: kg });
    });
  }
  /** What lift `name` is loaded with: the plan lift's own pick (PlanExercise.load), else what the library says its
   *  equipment is; through the plan's lift of that name when `x` isn't given. Null for a lift that isn't known. */
  loadOf(name: string, x?: Pick<PlanExercise, "lib" | "load"> | null): Load | null {
    const y = x === undefined ? this.planLift(name) : x;
    return y?.load ?? loadOf(this.exerciseOf(name, y ?? null));
  }
  /** The bar a lift loaded with `l` goes on, kg, for its plates button and warm-up sets: each bar's own, nothing
   *  for a machine's plates, and null for what isn't loaded with plates (no plates button). A lift that isn't known
   *  goes on the barbell, as every lift did before My gym had weights. */
  barFor(l: Load | null): number | null {
    if (l === null || l === "barbell") return this.plan.barKg;
    if (l === "ezbar" || l === "trapbar" || l === "smith") return this.weights()[l];
    return l === "machine" ? 0 : null;
  }
  /** What a lift loaded with `l` can weigh: a bar and pairs of the smallest plate, or dumbbells, a stack, a cable or
   *  bands in their step from nothing. Null for bodyweight and a lift that isn't known, whose weights aren't
   *  rounded. */
  gridFor(l: Load | null): S.Grid | null {
    if (l === null || l === "body") return null;
    if (!isBar(l)) return { base: 0, inc: this.weights()[l] };
    const plates = this.plan.plateKgs.filter((p) => p > 0);
    return { base: this.barFor(l) ?? 0, inc: plates.length ? 2 * Math.min(...plates) : 2.5 };
  }
  /** What was done in plan lift x's place is loaded with: x's, or what it was swapped for (`did`). */
  loadDone(x: PlanExercise, did: string): Load | null {
    return did === x.name ? this.loadOf(x.name, x) : this.loadOf(did);
  }
  /** What lift x goes up by, kg: its own step, else a step of what it's loaded with, else 2.5 kg. */
  stepFor(x: PlanExercise, l: Load | null = this.loadOf(x.name, x)): number {
    const v = parseFloat(x.step);
    return v > 0 ? v : (this.gridFor(l)?.inc ?? 2.5);
  }

  /** Whether a name is a library lift's or one of your own exactly: then it says what the lift is, and a plan lift
   *  given it keeps no link to another. */
  namesALift(name: string): boolean {
    const key = name.trim().toLowerCase();
    return !!libraryNamed(key) || (this.plan.custom ?? []).some((c) => c.name.toLowerCase() === key);
  }
  /** A lift's exercise, when the library or your own lifts know it: through the plan's lift of that name when `x`
   *  isn't given. Null for an untagged lift. */
  exerciseOf(name: string, x?: Pick<PlanExercise, "lib"> | null): Exercise | null {
    return exerciseFor(name, this.plan.custom ?? [], x === undefined ? this.planLift(name) : x);
  }
  /** Saves a lift of your own, new or (`again`) changed, and says what's wrong, if anything. Its name stays its
   *  name: a plan lift of that name takes its muscles and equipment, since your own lifts are found by name. */
  saveCustom(c: CustomExercise, again = false): string {
    const name = c.name.trim(), key = name.toLowerCase(), lib = libraryNamed(name);
    if (!name) return "Give it a name.";
    if (lib) return `The library has ${lib.name}: pick it from the list instead.`;
    if (!again && (this.plan.custom ?? []).some((x) => x.name.toLowerCase() === key)) return `You have a lift called ${name} already.`;
    this.editPlan((p) => {
      p.custom = normalizeCustom([...(p.custom ?? []).filter((x) => x.name.toLowerCase() !== key), { ...c, name }]);
      // Your own lift is what a plan lift of that name is now, whatever library lift it pointed at.
      for (const d of p.days) for (const x of d.exercises) if (x.name.trim().toLowerCase() === key) delete x.lib;
    });
    return "";
  }
  /** Adds library lifts to plan day `day`, after its others, each with the usual 3 × 10-12 to start from; one
   *  already on the day, by name or pointed at, isn't added again. */
  addLibraryLifts(day: number, xs: Exercise[]) {
    this.editPlan((p) => {
      const ex = p.days[day].exercises;
      for (const x of xs)
        if (!ex.some((y) => y.name === x.name || (!x.custom && y.lib === x.id))) ex.push({ name: x.name, sets: "3", reps: "10-12", cue: "", flag: "", step: "", knee: false, rest: "", ...(x.custom ? {} : { lib: x.id }) });
    }, true);
  }
  /** Points every plan lift called `name` at library lift `x`. Your own lift is found by its name, so one of
   *  another name lends this one its muscles and equipment, as a lift of your own. */
  linkLift(name: string, x: Exercise) {
    if (x.custom && x.name.toLowerCase() !== name.trim().toLowerCase()) {
      this.saveCustom({ name, equip: x.equip, primary: x.primary, secondary: x.secondary }, true);
      return;
    }
    this.editPlan((p) => {
      for (const d of p.days)
        for (const y of d.exercises)
          if (y.name === name) {
            if (x.custom) delete y.lib;
            else y.lib = x.id;
          }
    });
  }
  /** The plan's lifts to ask about once: each not pointing at the library, not named exactly as one of its lifts
   *  and not one of your own, with the library lifts close to its name, best first: for a name from the plans the
   *  app comes with, the one picked for it by hand. Answered with linkLift or keepOwn. */
  libraryQuestions(): { name: string; like: Exercise[] }[] {
    const own = new Set((this.plan.custom ?? []).map((c) => c.name.toLowerCase())), all = this.plan.days.flatMap((d) => d.exercises);
    const names = [...new Set(all.map((x) => x.name.trim()).filter(Boolean))];
    return names
      .filter((name) => !own.has(name.toLowerCase()) && !all.some((x) => x.name.trim() === name && x.lib))
      .map((name) => {
        const known = libraryLift(SHIPPED.get(name.toLowerCase())), like = closeMatches(name);
        return { name, like: known ? [known, ...like.filter((x) => x !== known)].slice(0, 3) : like };
      })
      .filter((q) => q.like.length);
  }
  /** A plan lift that isn't the library's, kept as one of your own (untagged until you give it muscles). */
  keepOwn(name: string) {
    const v = name.trim();
    if (!v || (this.plan.custom ?? []).some((c) => c.name.toLowerCase() === v.toLowerCase())) return;
    this.editPlan((p) => {
      p.custom = normalizeCustom([...(p.custom ?? []), { name: v, equip: [], primary: [], secondary: [] }]);
    });
  }

  // Most recent earlier day this exercise was actually done (as planned or as a swap).
  lastDone(name: string, before: DayKey): LastDone | null {
    return this.doneBefore(name, before, 1)[0] ?? null;
  }
  // The `n` most recent days before `before` that this exercise was actually done, the latest first.
  doneBefore(name: string, before: DayKey, n: number): LastDone[] {
    const ks = this.days(), out: LastDone[] = [];
    for (let i = ks.length - 1; i >= 0 && out.length < n; i--) {
      const k = ks[i];
      if (k >= before) continue;
      for (const [key, r] of Object.entries(this.logs[k].exercises || {})) {
        if (r && !r.skipped && performed(key, r) === name && setsOf(r).some((s) => S.isWorkingSet(s) && (s.reps != null || s.kg != null))) {
          out.push({ day: k, r });
          break;
        }
      }
    }
    return out;
  }
  // Placeholders show what you did last time, so there's something to beat; when it's time to add
  // weight, they show the new weight at the bottom of the rep range.
  placeholders(x: PlanExercise, L: LastDone | null, j: number, next: NextWeight | null): [string, string] {
    const ls = L ? setsOf(L.r).filter(S.isWorkingSet) : [], s = ls[j] || ls[ls.length - 1] || ({} as Partial<SetLog>);
    const reps = String(s.reps ?? (parseInt(x.reps, 10) || "-"));
    if (next && !next.held) return [String(S.repRange(x.reps)?.[0] ?? reps), String(next.to)];
    return [reps, String(s.kg ?? "-")];
  }
  // Warm-ups alone don't count: a workout left after them wasn't done.
  worked(k: DayKey): boolean {
    return Object.values(this.entry(k).exercises).some((r) => r.done || setsOf(r).some((s) => S.isWorkingSet(s) && s.reps != null));
  }
  // Gym sessions planned for days before today in k's week that no day of that week has done,
  // or taken over for today or later.
  missedThisWeek(k: DayKey): number[] {
    const mon = mondayOf(k), t = todayKey(), days = DOW.map((_, i) => addDays(mon, i));
    // A free-form workout, even on a planned day, does none of the plan's sessions.
    const covered = (s: number) => days.some((d) => !this.isFree(d) && this.slotFor(d) === s && (this.worked(d) || (d >= t && this.logs[d]?.session === s)));
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
  // Planned gym sessions done in the week starting `mon`: each counts once, on whichever day it was done. A free-form
  // workout with anything logged is an extra, and never one of the planned ones.
  weekSessions(mon: DayKey) {
    const days = DOW.map((_, i) => addDays(mon, i));
    const gym = this.plan.days.map((p, s) => (p.exercises.length ? s : -1)).filter((s) => s >= 0);
    const done = gym.filter((s) => days.some((k) => !this.isFree(k) && this.slotFor(k) === s && this.plan.days[s].exercises.every((x) => this.entry(k).exercises[x.name]?.done))).length;
    return { days, done, planned: gym.length, extra: days.filter((k) => this.isFree(k) && this.worked(k)).length };
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
  /** One of the measurements card's fields for the day: chest, arms, thighs and hips are only ever typed; body
   *  fat is what you typed, or else Health Connect's own reading, like weight. */
  measureOf(k: DayKey, field: MeasureField): number | null {
    return this.logs[k]?.[field] ?? (field === "bodyFat" ? this.health[k]?.bodyFat : undefined) ?? null;
  }
  /** Every day with a reading for one measurement, oldest first: body fat's days include Health Connect's, like weight's. */
  measureReadings(field: MeasureField): [DayKey, number][] {
    const days = field === "bodyFat" ? [...new Set([...this.days(), ...Object.keys(this.health)])].sort() : this.days();
    return days.filter((k) => this.measureOf(k, field) != null).map((k) => [k, this.measureOf(k, field) as number]);
  }
  /** Whether the measurements card has ever been filled in, so Health → Body has trends to show even before
   *  Health Connect has synced anything. */
  anyMeasured(): boolean {
    return this.days().some((k) => MEASURE_FIELDS.some((f) => this.logs[k][f] != null));
  }
  swapSuggestions(exclude: string): string[] {
    const s = new Set<string>();
    for (const d of this.plan.days) for (const x of d.exercises) s.add(x.name);
    for (const k of this.days()) for (const r of Object.values(this.logs[k].exercises || {})) if (r?.swap) s.add(r.swap);
    // The library's lifts your gym can do for the same main muscles, when the lift's are known; all of them otherwise.
    const main = this.exerciseOf(exclude)?.primary ?? [];
    for (const x of this.library()) if (this.canDo(x) && (!main.length || x.primary.some((m) => main.includes(m)))) s.add(x.name);
    s.delete(exclude);
    return [...s].sort((a, b) => a.localeCompare(b));
  }
  /** Whether a name is tracked in any day this phone has: the key of a logged lift, or something swapped in
   *  for one. The plan editor checks this before offering to carry a rename's history over, so renaming to a
   *  name that already has its own history can be refused rather than merging the two. */
  hasHistory(name: string): boolean {
    return this.days().some((k) => {
      const ex = this.logs[k].exercises;
      return name in ex || Object.values(ex).some((r) => r?.swap === name);
    });
  }
  /** Carries a lift's history over to a new name: the key in every logged day's exercises, and any lift's swap
   *  equal to the old name, become the new one, saved the way any day's edit is (pending, then flush, so a
   *  conflict with another device merges or waits for you to choose exactly as it would for any other edit),
   *  a batch of days at once, as a restore saves. Every plan day with an exercise still named `from` moves to
   *  `to` as well, since a lift kept on two plan days (Seated Row on Pull and Upper) shares one history: left
   *  on the old name, that day's future logging would start a history of its own. Pulls first, so a day this
   *  phone hasn't loaded yet is caught too. Refuses when `to` already has its own history, so two are never
   *  quietly merged into one; a name clash within the day being edited (another lift there already called
   *  `to`) is the plan editor's to catch first, since only it knows which day that is. */
  async renameLift(from: string, to: string): Promise<{ ok: boolean; msg: string; days: number }> {
    // Every device's days first, fetched now: carried over from only this phone's copy, a day logged on another device
    // that hasn't reached this one would come back later under the old name, splitting the history. So nothing
    // moves without them, and the lift keeps the plain rename, as when you decline. (The demo's days are all here,
    // as are the unit tests' with no server.)
    const online = navigator.onLine, loaded = this.user && online ? await this.pull() : false;
    if (this.sb && !this.demo && !loaded)
      return {
        ok: false,
        msg: online
          ? `Couldn’t load every logged day just now, so ${from}’s history stays with ${from}. Type ${from} back, then rename it again in a moment.`
          : `You’re offline, so ${from}’s history stays with ${from}: a day logged on another device could be left behind. Type ${from} back, then rename it again once you’re online.`,
        days: 0,
      };
    if (this.hasHistory(to)) return { ok: false, msg: `“${to}” already has its own history, so ${from}’s can’t be carried over there too.`, days: 0 };
    const logged = (k: DayKey) => {
      const ex = this.logs[k].exercises;
      return from in ex || Object.values(ex).some((r) => r?.swap === from);
    };
    // A day that only names it (in the order its lifts were done in, or a free-form workout it was added to but
    // not logged in) has no history of it, but keeps its place.
    const named = (k: DayKey) => !!this.logs[k].order?.includes(from) || !!freeOf(this.logs[k])?.lifts.includes(from);
    const days = this.days().filter((k) => logged(k) || named(k)), carried = days.filter(logged).length;
    const known = this.namesALift(to);
    this.editPlan((p) => {
      for (const d of p.days)
        for (const x of d.exercises)
          if (x.name === from) {
            x.name = to;
            if (known) delete x.lib;
          }
    });
    for (const k of days) {
      const n = this.clone(k);
      if (from in n.exercises) {
        n.exercises[to] = n.exercises[from];
        delete n.exercises[from];
      }
      for (const r of Object.values(n.exercises)) if (r.swap === from) r.swap = to;
      if (n.order) n.order = n.order.map((x) => (x === from ? to : x));
      if (n.free) n.free.lifts = n.free.lifts.map((x) => (x === from ? to : x));
      this.logs[k] = n;
      this.pending[k] = n;
    }
    if (days.length) {
      this.logsChanged();
      this.persistLocal();
      this.changed();
      await this.flush();
    }
    const count = carried === 1 ? "1 day" : `${carried} days`;
    return { ok: true, msg: carried ? `Carried ${from}’s history over to ${to}: ${count}.` : `${to} is saved. ${from} had no history yet to carry over.`, days: carried };
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
  // The next weight by the lift's rule (PlanExercise.prog): double progression from the last time it was done, by
  // default; linear; or a percentage of a stored 1RM. A deload comes first, once enough sessions in a row fell
  // short. Whether a session reached its rep range is checked against what that session was actually asked for
  // (its own stored target, once it has one) rather than today's plan, so a rep range or sets change doesn't
  // retroactively call an old session incomplete; the step stays today's, since that part is about what to do next,
  // not what was done then. A knee-sensitive lift holds its weight rather than add to it after a session that was
  // hard on the knee, whatever the rule; a deload, which only takes weight off, still shows. A lift with no step of
  // its own goes up by what its equipment does, to a weight that equipment can make (My gym's weights).
  nextWeight(x: PlanExercise, did: string, k: DayKey): NextWeight | null {
    const load = this.loadDone(x, did), step = this.stepFor(x, load);
    const L = this.lastDone(did, k), after = parseInt(x.deloadAfter ?? "", 10);
    // Without a step of its own, the weight rounds to what the equipment makes: down for a deload, up for more.
    const grid = parseFloat(x.step) > 0 ? null : this.gridFor(load);
    const fit = (r: S.NextStep): S.NextStep => {
      if (!grid) return r;
      if (r.rule === "deload") return { ...r, to: S.onGrid((r.from ?? r.to) * (1 - (r.off ?? 0) / 100), grid, "down") };
      if (r.rule === "percent") return { ...r, to: S.onGrid(((r.oneRm ?? 0) * (r.pct ?? 0)) / 100, grid) };
      return { ...r, to: S.onGrid(r.to, grid, "up") };
    };
    if (L && after > 0) {
      const sessions = this.doneBefore(did, k, after).map(({ r }): S.Session => {
        const t = targetOf(r, x);
        return { sets: setsOf(r), reps: t.reps, minSets: minSets(t) };
      });
      const d = S.deloadStep(sessions, after, parseFloat(x.deloadPct ?? "") || 10, step);
      if (d) return { ...fit(d), day: L.day, held: false };
    }
    let r: S.NextStep | null = null;
    if (x.prog === "percent") {
      const oneRm = parseFloat(x.oneRm ?? ""), pct = parseFloat(x.pct ?? "");
      if (oneRm > 0 && pct > 0 && pct <= 100) r = { rule: "percent", from: L ? topKg(setsOf(L.r).filter(S.isStraightSet)) : null, to: S.percentOf(oneRm, pct, step), top: S.repRange(x.reps)?.[0] ?? 0, pct, oneRm };
    } else if (L) {
      const t = targetOf(L.r, x);
      r = (x.prog === "linear" ? S.linearStep : S.readyToAdd)(setsOf(L.r), t.reps, minSets(t), step);
    }
    if (!r) return null;
    r = fit(r);
    return { ...r, day: L?.day ?? k, held: !!x.knee && !!L && this.kneeBad(L.day) && r.from != null && r.to > r.from };
  }
  // Working sets only: a warm-up never sets a record or counts toward volume.
  liftSets(d: DayKey) {
    return Object.entries(this.logs[d]?.exercises || {})
      .filter(([, r]) => r && !r.skipped)
      .map(([key, r]) => ({ name: performed(key, r), sets: setsOf(r).filter(S.isWorkingSet) }));
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
    const r = n.exercises[name] || (n.exercises[name] = this.freshLift(day, name));
    fn(r);
    this.save(day, n, immediate);
    return r;
  }
  /** A lift's first entry for a day: stamped with the plan's sets and reps for it right now, if it's still in
   *  the plan for that day, so its history reads right (row count, "sets done", the go-up check) even after the
   *  plan's targets change later. A lift no longer in the plan when first logged (an "extra") gets none, and
   *  falls back to the plan like an entry logged before this existed. */
  private freshLift(day: DayKey, name: string): LiftLog {
    const x = this.planFor(day).exercises.find((e) => e.name === name);
    return x && (x.sets || x.reps) ? { done: false, kg: null, target: { sets: x.sets, reps: x.reps } } : { done: false, kg: null };
  }

  /* ---------- rest timer ---------- */
  /** Seconds left, counting from endAt so it can't drift: 0 once it's reached zero, whether running or paused. */
  restRemaining(): number {
    const r = this.rest;
    return r ? Math.max(0, Math.round((r.endAt - (r.pausedAt ?? Date.now())) / 1000)) : 0;
  }
  /** Starts (or restarts) the rest timer: a set's reps were just logged, typed or said (LiftItem.tsx). */
  startRest(day: DayKey, lift: string, sec: number) {
    this.rest = { day, lift, endAt: Date.now() + sec * 1000, pausedAt: null, ended: false };
    this.armRest();
    this.persistRest();
    this.changed();
  }
  pauseRest() {
    const r = this.rest;
    if (!r || r.pausedAt != null) return;
    r.pausedAt = Date.now();
    this.disarmRest(); // nothing to notify while it isn't counting
    this.persistRest();
    this.changed();
  }
  resumeRest() {
    const r = this.rest;
    if (!r || r.pausedAt == null) return;
    r.endAt = Date.now() + (r.endAt - r.pausedAt); // what was left, from now
    r.pausedAt = null;
    this.armRest();
    this.persistRest();
    this.changed();
  }
  /** +30 s (or any amount): pushes the end time out, whether running or paused, and un-ends a timer that had
   *  already reached zero, so tapping it after "Rest over" counts that much down again, from now. */
  addRestTime(sec: number) {
    const r = this.rest;
    if (!r) return;
    r.endAt = (r.pausedAt == null ? Math.max(r.endAt, Date.now()) : r.endAt) + sec * 1000;
    r.ended = false;
    if (r.pausedAt == null) this.armRest();
    this.persistRest();
    this.changed();
  }
  /** Dismisses the timer without announcing it, as if it had never been needed. */
  skipRest() {
    if (!this.rest) return;
    this.disarmRest();
    this.rest = null;
    this.persistRest();
    this.changed();
  }
  /** Schedules checkRest for when the countdown is due, replacing any timer already waiting. A no-op while paused,
   *  already over, or with nothing running: those need no wake-up. */
  private armRest() {
    this.disarmRest();
    const r = this.rest;
    if (!r || r.pausedAt != null || r.ended) return;
    // A little after zero, not exactly on it: setTimeout can fire a beat early, and Date.now() must already be past
    // endAt below or this re-arms instead of finishing.
    this.restTimeout = setTimeout(() => this.checkRest(), Math.max(0, r.endAt - Date.now()) + 100);
  }
  private disarmRest() {
    clearTimeout(this.restTimeout);
    this.restTimeout = undefined;
  }
  /** Whether the countdown has reached zero, called by armRest's timer and again whenever the tab comes back to the
   *  front (background tabs throttle timers, so a reload or a long time away might have missed it). Vibrates and
   *  marks it over the first time only; safe to call any time after, including while paused. */
  private checkRest() {
    const r = this.rest;
    if (!r || r.ended || r.pausedAt != null) return;
    if (Date.now() < r.endAt) {
      this.armRest();
      return;
    }
    r.ended = true;
    if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate([300, 150, 300]);
    this.persistRest();
    this.changed();
  }

  /** Keeps a copy on the phone, and notes whether that worked. (Callers tell listeners.) In the demo, nothing is
   *  kept anywhere: a real sign-in afterwards must never find sample data waiting for it. */
  private saveLocal(key: string, value: unknown) {
    if (this.demo) return;
    if (lsSet(key, value)) this.unsaved.delete(key);
    else this.unsaved.add(key);
    this.localSaveFailed = this.unsaved.size > 0;
  }
  private persistLocal() {
    this.saveLocal(CACHE_KEY, { user: this.user?.id, logs: this.logs, bases: this.bases });
    this.saveLocal(PENDING_KEY, { user: this.user?.id, pending: this.pending });
  }
  private persistHealth() {
    this.saveLocal(HEALTH_KEY, { user: this.user?.id, health: this.health, at: this.healthSyncedAt });
  }
  private persistPlan() {
    this.saveLocal(PLAN_KEY, { user: this.user?.id, plan: this.plan, dirty: this.planDirty, base: this.planBase });
  }
  private persistRest() {
    this.saveLocal(REST_KEY, { user: this.user?.id, rest: this.rest });
  }

  /** Days waiting to be saved, leaving out those waiting for you to choose a version. */
  private unsynced(): DayKey[] {
    return Object.keys(this.pending).filter((d) => !this.conflicts[d]);
  }
  /** How many days wait on a failed save or on the phone being offline, or null when all is well. */
  syncWaiting(): { days: number; offline: boolean } | null {
    const days = this.unsynced().length, offline = !this.online;
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
    const days = this.unsynced();
    if (!days.length || !this.user || !this.sb) return;
    if (!navigator.onLine) {
      this.setStatus("Offline. Saved on this phone, will sync");
      return;
    }
    this.flushing = true;
    this.setStatus("Saving…");
    let error: unknown = null;
    try {
      // Days new here go in together, a chunk to a request; the others are each written over the version they started
      // from, a few at once, and so are the days of a chunk that found one of them already there.
      const fresh = days.filter((d) => !this.bases[d]), each = days.filter((d) => this.bases[d]);
      for (let i = 0; i < fresh.length && !error; i += INSERT_CHUNK) {
        const chunk = fresh.slice(i, i + INSERT_CHUNK), r = await this.addDays(chunk);
        if (r.taken) each.push(...chunk);
        error = r.error ?? null;
      }
      if (!error) error = await this.saveEach(each);
    } finally {
      this.flushing = false;
    }
    this.persistLocal();
    if (error) {
      this.syncTrouble = true;
      this.setStatus("Not synced yet. Will retry");
      console.warn(error);
      this.flushTimer = setTimeout(() => void this.flush(), 15000);
      return;
    }
    this.syncTrouble = false;
    this.setStatus(this.unsynced().length ? "Saving…" : Object.keys(this.conflicts).length ? "Not synced yet" : "Saved");
  }

  /** Adds days new here in one request. `taken` when one of them was there already: Postgres then turns the whole
   *  request down, so none went in. Or an error to retry on. */
  private async addDays(days: DayKey[]): Promise<{ taken?: boolean; error?: unknown }> {
    const uid = this.user!.id, rows = days.map((day) => ({ user_id: uid, day, data: this.pending[day] }));
    const { data, error } = await this.sb!.from("logs").insert(rows).select("day,updated_at");
    if (error) return error.code === UNIQUE_VIOLATION ? { taken: true } : { error };
    const at = new Map(((data as { day: DayKey; updated_at: string }[] | null) ?? []).map((r) => [r.day, r.updated_at]));
    for (const r of rows) {
      const v = at.get(r.day);
      if (!v) continue;
      this.bases[r.day] = v;
      if (this.pending[r.day] === r.data) delete this.pending[r.day]; // unless edited meanwhile
    }
    return {};
  }

  /** Saves days one by one, a few at once. After an error it starts no more, lets those under way finish, and returns
   *  the first error. */
  private async saveEach(days: DayKey[]): Promise<unknown> {
    let next = 0, error: unknown = null;
    const worker = async () => {
      while (!error && next < days.length) {
        const e = await this.saveDay(days[next++]).catch((x: unknown) => x);
        error ??= e;
      }
    };
    await Promise.all(Array.from({ length: Math.min(SAVES_AT_ONCE, days.length) }, worker));
    return error;
  }

  /** Saves a waiting day over the version this phone's copy started from, or adds it when Supabase has none. If
   *  another device changed the day first: takes that version when the copies match, merges edits to different
   *  lifts, or else keeps both for you to choose (`conflicts`). Returns an error to retry on. */
  private async saveDay(day: DayKey): Promise<unknown> {
    const sb = this.sb!, uid = this.user!.id;
    for (let tries = 0; tries < 3; tries++) {
      const data = this.pending[day], base = this.bases[day];
      if (!data || this.conflicts[day]) return null;
      const w = await (base
        ? sb.from("logs").update({ data }).eq("user_id", uid).eq("day", day).eq("updated_at", base).select("updated_at")
        : sb.from("logs").insert({ user_id: uid, day, data }).select("updated_at"));
      if (w.error && w.error.code !== UNIQUE_VIOLATION) return w.error;
      const at = w.error ? null : writtenAt(w.data);
      if (at) {
        this.bases[day] = at;
        if (this.pending[day] === data) delete this.pending[day];
        return null;
      }
      // Changed on another device since this phone last had it: compare its copy with this one.
      const got = await sb.from("logs").select("data,updated_at").eq("user_id", uid).eq("day", day).maybeSingle();
      if (got.error) return got.error;
      const theirs = got.data as { data: DayLog; updated_at: string } | null, mine = this.pending[day];
      if (!mine) return null;
      if (!theirs) {
        delete this.bases[day]; // gone from Supabase: add it again
        continue;
      }
      if (sameDay(mine, theirs.data)) {
        this.bases[day] = theirs.updated_at;
        delete this.pending[day];
        return null;
      }
      const both = mergeDays(mine, theirs.data);
      if (!both) {
        // The base stays as it was, so this is found again after a reload.
        this.conflicts[day] = { data: theirs.data, at: theirs.updated_at };
        return null;
      }
      this.bases[day] = theirs.updated_at;
      this.logs[day] = this.pending[day] = both;
      this.logsChanged();
    }
    return new Error(`${day} kept changing on another device while saving`);
  }

  /** Settles a day changed here and on another device: keeps this phone's version, saving it over the other one,
   *  or the other version, dropping this phone's changes to the day. Then syncs. */
  async keepDay(day: DayKey, which: "mine" | "theirs"): Promise<void> {
    const c = this.conflicts[day];
    if (!c) return;
    delete this.conflicts[day];
    this.bases[day] = c.at;
    if (which === "theirs") {
      this.logs[day] = c.data;
      delete this.pending[day];
      this.logsChanged();
    }
    this.persistLocal();
    this.changed();
    await this.flush();
    await this.pull();
  }

  /** Loads every logged day, keeping this phone's unsaved edits. Whether it did: not while offline, or when the
   *  load fails (which the status says). */
  async pull(): Promise<boolean> {
    if (!this.user || !navigator.onLine || !this.sb) return false;
    const before = { ...this.bases }, asked = { ...this.conflicts };
    const { data, error } = await this.sb.from("logs").select("day,data,updated_at").order("day", { ascending: true }).limit(5000);
    if (error) {
      this.setStatus("Couldn’t load. Showing saved copy");
      console.warn(error);
      return false;
    }
    const next: Record<DayKey, DayLog> = {}, bases: Record<DayKey, string> = {};
    for (const r of data as { day: DayKey; data: DayLog; updated_at: string }[]) {
      next[r.day] = r.data;
      bases[r.day] = r.updated_at;
      // A day waiting for your choice offers the other device's latest copy, unless a save found a newer one meanwhile.
      if (this.conflicts[r.day] && this.conflicts[r.day] === asked[r.day]) this.conflicts[r.day] = { data: r.data, at: r.updated_at };
    }
    // This phone's copy stands, with the version it started from, for days with unsaved edits (local edits win), and
    // for days whose version moved while this loaded: saved meanwhile, their rows here may be from before.
    const moved = Object.keys(this.logs).filter((d) => !this.pending[d] && this.bases[d] !== before[d]);
    for (const d of [...Object.keys(this.pending), ...moved]) {
      next[d] = this.pending[d] ?? this.logs[d];
      if (this.bases[d]) bases[d] = this.bases[d];
      else delete bases[d];
    }
    this.logs = next;
    this.bases = bases;
    this.logsLoaded = true;
    this.logsChanged();
    this.persistLocal();
    if (!Object.keys(this.pending).length) this.status = "Synced";
    this.changed();
    return true;
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
    // Your own lifts stay, as they name lifts in your history, and so does My gym, which is where you train: its
    // equipment, and its bars, plates and weights.
    const { custom, gym, weights, barKg, plateKgs } = this.plan;
    this.plan = { ...copy(DEFAULT_PLAN), barKg, plateKgs: plateKgs.slice(), ...(custom ? { custom } : {}), ...(gym ? { gym } : {}), ...(weights ? { weights } : {}) };
    this.planChanged(true);
  }
  /** Starts the plan over from a template (src/data/templates): its sessions, lifts, warm-ups and tempo. The goals
   *  stay as they are. Saved like any edit. */
  startFrom(t: Plan) {
    const { tempo, warmups, days } = copy(t);
    this.plan = { ...this.plan, tempo, warmups, days };
    this.planChanged(true);
  }
  /** A new account (no plan saved in Supabase, nothing logged) chooses a plan before anything else: "choose". "wait"
   *  while that can't be told yet: this phone has nothing for the account and the first load isn't back. Otherwise
   *  null, and an account without a plan of its own uses the default one, as it always has. */
  planStep(): "choose" | "wait" | null {
    if (this.auth !== "signedIn" || this.planSource === "server" || this.planDirty || this.days().length) return null;
    if (this.planSource === "default" && this.logsLoaded) return "choose";
    return this.firstLoad ? "wait" : null;
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
    if (this.planConflict) {
      this.setPlanMsg(PLAN_HELD);
      return;
    }
    if (!navigator.onLine) {
      this.setPlanMsg("Offline. Saved on this phone, will sync");
      return;
    }
    this.planFlushing = true;
    const rev = this.planRev;
    let r: { at?: string; error?: unknown };
    try {
      r = await this.savePlan(normalizePlan(this.plan, DEFAULT_PLAN));
    } finally {
      this.planFlushing = false;
    }
    clearTimeout(this.planTimer);
    if (r.error) {
      this.setPlanMsg("Not synced yet. Will retry");
      console.warn(r.error);
      this.planTimer = setTimeout(() => void this.flushPlan(), 15000);
      return;
    }
    if (!r.at) {
      this.setPlanMsg(PLAN_HELD);
      return;
    }
    this.planBase = r.at;
    this.planSource = "server";
    if (rev !== this.planRev) {
      this.persistPlan();
      this.planTimer = setTimeout(() => void this.flushPlan(), 400); // edited while saving
      return;
    }
    this.planDirty = false;
    this.persistPlan();
    this.setPlanMsg("Saved");
  }

  /** Saves the plan over the version this phone's copy started from, or adds it when Supabase has none. Returns the
   *  new version; none when another device changed the plan first (so it's kept for you to choose), unless that
   *  device's plan is the same, whose version is taken; or an error to retry on. */
  private async savePlan(plan: Plan, tries = 2): Promise<{ at?: string; error?: unknown }> {
    const sb = this.sb!, uid = this.user!.id, base = this.planBase;
    const w = await (base
      ? sb.from("plans").update({ plan }).eq("user_id", uid).eq("updated_at", base).select("updated_at")
      : sb.from("plans").insert({ user_id: uid, plan }).select("updated_at"));
    if (w.error && w.error.code !== UNIQUE_VIOLATION) return { error: w.error };
    const at = w.error ? null : writtenAt(w.data);
    if (at) return { at };
    const got = await sb.from("plans").select("plan,updated_at").eq("user_id", uid).maybeSingle();
    if (got.error) return { error: got.error };
    if (!got.data) {
      if (!tries) return { error: new Error("the plan kept changing on another device while saving") };
      this.planBase = null; // gone from Supabase: add it again
      return this.savePlan(plan, tries - 1);
    }
    const theirs = normalizePlan(got.data.plan, DEFAULT_PLAN);
    if (canon(theirs) === canon(plan)) return { at: got.data.updated_at };
    this.planConflict = { plan: theirs, at: got.data.updated_at };
    return {};
  }

  /** Settles the plan changed here and on another device: keeps this phone's version, saving it over the other one,
   *  or the other version, dropping this phone's changes. Then syncs. */
  async keepPlan(which: "mine" | "theirs"): Promise<void> {
    const c = this.planConflict;
    if (!c) return;
    this.planConflict = null;
    this.planBase = c.at;
    this.planSource = "server";
    if (which === "theirs") {
      this.plan = c.plan;
      this.planDirty = false;
      this.planRev++; // a load already under way is older than this
      this.planShape++;
      this.planMsg = "Saved";
    }
    this.persistPlan();
    this.changed();
    await this.flushPlan();
    await this.pullPlan();
  }

  async pullPlan(): Promise<void> {
    if (!this.user || !navigator.onLine || this.planDirty || !this.sb) return;
    const rev = this.planRev;
    const { data, error } = await this.sb.from("plans").select("plan,updated_at").eq("user_id", this.user.id).maybeSingle();
    if (error) {
      console.warn(error);
      return;
    }
    if (this.planDirty || rev !== this.planRev) return; // edited while loading
    const source = data?.plan ? "server" : "default";
    if (source !== this.planSource) {
      this.planSource = source;
      this.changed();
    }
    const next = data?.plan ? normalizePlan(data.plan, DEFAULT_PLAN) : copy(DEFAULT_PLAN), base: string | null = data?.updated_at ?? null;
    // Unchanged (the usual case): leave the plan editor's fields alone, in case one is being typed in.
    if (JSON.stringify(next) === JSON.stringify(this.plan)) {
      if (base !== this.planBase) {
        this.planBase = base;
        this.persistPlan();
      }
      return;
    }
    this.plan = next;
    this.planBase = base;
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
  /** Export workouts as CSV: a row for each set with reps or weight, oldest day first and lifts in the order done,
   *  under CSV_COLUMNS. A lift is its planned name; a swap names what was done instead. */
  workoutRows(): CsvValue[][] {
    const rows: CsvValue[][] = [];
    for (const day of this.days()) {
      const e = this.entry(day), session = this.planFor(day).name;
      for (const name of new Set(this.liftsFor(day).map((it) => it.name))) {
        const r = e.exercises[name];
        // Warm-ups and the lift's rows are numbered apart, so set 1 is the first set on Today's rows.
        let warm = 0, work = 0;
        setsOf(r).forEach((s) => {
          const n = s.type === "warmup" ? ++warm : ++work;
          if (s.reps != null || s.kg != null) rows.push([day, session, name, n, s.reps, s.kg, s.type ?? "working", s.rpe ?? null, s.rir ?? null, !!r.skipped, r.swap ?? "", e.note]);
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
    // A backup made on the default plan brings the default back; an older list of days leaves the plan alone.
    const plan = b.plan === "default" ? copy(DEFAULT_PLAN) : b.plan ? normalizePlan(b.plan, DEFAULT_PLAN) : null;
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
    // The plan is named when the file has one of its own, or when its default replaced another.
    const done = `Imported ${backupWords(b.logs.length, plan !== null && (newPlan || b.plan !== "default"), saved ? health : 0)}.`;
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

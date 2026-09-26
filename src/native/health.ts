/* Reading Health Connect in the Android app and saving it to Supabase. Only loaded inside the app, so the
 * website doesn't carry the plugin. The numbers are turned into days by healthDays() in lib/health.ts. */
import { Health, type HealthDataType } from "@capgo/capacitor-health";
import { addDays, parseKey, todayKey } from "@/lib/dates";
import { healthDays, type HealthReadings, type Workout } from "@/lib/health";
import { lsGet, lsSet } from "@/lib/storage";
import type { GymStore } from "@/lib/store";
import type { DayKey, HealthDay } from "@/lib/types";
import { backgroundRunning } from "./sync";

// What Gym Log reads, all read-only. Distance is also what lets Health Connect total a workout's calories.
export const READ: HealthDataType[] = [
  "steps",
  "distance",
  "flightsClimbed",
  "calories",
  "totalCalories",
  "basalCalories",
  "dietaryEnergyConsumed",
  "dietaryWater",
  "heartRate",
  "restingHeartRate",
  "heartRateVariability",
  "oxygenSaturation",
  "respiratoryRate",
  "vo2Max",
  "bloodPressure",
  "weight",
  "bodyFat",
  "height",
  "sleep",
  "workouts",
];
/** Each kind in words, for Settings: "Gym Log can also read sleep, heart rate…". */
const WORDS: Record<string, string> = {
  steps: "steps",
  distance: "distance",
  flightsClimbed: "floors",
  calories: "active calories",
  totalCalories: "total calories",
  basalCalories: "resting calories",
  dietaryEnergyConsumed: "calories eaten",
  dietaryWater: "water",
  heartRate: "heart rate",
  restingHeartRate: "resting heart rate",
  heartRateVariability: "heart rate variability",
  oxygenSaturation: "blood oxygen",
  respiratoryRate: "breathing rate",
  vo2Max: "VO₂ max",
  bloodPressure: "blood pressure",
  weight: "weight",
  bodyFat: "body fat",
  height: "height",
  sleep: "sleep",
  workouts: "exercise",
};
// The kinds of data each account had allowed at its last read. A kind allowed since (or a first read) reads the
// longer stretch; otherwise each sync reads the last 10 days.
const GRANTED_KEY = "gymlog.health.granted.v1";

let busy = false;
let lastRun = 0;
/** syncToday's read and save, while under way: a full read waits for it (below), so the two never overlap. */
let quickRun: Promise<void> | null = null;
/** What the last full read couldn't read (by label): syncToday saves despite those, as the full read did. */
let lastFailed: string[] = [];

const why = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/\.$/, "");
const unavailable = (reason?: string) =>
  `${(reason || "Health Connect isn’t available on this phone").replace(/\.$/, "")}. Install or update Health Connect from Google Play, then try again.`;

/** Asks for Health Connect access (the permission sheet opens), then reads. For the Connect button. */
export async function connectHealth(store: GymStore): Promise<void> {
  try {
    const avail = await Health.isAvailable();
    if (!avail.available) {
      store.setHealthLink({ state: "unavailable", msg: unavailable(avail.reason) });
      return;
    }
    await Health.requestAuthorization({ read: READ, requestHistoryAccess: true });
  } catch (e) {
    store.setHealthLink({ state: "error", msg: `Couldn’t open Health Connect: ${why(e)}.` });
    return;
  }
  await syncHealth(store, true);
}

/** What Health Connect lets Gym Log read, in words, for Settings; null when it isn't there. */
export async function healthAccess(): Promise<{ granted: string[]; missing: string[] } | null> {
  try {
    if (!(await Health.isAvailable()).available) return null;
    const ok = (await Health.checkAuthorization({ read: READ })).readAuthorized;
    return { granted: READ.filter((k) => ok.includes(k)).map((k) => WORDS[k]), missing: READ.filter((k) => !ok.includes(k)).map((k) => WORDS[k]) };
  } catch {
    return null;
  }
}

/** Health Connect's own page for Gym Log, to change what it may read. */
export const openHealthSettings = (): Promise<void> => Health.openHealthConnectSettings();

/** Reads Health Connect and saves the days that changed. Without `now`, at most every 5 minutes. */
export async function syncHealth(store: GymStore, now = false): Promise<void> {
  // Not in the demo: the phone's own readings would land among the sample data.
  if (busy || !store.user || store.demo || (!now && Date.now() - lastRun < 5 * 60_000)) return;
  busy = true;
  try {
    // A quick read of today under way finishes first. Seeing this one started, it saves nothing, so its older copy of
    // today never lands on top of this one's.
    await quickRun;
    const avail = await Health.isAvailable();
    if (!avail.available) {
      store.setHealthLink({ state: "unavailable", msg: unavailable(avail.reason) });
      return;
    }
    const granted = (await Health.checkAuthorization({ read: READ })).readAuthorized;
    if (!granted.length) {
      store.setHealthLink({ state: "off", msg: "Not connected yet." });
      return;
    }
    store.setHealthLink({ state: "syncing", msg: "Reading Health Connect…" });
    const uid = store.user.id, seen = lsGet<Record<string, string[]>>(GRANTED_KEY, {});
    const t = todayKey(), fresh = granted.some((k) => !seen[uid]?.includes(k));
    // A first read (or one with newly allowed data) goes back to when the log started (at least 30 days, at most
    // 90); later ones, 10 days.
    const from = fresh ? [addDays(t, -90), [store.firstDay(), addDays(t, -30)].sort()[0]].sort()[1] : addDays(t, -9);
    const { days, failed } = await readDays(from, granted);
    lastFailed = failed;
    const n = await store.saveHealth(days);
    lsSet(GRANTED_KEY, { ...seen, [uid]: granted });
    const saved = n ? `${n} day${n === 1 ? "" : "s"} updated` : "Up to date";
    store.setHealthLink({ state: "ok", msg: failed.length ? `${saved}; couldn’t read ${failed.join(", ")}.` : `${saved}.` });
  } catch (e) {
    store.setHealthLink({ state: "error", msg: `Couldn’t sync Health Connect: ${why(e)}. It tries again next time the app opens.` });
  } finally {
    busy = false;
    lastRun = Date.now();
  }
}

/**
 * While the app is open and on screen (app.ts, every 30 seconds): today's numbers, so steps, calories and heart rate
 * keep up with the phone and the watch. Only today, and quietly, without "Reading Health Connect…" each time: the
 * full read above (on opening, coming back, every 15 minutes, and Sync now) covers the days before and anything
 * newly allowed, and says what went wrong. It waits for that read to have worked, and saves nothing from a read
 * where something failed that the full read could read, so a passing hiccup never blanks part of today.
 */
export async function syncToday(store: GymStore): Promise<void> {
  if (busy || quickRun || !store.user || store.demo || store.healthLink.state !== "ok") return;
  if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
  // Offline, what it read couldn't be saved (saveHealth writes to Supabase first): it waits to be back online.
  if (!navigator.onLine) return;
  const granted = lsGet<Record<string, string[]>>(GRANTED_KEY, {})[store.user.id];
  if (!granted?.length) return;
  quickRun = (async () => {
    try {
      // Background sync (HealthSync.kt) reading too: its copy of today, read before this one's, would land after it,
      // and this phone would think the newer one saved. The next tick reads instead.
      if (await backgroundRunning()) return;
      const { days, failed } = await readDays(todayKey(), granted);
      // A full read that started meanwhile (waiting for this) saves its own, newer, copy.
      if (!busy && failed.every((f) => lastFailed.includes(f))) await store.saveHealth(days, { quiet: true });
    } catch {
      // Quiet: the next full read says what's wrong.
    }
  })();
  try {
    await quickRun;
  } finally {
    quickRun = null;
  }
}

/** Day totals, samples and workouts from `from` (local midnight) to now, as days. */
async function readDays(from: DayKey, granted: string[]): Promise<{ days: Record<DayKey, HealthDay>; failed: string[] }> {
  const start = parseKey(from).toISOString(), end = new Date().toISOString(), failed: string[] = [];
  // One kind of data failing (none recorded, or access removed) shouldn't stop the others.
  const read = async <T,>(type: HealthDataType, label: string, get: () => Promise<T>): Promise<T | undefined> => {
    if (!granted.includes(type)) return undefined;
    try {
      return await get();
    } catch {
      failed.push(label);
      return undefined;
    }
  };
  type Aggregation = "sum" | "average" | ("average" | "min" | "max")[];
  const total = (dataType: HealthDataType, label: string, aggregation: Aggregation, bucket: "day" | "hour" = "day") =>
    read(dataType, label, async () => (await Health.queryAggregated({ dataType, startDate: start, endDate: end, bucket, aggregation })).samples);
  // Newest first, in pages of 500: some watches record blood oxygen or HRV every minute of the night.
  const samples = (dataType: HealthDataType, label: string, startDate = start) =>
    read(dataType, label, async () => (await Health.readSamples({ dataType, startDate, endDate: end, limit: 5000, ascending: false })).samples);
  const r: HealthReadings = {
    steps: await total("steps", "steps", "sum"),
    stepsHourly: await total("steps", "steps by hour", "sum", "hour"),
    distance: await total("distance", "distance", "sum"),
    floors: await samples("flightsClimbed", "floors"),
    activeKcal: await total("calories", "active calories", "sum"),
    totalKcal: await samples("totalCalories", "total calories"),
    bmr: await samples("basalCalories", "resting calories"),
    eatenKcal: await total("dietaryEnergyConsumed", "calories eaten", "sum"),
    water: await total("dietaryWater", "water", "sum"),
    heartRate: await total("heartRate", "heart rate", ["average", "min", "max"]),
    restingHr: await total("restingHeartRate", "resting heart rate", "average"),
    hrv: await samples("heartRateVariability", "heart rate variability"),
    spo2: await samples("oxygenSaturation", "blood oxygen"),
    respRate: await samples("respiratoryRate", "breathing rate"),
    vo2max: await samples("vo2Max", "VO2 max"),
    bp: await samples("bloodPressure", "blood pressure"),
    weight: await samples("weight", "weight"),
    bodyFat: await samples("bodyFat", "body fat"),
    height: await samples("height", "height"),
    // A night's sleep that ends on the first day started the evening before.
    sleep: await samples("sleep", "sleep", parseKey(addDays(from, -1)).toISOString()),
    workouts: await read("workouts", "workouts", async () => {
      const out: Workout[] = [];
      let anchor: string | undefined;
      for (let page = 0; page < 20; page++) {
        const res = await Health.queryWorkouts({ startDate: start, endDate: end, limit: 100, ascending: true, anchor });
        out.push(...res.workouts);
        if (!res.anchor) break;
        anchor = res.anchor;
      }
      return out;
    }),
  };
  const days = healthDays(r);
  for (const k of Object.keys(days)) if (k < from) delete days[k];
  return { days, failed };
}

/* Reading Health Connect in the Android app and saving it to Supabase. Only loaded inside the app, so the
 * website doesn't carry the plugin. The numbers are turned into days by healthDays() in lib/health.ts. */
import { Health, type HealthDataType } from "@capgo/capacitor-health";
import { addDays, parseKey, todayKey } from "@/lib/dates";
import { healthDays, type HealthReadings, type Workout } from "@/lib/health";
import { lsGet, lsSet } from "@/lib/storage";
import type { GymStore } from "@/lib/store";
import type { DayKey, HealthDay } from "@/lib/types";

// What Gym Log reads. Distance too: without it, Health Connect won't total a workout's calories.
export const READ: HealthDataType[] = ["steps", "distance", "calories", "heartRate", "restingHeartRate", "weight", "sleep", "workouts"];
// Accounts whose first, longer read is done: after that, each sync reads the last 10 days.
const FIRST_READ_KEY = "gymlog.health.first.v1";

let busy = false;
let lastRun = 0;

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

/** Reads Health Connect and saves the days that changed. Without `now`, at most every 5 minutes. */
export async function syncHealth(store: GymStore, now = false): Promise<void> {
  if (busy || !store.user || (!now && Date.now() - lastRun < 5 * 60_000)) return;
  busy = true;
  try {
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
    const uid = store.user.id, done = lsGet<Record<string, boolean>>(FIRST_READ_KEY, {});
    const t = todayKey();
    // The first read goes back to when the log started (at least 30 days, at most 90); later ones, 10 days.
    const from = done[uid] ? addDays(t, -9) : [addDays(t, -90), [store.firstDay(), addDays(t, -30)].sort()[0]].sort()[1];
    const { days, failed } = await readDays(from, granted);
    const n = await store.saveHealth(days);
    lsSet(FIRST_READ_KEY, { ...done, [uid]: true });
    const saved = n ? `${n} day${n === 1 ? "" : "s"} updated` : "Up to date";
    store.setHealthLink({ state: "ok", msg: failed.length ? `${saved}; couldn’t read ${failed.join(", ")}.` : `${saved}.` });
  } catch (e) {
    store.setHealthLink({ state: "error", msg: `Couldn’t sync Health Connect: ${why(e)}. It tries again next time the app opens.` });
  } finally {
    busy = false;
    lastRun = Date.now();
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
  const total = (dataType: HealthDataType, label: string, aggregation: "sum" | "average" | ("average" | "max")[]) =>
    read(dataType, label, async () => (await Health.queryAggregated({ dataType, startDate: start, endDate: end, bucket: "day", aggregation })).samples);
  const samples = (dataType: HealthDataType, label: string, startDate = start) =>
    read(dataType, label, async () => (await Health.readSamples({ dataType, startDate, endDate: end, limit: 2000, ascending: true })).samples);
  const r: HealthReadings = {
    steps: await total("steps", "steps", "sum"),
    activeKcal: await total("calories", "calories", "sum"),
    heartRate: await total("heartRate", "heart rate", ["average", "max"]),
    restingHr: await total("restingHeartRate", "resting heart rate", "average"),
    weight: await samples("weight", "weight"),
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

/* A phone for the tests of src/native: a signed-in store, and Health Connect with a few days in it. For test files
 * that mock the plugins with nativeMocks.ts. */
import { GymStore } from "@/lib/store";
import { READ } from "@/native/health";
import { health } from "./nativeMocks";

/** Midnight at the start of a day of 2026, in the phone's time zone, as Health Connect gives it. */
export const mid = (m: number, d: number) => new Date(2026, m - 1, d).toISOString();

/** A signed-in store whose Supabase client records upserts to health_days in `upserts`. */
export function signedIn() {
  const s = new GymStore(), upserts: unknown[][] = [];
  s.user = { id: "u1", created_at: "2026-08-26T05:00:00Z" } as GymStore["user"];
  s.auth = "signedIn";
  s.sb = {
    from: (table: string) => ({
      upsert: async (rows: unknown[]) => {
        if (table === "health_days") upserts.push(rows);
        return { error: null };
      },
    }),
  } as unknown as GymStore["sb"];
  return { s, upserts };
}

/** A steps record of the 23rd, from `h:m` for `min` minutes, shared by the app `from` (a package name). */
export const stepsRecord = (h: number, m: number, min: number, value: number, from: string) => ({
  startDate: new Date(2026, 8, 23, h, m).toISOString(),
  endDate: new Date(2026, 8, 23, h, m + min).toISOString(),
  value,
  sourceId: from,
});
export const SAMSUNG = "com.sec.android.app.shealth";

/** Health Connect with everything allowed: steps on 22 and 23 September (23's by the hour too, and its records, most
 *  from Samsung Health up to 9:40 and a few from Google Fit after), a resting heart rate and a weigh-in on the 23rd. */
export function phoneHas() {
  health.isAvailable.mockResolvedValue({ available: true, platform: "android" });
  health.checkAuthorization.mockResolvedValue({ readAuthorized: READ, readDenied: [], writeAuthorized: [], writeDenied: [] });
  health.queryAggregated.mockImplementation(async ({ dataType, bucket }: { dataType: string; bucket: string }) => ({
    samples:
      dataType === "steps" && bucket === "hour"
        ? [{ startDate: new Date(2026, 8, 23, 9).toISOString(), value: 3012 }]
        : dataType === "steps"
          ? [{ startDate: mid(9, 22), value: 8421 }, { startDate: mid(9, 23), value: 3012 }]
          : dataType === "restingHeartRate"
            ? [{ startDate: mid(9, 23), value: 61 }]
            : [],
  }));
  health.readSamples.mockImplementation(async ({ dataType }: { dataType: string }) => ({
    samples:
      dataType === "weight"
        ? [{ startDate: new Date(2026, 8, 23, 7).toISOString(), endDate: new Date(2026, 8, 23, 7).toISOString(), value: 81.2 }]
        : dataType === "steps"
          ? [stepsRecord(9, 0, 10, 1800, SAMSUNG), stepsRecord(9, 30, 10, 1212, SAMSUNG), stepsRecord(9, 45, 5, 40, "com.google.android.apps.fitness")]
          : [],
  }));
  health.queryWorkouts.mockResolvedValue({ workouts: [] });
}

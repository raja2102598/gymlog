/* A stand-in for the Supabase client, for the in-app demo (GymStore.startDemo). It answers the same handful of
 * queries store.ts sends a real one (see flush, pull, flushPlan, pullPlan, pullHealth), straight from the store's
 * own plan, logs and health — so those methods run completely unchanged, and a "pull" can never overwrite the
 * sample data with an empty table, because there never is a separate table: reading it just reads the store.
 *
 * A write always succeeds. There's only one "device" in a demo, so nothing else could ever have changed a row
 * first (the version-conflict handling in store.ts, built for two phones on one account, simply never triggers);
 * store.ts's own bookkeeping (bases, pending, planDirty) takes it from there exactly as it would with a real save.
 *
 * The unit tests have a similar fake (tests/unit/fakeSupabase.ts), with the call log and failure injection those
 * tests need. This one ships in the app, so it stays free of both, and of anything from tests/. */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { GymStore } from "./store";

type Row = Record<string, unknown>;

/** A fresh, always-different token. Nothing ever compares two of these for anything meaningful (see above), so
 *  it only has to look like a real one. */
let clock = 0;
const stamp = () => `demo-${++clock}`;

/** Builds one `.from(table)` call: enough of select/insert/update/upsert/eq/order/limit/maybeSingle, awaitable
 *  like the real query builder, to answer everything store.ts sends. */
function builder(store: GymStore, table: string) {
  let op: "select" | "insert" | "update" | "upsert" = "select";
  let body: Row | Row[] = {};
  let single = false;
  const eq: Record<string, string> = {};
  const self = {
    // Extra arguments a real call would pass (columns, upsert options, …) are simply ignored: nothing here needs
    // them (see the class comment above for why).
    select: () => self,
    insert: (v: Row | Row[]) => ((op = "insert"), (body = v), self),
    update: (v: Row) => ((op = "update"), (body = v), self),
    upsert: (v: Row | Row[]) => ((op = "upsert"), (body = v), self),
    eq: (col: string, v: string) => ((eq[col] = v), self),
    order: () => self,
    limit: () => self,
    maybeSingle: () => ((single = true), self),
    then: (resolve: (r: { data: unknown; error: null }) => unknown) => resolve(run()),
  };

  function run(): { data: unknown; error: null } {
    if (op === "select") {
      if (table === "plans") return { data: store.plan ? { plan: store.plan, updated_at: stamp() } : null, error: null };
      if (table === "health_days") {
        // The same shared token as long as nothing's changed, so pullHealth's own "nothing new" check still works.
        const at = store.healthSyncedAt ?? stamp();
        let picked = Object.keys(store.health).sort().map((day) => ({ day, data: store.health[day], updated_at: at }));
        if (eq.day != null) picked = picked.filter((r) => r.day === eq.day);
        return { data: single ? (picked[0] ?? null) : picked, error: null };
      }
      let picked = Object.keys(store.logs).sort().map((day) => ({ day, data: store.logs[day], updated_at: stamp() }));
      if (eq.day != null) picked = picked.filter((r) => r.day === eq.day);
      return { data: single ? (picked[0] ?? null) : picked, error: null };
    }
    // Writes: always succeed, with a new token. store.ts reads it back off `data` and takes it from there.
    if (table === "plans") return { data: [{ plan: (body as Row).plan, updated_at: stamp() }], error: null };
    const written = ([] as Row[]).concat(body);
    if (table === "logs") return { data: written.map((r) => ({ day: r.day, data: r.data, updated_at: stamp() })), error: null };
    return { data: null, error: null }; // health_days: saveHealth applies the rows itself once this resolves
  }
  return self;
}

/** Everything GymStore.startDemo needs `sb` to be. It never implements `.auth`: the demo signs in by setting the
 *  store's fields directly, with no real session to look up or sign out of, so that surface is left out on
 *  purpose (leaveDemo/exitDemo never call it). */
export function createDemoSupabase(store: GymStore): SupabaseClient {
  return { from: (table: string) => builder(store, table) } as unknown as SupabaseClient;
}

/* A Supabase client for the unit tests: one account's tables in memory, answering the store's queries as PostgREST
 * does. */
import { copy } from "@/lib/storage";
import type { GymStore } from "@/lib/store";
import type { DayLog, HealthDay, Plan } from "@/lib/types";

interface Row {
  data: unknown;
  updated_at: string;
}
type Body = Record<string, unknown>;
/** A write the store sent: its table, its rows and, for an upsert, its options. */
export interface Write {
  table: string;
  rows: Body[];
  opts?: { onConflict?: string; ignoreDuplicates?: boolean };
}
/** When the health_days rows were written. */
export const HEALTH_AT = "2026-09-23T04:12:00+00:00";

/**
 * Supabase for one account, in memory: tables `logs` and `plans`, whose rows get a new updated_at on every write, as
 * their triggers do, and `health_days`, which is `health` (by day). Queries run as PostgREST runs them: eq filters pick
 * the rows, an update returns the rows it changed (none when the version filter doesn't match), adding a row that's
 * there already fails with 23505, and an upsert that ignores duplicates leaves the rows there alone. With `failHealth`,
 * writes to health_days fail, as they do when the connection drops.
 *
 * `writes` records each write the store sent, and `sent` each request, in words. `elsewhere` and `planElsewhere` are
 * another device's saves. `holdNextLoad` holds back the answer to the next load of every day: `read` settles once it
 * has read the table, and it answers when released.
 */
export function fakeSupabase(health: Record<string, HealthDay> = {}, { failHealth = false } = {}) {
  const logs = new Map<string, Row>(), sent: string[] = [], writes: Write[] = [];
  let plan: Row | null = null, clock = 0, held: { answer: Promise<void>; read: () => void } | null = null;
  const stamp = () => `2026-09-23T06:00:00.${String(++clock).padStart(6, "0")}+00:00`;
  const duplicate = { code: "23505", message: "duplicate key value violates unique constraint" };

  function from(table: string) {
    let op: "select" | "insert" | "update" | "upsert" = "select", body: Body | Body[] = {}, opts: Write["opts"], one = false;
    const eq: Record<string, string> = {};
    const run = () => {
      sent.push([op, table, eq.day, eq.updated_at && `@${eq.updated_at}`].filter(Boolean).join(" "));
      if (op !== "select") writes.push({ table, rows: [body].flat(), opts });
      if (table === "logs") {
        const picked = [...logs.keys()].sort().filter((d) => (eq.day == null || d === eq.day) && (eq.updated_at == null || logs.get(d)!.updated_at === eq.updated_at));
        if (op === "select") {
          const rows = picked.map((d) => ({ day: d, data: copy(logs.get(d)!.data), updated_at: logs.get(d)!.updated_at }));
          const answer = { data: one ? (rows[0] ?? null) : rows, error: null }, h = eq.day == null ? held : null;
          if (!h) return answer;
          held = null;
          h.read();
          return h.answer.then(() => answer);
        }
        const b = body as Body;
        if (op === "insert") {
          const d = b.day as string;
          if (logs.has(d)) return { data: null, error: duplicate };
          logs.set(d, { data: copy(b.data), updated_at: stamp() });
          return { data: [{ updated_at: logs.get(d)!.updated_at }], error: null };
        }
        for (const d of picked) logs.set(d, { data: copy(b.data), updated_at: stamp() });
        return { data: picked.map((d) => ({ updated_at: logs.get(d)!.updated_at })), error: null };
      }
      if (table === "plans") {
        if (op === "select") return { data: plan ? { plan: copy(plan.data), updated_at: plan.updated_at } : null, error: null };
        if (op === "insert") {
          if (plan) return { data: null, error: duplicate };
        } else if (!plan || (eq.updated_at != null && plan.updated_at !== eq.updated_at)) return { data: [], error: null };
        plan = { data: copy((body as Body).plan), updated_at: stamp() };
        return { data: [{ updated_at: plan.updated_at }], error: null };
      }
      if (table === "health_days") {
        if (op === "select") return { data: Object.keys(health).sort().map((d) => ({ day: d, data: health[d], updated_at: HEALTH_AT })), error: null };
        if (failHealth) return { data: null, error: { message: "TypeError: Failed to fetch" } };
        for (const r of [body].flat()) if (!(opts?.ignoreDuplicates && (r.day as string) in health)) health[r.day as string] = r.data as HealthDay;
        return { data: null, error: null };
      }
      return { data: [], error: null };
    };
    const q = {
      select: () => q,
      insert: (v: Body | Body[]) => ((op = "insert"), (body = v), q),
      update: (v: Body) => ((op = "update"), (body = v), q),
      upsert: (v: Body | Body[], o?: Write["opts"]) => ((op = "upsert"), (body = v), (opts = o), q),
      eq: (col: string, v: string) => ((eq[col] = v), q),
      order: () => q,
      limit: () => q,
      maybeSingle: () => ((one = true), q),
      then: (ok: (r: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve().then(run).then(ok, bad),
    };
    return q;
  }
  return {
    sb: { from } as unknown as GymStore["sb"],
    sent,
    writes,
    health,
    row: (d: string) => logs.get(d) as { data: DayLog; updated_at: string } | undefined,
    plan: () => plan as { data: Plan; updated_at: string } | null,
    elsewhere: (d: string, data: DayLog) => void logs.set(d, { data: copy(data), updated_at: stamp() }),
    planElsewhere: (p: Plan) => void (plan = { data: copy(p), updated_at: stamp() }),
    holdNextLoad: () => {
      let release = () => {}, readIt = () => {};
      const read = new Promise<void>((r) => (readIt = r));
      held = { answer: new Promise<void>((r) => (release = r)), read: () => readIt() };
      return { read, release: () => release() };
    },
  };
}

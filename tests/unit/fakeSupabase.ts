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
 * the rows, a write gives back the columns it selects of the rows it wrote, an update writes none when the version
 * filter doesn't match, adding rows fails with 23505 when one of them is there already (and then adds none), and an
 * upsert that ignores duplicates leaves the rows there alone. With `failHealth`, writes to health_days fail, as they do
 * when the connection drops; `failWrites` does that to writes of the days it names.
 *
 * `writes` records each write the store sent, `sent` each request, in words, and `peak` the most requests under way at
 * once. `elsewhere` and `planElsewhere` are another device's saves. `holdNext` holds back the answer to the next load
 * of every day, or the next insert: `read` settles once it has reached the table, and it answers when released.
 */
export function fakeSupabase(health: Record<string, HealthDay> = {}, { failHealth = false } = {}) {
  const logs = new Map<string, Row>(), sent: string[] = [], writes: Write[] = [], failing = new Set<string>();
  let plan: Row | null = null, clock = 0, underWay = 0, peak = 0;
  let held: { kind: "load" | "insert"; answer: Promise<void>; read: () => void } | null = null;
  const stamp = () => `2026-09-23T06:00:00.${String(++clock).padStart(6, "0")}+00:00`;
  const duplicate = { code: "23505", message: "duplicate key value violates unique constraint" };

  function from(table: string) {
    let op: "select" | "insert" | "update" | "upsert" = "select", body: Body | Body[] = {}, opts: Write["opts"], columns = "*", one = false;
    const eq: Record<string, string> = {};
    /** The columns a write selected, of a row it wrote. */
    const pick = (r: Body) => (columns === "*" ? r : Object.fromEntries(columns.split(",").map((c) => [c, r[c]])));
    const answer = () => {
      const rows = [body].flat();
      if (op !== "select") writes.push({ table, rows, opts });
      if (table === "logs") {
        const picked = [...logs.keys()].sort().filter((d) => (eq.day == null || d === eq.day) && (eq.updated_at == null || logs.get(d)!.updated_at === eq.updated_at));
        const row = (d: string) => ({ day: d, data: copy(logs.get(d)!.data), updated_at: logs.get(d)!.updated_at });
        if (op === "select") return { data: one ? (picked.map(row)[0] ?? null) : picked.map(row), error: null };
        const days = op === "insert" ? rows.map((r) => r.day as string) : picked, stuck = days.find((d) => failing.has(d));
        if (stuck) return { data: null, error: { message: `couldn’t save ${stuck}` } };
        if (op === "insert" && days.some((d) => logs.has(d))) return { data: null, error: duplicate };
        if (op === "insert") for (const r of rows) logs.set(r.day as string, { data: copy(r.data), updated_at: stamp() });
        else for (const d of picked) logs.set(d, { data: copy((body as Body).data), updated_at: stamp() });
        return { data: days.map((d) => pick(row(d))), error: null };
      }
      if (table === "plans") {
        if (op === "select") return { data: plan ? { plan: copy(plan.data), updated_at: plan.updated_at } : null, error: null };
        if (op === "insert") {
          if (plan) return { data: null, error: duplicate };
        } else if (!plan || (eq.updated_at != null && plan.updated_at !== eq.updated_at)) return { data: [], error: null };
        plan = { data: copy((body as Body).plan), updated_at: stamp() };
        return { data: [pick({ plan: plan.data, updated_at: plan.updated_at })], error: null };
      }
      if (table === "health_days") {
        if (op === "select") return { data: Object.keys(health).sort().map((d) => ({ day: d, data: health[d], updated_at: HEALTH_AT })), error: null };
        if (failHealth) return { data: null, error: { message: "TypeError: Failed to fetch" } };
        for (const r of rows) if (!(opts?.ignoreDuplicates && (r.day as string) in health)) health[r.day as string] = r.data as HealthDay;
        return { data: null, error: null };
      }
      return { data: [], error: null };
    };
    const run = () => {
      const what = op === "insert" && table === "logs" ? (Array.isArray(body) ? `×${body.length}` : (body.day as string)) : eq.day;
      sent.push([op, table, what, eq.updated_at && `@${eq.updated_at}`].filter(Boolean).join(" "));
      const kind = op === "select" && table === "logs" && eq.day == null ? "load" : op === "insert" && table === "logs" ? "insert" : null;
      const h = held && held.kind === kind ? held : null, a = answer();
      if (!h) return a;
      held = null;
      h.read();
      return h.answer.then(() => a);
    };
    const q = {
      select: (cols?: string) => ((columns = op === "select" ? columns : (cols ?? "*")), q),
      insert: (v: Body | Body[]) => ((op = "insert"), (body = v), q),
      update: (v: Body) => ((op = "update"), (body = v), q),
      upsert: (v: Body | Body[], o?: Write["opts"]) => ((op = "upsert"), (body = v), (opts = o), q),
      eq: (col: string, v: string) => ((eq[col] = v), q),
      order: () => q,
      limit: () => q,
      maybeSingle: () => ((one = true), q),
      then: (ok: (r: unknown) => unknown, bad?: (e: unknown) => unknown) =>
        Promise.resolve()
          .then(() => ((peak = Math.max(peak, ++underWay)), run()))
          .finally(() => underWay--)
          .then(ok, bad),
    };
    return q;
  }
  return {
    sb: { from } as unknown as GymStore["sb"],
    sent,
    writes,
    health,
    peak: () => peak,
    row: (d: string) => logs.get(d) as { data: DayLog; updated_at: string } | undefined,
    plan: () => plan as { data: Plan; updated_at: string } | null,
    elsewhere: (d: string, data: DayLog) => void logs.set(d, { data: copy(data), updated_at: stamp() }),
    planElsewhere: (p: Plan) => void (plan = { data: copy(p), updated_at: stamp() }),
    failWrites: (...days: string[]) => (days.length ? days.forEach((d) => failing.add(d)) : failing.clear()),
    holdNext: (kind: "load" | "insert") => {
      let release = () => {}, readIt = () => {};
      const read = new Promise<void>((r) => (readIt = r));
      held = { kind, answer: new Promise<void>((r) => (release = r)), read: () => readIt() };
      return { read, release: () => release() };
    },
  };
}

/* A plan to share: its sessions, lifts, warm-ups and tempo, and the lifts of your own they use, as a small file another
 * Gym Log can start from (the plan editor's Share and Use a shared plan), and as a page to print or save as a PDF. Your
 * goals, My gym, favourites and anything logged stay out of both. */
import { MUSCLES } from "./library";
import { DOW } from "./dates";
import { targetWords } from "./session";
import type { CustomExercise, Plan } from "./types";

export const PLAN_FORMAT = "gymlog-plan";
export const PLAN_VERSION = 1;

export interface SharedPlan {
  format: typeof PLAN_FORMAT;
  version: number;
  plan: Pick<Plan, "tempo" | "warmups" | "days"> & { custom?: CustomExercise[] };
}

/** The file for `plan`: only what training it takes, and your own lifts that it names. */
export function sharedPlan(plan: Plan): SharedPlan {
  const named = new Set(plan.days.flatMap((d) => d.exercises.map((x) => x.name.toLowerCase())));
  const custom = (plan.custom ?? []).filter((c) => named.has(c.name.toLowerCase()));
  return { format: PLAN_FORMAT, version: PLAN_VERSION, plan: { tempo: plan.tempo, warmups: plan.warmups, days: plan.days, ...(custom.length ? { custom } : {}) } };
}

/** Why a file can't be used as a shared plan, in words. */
export class SharedPlanError extends Error {}

/** The plan in a shared plan's file, to be read with normalizePlan. Throws a SharedPlanError when it isn't one. */
export function readSharedPlan(text: string): Record<string, unknown> {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new SharedPlanError("it isn’t a plan shared from Gym Log");
  }
  const o = json as Partial<SharedPlan> | null;
  if (!o || typeof o !== "object" || o.format !== PLAN_FORMAT || !Number.isInteger(o.version)) throw new SharedPlanError("it isn’t a plan shared from Gym Log");
  if ((o.version as number) > PLAN_VERSION) throw new SharedPlanError("it comes from a newer version of Gym Log");
  if (!o.plan || typeof o.plan !== "object" || !Array.isArray(o.plan.days)) throw new SharedPlanError("its plan can’t be read");
  return o.plan as unknown as Record<string, unknown>;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);

/** The plan as a page to print, or save as a PDF from the print dialog: a table a day, rest days named, then the
 *  warm-ups and tempo. Plain black on white for paper, whatever the app's theme, in named colours rather than the app's tokens. */
export function planHtml(plan: Plan, title = "My training plan"): string {
  const muscles = (name: string) => {
    const own = plan.custom?.find((c) => c.name.toLowerCase() === name.toLowerCase());
    return own?.primary.length ? own.primary.map((m) => MUSCLES[m]).join(", ") : "";
  };
  const days = plan.days
    .map((d, i) => {
      if (!d.exercises.length) return `<section class="rest"><h2>${DOW[i]} · Rest</h2>${d.focus ? `<p>${esc(d.focus)}</p>` : ""}</section>`;
      const rows = d.exercises
        .map((x) => {
          const target = targetWords({ sets: x.sets, reps: x.reps }, x), rest = x.rest ? `${esc(x.rest)} s` : "";
          const notes = [x.superset ? "Superset with the lift above" : "", x.cue, x.flag, muscles(x.name)].filter(Boolean).map(esc).join(" · ");
          return `<tr><td>${esc(x.name)}</td><td>${esc(target)}</td><td>${rest}</td><td class="n">${notes}</td></tr>`;
        })
        .join("");
      const cardio = d.cardio.name ? `<p class="cardio">Then ${esc(d.cardio.name)}${d.cardio.detail ? `: ${esc(d.cardio.detail)}` : ""}</p>` : "";
      return `<section><h2>${DOW[i]} · ${esc(d.name)}</h2>${d.focus ? `<p>${esc(d.focus)}</p>` : ""}<table><thead><tr><th>Lift</th><th>Sets × reps</th><th>Rest</th><th>Notes</th></tr></thead><tbody>${rows}</tbody></table>${cardio}</section>`;
    })
    .join("");
  const warm = plan.warmups.length ? `<section><h2>Warm-ups</h2><ul>${plan.warmups.map((w) => `<li>${esc(w)}</li>`).join("")}</ul></section>` : "";
  const tempo = plan.tempo ? `<p>Tempo ${esc(plan.tempo)} on every lift, rest ${plan.restSec} s between sets unless a lift says otherwise.</p>` : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title><style>
body{font:14px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:black;background:white;margin:24px}
h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:18px 0 6px}p{margin:4px 0}
table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid lightgray;vertical-align:top}
th{font-size:12px;color:dimgray;font-weight:600}td.n{color:dimgray;font-size:12px}.rest h2{color:dimgray}.cardio{color:dimgray}
section{break-inside:avoid}@page{margin:14mm}
</style></head><body><h1>${esc(title)}</h1>${tempo}${days}${warm}</body></html>`;
}

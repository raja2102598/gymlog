/* Plans to start from: a new account picks one on its first screen, and the plan editor can start over from one.
 * Each is a whole plan, stored exactly as the app saves one (every field normalizePlan fills in), so it passes
 * normalizePlan unchanged. Only the five-day split, the plan every account used to start on (src/data/plan.json),
 * marks lifts knee-sensitive; with the others, knee tracking stays off until a lift is marked in the plan editor. */
import type { Plan } from "@/lib/types";
import blank from "./blank.json";
import fiveDay from "./five-day.json";
import fullBody3 from "./full-body-3.json";
import upperLower4 from "./upper-lower-4.json";

export interface PlanTemplate {
  id: string;
  name: string;
  /** The week in a few words, for choosing between them. */
  summary: string;
  plan: Plan;
}

// JSON reads "off" as any string: checked here, so every other field keeps its type.
const asPlan = (p: Omit<Plan, "effort"> & { effort: string }): Plan => ({ ...p, effort: p.effort === "rpe" || p.effort === "rir" ? p.effort : "off" });

export const TEMPLATES: readonly PlanTemplate[] = [
  { id: "blank", name: "Blank plan", summary: "Every day a rest day, ready for your own sessions and lifts.", plan: asPlan(blank) },
  { id: "full-body-3", name: "Full body, 3 days", summary: "3 days a week, 5 lifts a session: Monday, Wednesday and Friday.", plan: asPlan(fullBody3) },
  {
    id: "upper-lower-4",
    name: "Upper and lower, 4 days",
    summary: "4 days a week, 5 lifts a session: upper body Monday and Thursday, lower body Tuesday and Friday.",
    plan: asPlan(upperLower4),
  },
  { id: "five-day", name: "Five-day split", summary: "5 days a week, 5 or 6 lifts a session, with knee tracking on the leg days.", plan: asPlan(fiveDay) },
];

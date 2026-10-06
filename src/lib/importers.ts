/* Workouts from another app, from the CSV each exports: Strong, Hevy or FitNotes. Each is read into days of lifts and
 * their sets, which the store adds to the log (GymStore.importOtherApp). Weights in pounds become kg. A set with only a
 * time or a distance (cardio) is left out, and counted, since a set here is reps and a weight. */
import type { DayKey, SetLog, SetType } from "./types";

export type OtherApp = "Strong" | "Hevy" | "FitNotes";
export interface ImportedLift {
  name: string;
  sets: SetLog[];
}
export interface ImportedDay {
  day: DayKey;
  /** The workout's name in the other app, or "Workout" where it has none. */
  title: string;
  lifts: ImportedLift[];
}
export interface OtherAppImport {
  app: OtherApp;
  days: ImportedDay[];
  /** Sets read, and sets left out for having neither reps nor a weight. */
  sets: number;
  leftOut: number;
}

/** Why a file can't be read as another app's export. */
export class OtherAppError extends Error {}

const LB = 0.45359237;

/** CSV text as rows of fields (RFC 4180: quoted fields, doubled quotes, CRLF or LF), split on commas, or on semicolons
 *  when the header has more of them (Strong in some languages). A byte-order mark is dropped. */
export function parseCsv(text: string): string[][] {
  const t = text.replace(/^﻿/, ""), head = t.slice(0, t.search(/\r?\n|$/));
  const sep = (head.match(/;/g)?.length ?? 0) > (head.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (quoted) {
      if (c === '"' && t[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && t[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field || row.length) rows.push([...row, field]);
  return rows.filter((r) => r.some((f) => f.trim()));
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
/** The day a date field is on, as the app wrote it: "2024-03-28 18:05:00", "2024-03-28T…", or Hevy's "28 Mar 2024, 18:05". */
export function dayOf(v: string): DayKey | null {
  const s = v.trim(), iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = /^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?\s+(\d{4})/.exec(s), m = dmy ? MONTHS.indexOf(dmy[2].toLowerCase()) : -1;
  return dmy && m >= 0 ? `${dmy[3]}-${String(m + 1).padStart(2, "0")}-${dmy[1].padStart(2, "0")}` : null;
}

const number = (v: string | undefined): number | null => {
  const s = (v ?? "").trim().replace(",", ".");
  return s === "" || isNaN(+s) ? null : +s;
};

/** One set as a row gives it, before it's put in its day. */
interface Row {
  day: DayKey;
  title: string;
  lift: string;
  reps: number | null;
  /** In the row's unit: kg, or pounds when `lb`. */
  weight: number | null;
  lb: boolean;
  type?: SetType;
  rpe: number | null;
}

/** Reads a CSV export of Strong, Hevy or FitNotes, telling which from its header. Throws an OtherAppError when it's
 *  none of them, or has no sets. */
export function readOtherApp(text: string): OtherAppImport {
  const [header, ...body] = parseCsv(text);
  if (!header) throw new OtherAppError("the file is empty");
  const h = header.map((x) => x.trim().toLowerCase());
  const col = (...re: RegExp[]) => h.findIndex((x) => re.some((r) => r.test(x)));
  const at = (r: string[], i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");
  let app: OtherApp, read: (r: string[]) => Row | null;

  if (h.includes("exercise_title")) {
    // Hevy: title, start_time, exercise_title, set_type (normal, warmup, dropset, failure), weight_kg or weight_lbs, reps, rpe.
    app = "Hevy";
    const title = col(/^title$/), start = col(/^start_time$/), name = col(/^exercise_title$/), type = col(/^set_type$/), reps = col(/^reps$/), rpe = col(/^rpe$/);
    const kg = col(/^weight_kg$/), lb = col(/^weight_lbs$/);
    read = (r) => {
      const day = dayOf(at(r, start)), t = at(r, type).toLowerCase();
      if (!day) return null;
      const type_: SetType | undefined = t === "warmup" ? "warmup" : t === "dropset" ? "drop" : t === "failure" ? "failure" : undefined;
      return { day, title: at(r, title), lift: at(r, name), reps: number(at(r, reps)), weight: number(at(r, kg >= 0 ? kg : lb)), lb: kg < 0 && lb >= 0, type: type_, rpe: number(at(r, rpe)) };
    };
  } else if (col(/^exercise name$/) >= 0 && col(/^set order$/) >= 0) {
    // Strong: Date, Workout Name, Exercise Name, Set Order (a number, or W, D, F), Weight (or Weight (kg) / (lbs), or
    // a Weight Unit column), Reps, RPE.
    app = "Strong";
    const date = col(/^date$/), title = col(/^workout name$/), name = col(/^exercise name$/), order = col(/^set order$/), reps = col(/^reps$/), rpe = col(/^rpe$/);
    const weight = col(/^weight( \((kg|kgs|lb|lbs)\))?$/), unit = col(/^weight unit$/), lbHead = /lb/.test(h[weight] ?? "");
    read = (r) => {
      const day = dayOf(at(r, date)), o = at(r, order).toUpperCase();
      if (!day) return null;
      const type: SetType | undefined = o === "W" ? "warmup" : o === "D" ? "drop" : o === "F" ? "failure" : undefined;
      return { day, title: at(r, title), lift: at(r, name), reps: number(at(r, reps)), weight: number(at(r, weight)), lb: lbHead || /lb/i.test(at(r, unit)), type, rpe: number(at(r, rpe)) };
    };
  } else if (col(/^exercise$/) >= 0 && col(/^weight \((kg|kgs|lb|lbs)\)$/) >= 0) {
    // FitNotes: Date, Exercise, Category, Weight (kgs) or Weight (lbs), Reps, Distance, Time, Comment.
    app = "FitNotes";
    const date = col(/^date$/), name = col(/^exercise$/), weight = col(/^weight \((kg|kgs|lb|lbs)\)$/), reps = col(/^reps$/), lb = /lb/.test(h[weight]);
    read = (r) => {
      const day = dayOf(at(r, date));
      return day ? { day, title: "", lift: at(r, name), reps: number(at(r, reps)), weight: number(at(r, weight)), lb, rpe: null } : null;
    };
  } else throw new OtherAppError("it isn’t a CSV export from Strong, Hevy or FitNotes");

  const days = new Map<DayKey, ImportedDay>();
  let sets = 0, leftOut = 0;
  for (const r of body) {
    const row = read(r);
    if (!row || !row.lift) continue;
    const reps = row.reps != null && row.reps > 0 ? Math.round(row.reps) : null;
    // Pounds to kg, to the hundredth; nothing for no weight, and for 0, a bodyweight set.
    const kg = row.weight != null && row.weight > 0 ? Math.round((row.lb ? row.weight * LB : row.weight) * 100) / 100 : null;
    if (reps == null && kg == null) {
      leftOut++;
      continue;
    }
    const d = days.get(row.day) ?? { day: row.day, title: row.title || "Workout", lifts: [] };
    days.set(row.day, d);
    let lift = d.lifts.find((l) => l.name === row.lift);
    if (!lift) d.lifts.push((lift = { name: row.lift, sets: [] }));
    const s: SetLog = { reps, kg };
    if (row.type) s.type = row.type;
    if (row.rpe != null && row.rpe >= 1 && row.rpe <= 10) s.rpe = Math.round(row.rpe * 2) / 2;
    lift.sets.push(s);
    sets++;
  }
  if (!sets) throw new OtherAppError(`it’s from ${app}, but has no sets with reps or a weight`);
  return { app, days: [...days.values()].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0)), sets, leftOut };
}

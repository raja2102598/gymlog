/* Settings → Your data: one versioned JSON file with the plan, every logged day and the Health Connect days, so an
 * export can restore an account, and a CSV with a row for each set. The store gathers and applies them (store.ts);
 * reading a file and writing CSV text happen here. */
import { plural } from "./format";
import type { DayKey, DayLog, HealthDay, Plan } from "./types";

export const BACKUP_FORMAT = "gymlog-backup";
export const BACKUP_VERSION = 1;

/** One logged day, as exports have always written it. The first exports were a bare list of these. */
export interface LogRow {
  day: DayKey;
  data: DayLog;
}

export interface Backup {
  format: typeof BACKUP_FORMAT;
  version: number;
  /** When the file was made (ISO). */
  exportedAt: string;
  /** Null when it's the app's default plan, as it is for an account that never saved one. */
  plan: Plan | null;
  logs: LogRow[];
  healthDays: Record<DayKey, HealthDay>;
}

/** What a file holds. */
export interface BackupContents {
  logs: LogRow[];
  /** The plan as the file has it, to be read with normalizePlan; "default" when the account the file came from used
   *  the app's default plan (a backup writes null for it); or null when the file says nothing about the plan, as the
   *  older list of days doesn't. */
  plan: Record<string, unknown> | "default" | null;
  healthDays: Record<DayKey, HealthDay>;
}

/** Why a file can't be imported, in words, and what to do instead. */
export class ImportError extends Error {
  constructor(why: string, readonly hint = "Choose a .json file exported from Gym Log.") {
    super(why);
  }
}

const isDay = (k: unknown): k is DayKey => typeof k === "string" && /^\d{4}-\d{2}-\d{2}$/.test(k);
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Reads an export of either kind: a backup, or the older list of days. Throws an ImportError when it's neither. */
export function readBackup(text: string): BackupContents {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (err) {
    throw new ImportError((err as Error).message);
  }
  // Rows that aren't a day are left out, as they always were.
  const rows = (list: unknown[]) => list.filter((r): r is LogRow => isObject(r) && isDay(r.day) && isObject(r.data));
  if (Array.isArray(json)) return { logs: rows(json), plan: null, healthDays: {} };
  if (!isObject(json) || json.format !== BACKUP_FORMAT || !Number.isInteger(json.version) || (json.version as number) < 1) throw new ImportError("it isn’t a Gym Log export");
  if ((json.version as number) > BACKUP_VERSION) throw new ImportError("it comes from a newer version of Gym Log", "Update Gym Log, then try again.");
  const { logs = [], plan = null, healthDays = {} } = json;
  if (!Array.isArray(logs)) throw new ImportError("its logged days can’t be read");
  if (plan !== null && !isObject(plan)) throw new ImportError("its plan can’t be read");
  if (!isObject(healthDays)) throw new ImportError("its Health Connect days can’t be read");
  return {
    logs: rows(logs),
    plan: plan === null ? "default" : plan,
    healthDays: Object.fromEntries(Object.entries(healthDays).filter(([k, d]) => isDay(k) && isObject(d))) as Record<DayKey, HealthDay>,
  };
}

/** What a backup holds, in words: "30 days, the plan and Health Connect data for 12 days". */
export function backupWords(days: number, plan: boolean, healthDays: number): string {
  const parts = [days || !(plan || healthDays) ? plural(days, "day") : "", plan ? "the plan" : "", healthDays ? `Health Connect data for ${plural(healthDays, "day")}` : ""].filter(Boolean);
  return parts.length < 2 ? parts.join("") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/* ---------- CSV ---------- */

export type CsvValue = string | number | boolean | null | undefined;
/** Export workouts as CSV: a row for each logged set. */
export const CSV_COLUMNS = ["day", "session", "lift", "set", "reps", "kg", "type", "rpe", "rir", "skipped", "swapped_for", "note"];

/** A field as CSV writes it: in quotes, with its quotes doubled, when it holds a quote, a comma or a line break. Text
 *  starting with =, +, -, @, a tab or a carriage return gets a ' in front first, so a spreadsheet shows it rather than
 *  running it as a formula: a note like "+1 rep next week" would otherwise be an error, or a formula from an imported
 *  file could run. Numbers are written as they are. */
export function csvField(v: CsvValue): string {
  let s = v == null ? "" : String(v);
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Rows as CSV text: fields apart by commas, each row ending in CRLF (RFC 4180). */
export const toCsv = (rows: CsvValue[][]): string => rows.map((r) => r.map(csvField).join(",") + "\r\n").join("");

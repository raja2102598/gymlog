/* Voice logging: what someone said to a lift card, read as a set ("ten at forty five") or a command ("again").
 * Pure, so it's tested on its own; src/lib/speech.ts does the listening. It never guesses: a phrase it can't read
 * for certain is "unknown", and the card says how to put it instead. */

export type VoiceCommand = "again" | "undo" | "done" | "skip";
export type VoiceResult = { kind: "set"; reps: number; kg: number | null } | { kind: "command"; command: VoiceCommand } | { kind: "unknown" };

const unknown = (): VoiceResult => ({ kind: "unknown" });

/** A lookup table without Object's own keys, so a word like "constructor" isn't found in it. */
const table = <T,>(entries: Record<string, T>): Record<string, T> => Object.assign(Object.create(null) as Record<string, T>, entries);

const COMMANDS = table<VoiceCommand>({
  again: "again",
  same: "again",
  "same again": "again",
  repeat: "again",
  undo: "undo",
  "scratch that": "undo",
  "delete that": "undo",
  done: "done",
  finished: "done",
  "thats it": "done",
  skip: "skip",
  "skip it": "skip",
  "skip this": "skip",
});

/** Words that change nothing: "log a set of 10 at 45, please". */
const FILLER = new Set(["log", "set", "please", "okay", "ok", "and", "um", "uh", "of", "a"]);
const REPS = new Set(["rep", "reps", "repetition", "repetitions"]);
const KG = new Set(["kg", "kgs", "kilo", "kilos", "kilogram", "kilograms", "kilogramme", "kilogrammes"]);
/** The app logs kilograms, so a weight in pounds is refused rather than read as kilograms. */
const POUNDS = new Set(["lb", "lbs", "pound", "pounds"]);
/** "10 at 45", "10 x 45": reps, then kg. */
const REPS_FIRST = new Set(["at", "@", "times", "x", "×", "by"]);
/** "45 for 10": kg, then reps. */
const KG_FIRST = new Set(["for"]);

const ONES = table({ zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 });
const TEENS = table({ ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 });
const TENS = table({ twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 });

/** A number written with commas: thousands when every group after the first has three digits ("1,000",
 *  "1,000,000"), or a decimal point when it has one comma ("22,5"). Any other grouping ("1,00,000") is left for
 *  words() to split into several numbers, which makes the phrase unknown. */
const commas = (n: string) => (/^\d{1,3}(,\d{3})+$/.test(n) ? n.replace(/,/g, "") : /^\d+,\d+$/.test(n) ? n.replace(",", ".") : n);

/** Lower case, split into words, with a number's unit or "x" split off it ("45kg", "10x45") and "forty-five" as two
 *  words. Commas in a number are read by commas(). */
function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/\d+(?:,\d+)+/g, commas)
    .replace(/[×@]/g, " $& ")
    .replace(/(\d)([a-z])/g, "$1 $2")
    .replace(/([a-z])(\d)/g, "$1 $2")
    .replace(/\.(?!\d)/g, " ")
    .replace(/[^a-z0-9.×@]+/g, " ")
    .split(" ")
    .filter(Boolean);
}

const below100 = (w: string | undefined) => w != null && (w in TENS || w in TEENS || ONES[w] > 0);

/** A whole number from zero to 999 in words: "twelve", "forty five", "a hundred", "one hundred and twenty". */
function wholeWords(ws: string[], i: number): { v: number; next: number } | null {
  let v = 0, j = i, found = false;
  const lead = ws[j] === "a" ? 1 : ONES[ws[j]];
  if (lead > 0 && ws[j + 1] === "hundred") {
    v = lead * 100;
    j += 2;
    found = true;
  } else if (ws[j] === "hundred") {
    v = 100;
    j++;
    found = true;
  }
  if (found && ws[j] === "and" && below100(ws[j + 1])) j++;
  if (ws[j] in TENS) {
    v += TENS[ws[j++]];
    if (ONES[ws[j]] > 0) v += ONES[ws[j++]];
    found = true;
  } else if (ws[j] in TEENS) {
    v += TEENS[ws[j++]];
    found = true;
  } else if (ws[j] in ONES && !(found && ONES[ws[j]] === 0)) {
    v += ONES[ws[j++]];
    found = true;
  }
  return found ? { v, next: j } : null;
}

/** A number starting at word i, in digits ("22.5") or words, with "point five", "point two five" or "and a half"
 *  after it; "point five" on its own is 0.5. */
function readNumber(ws: string[], i: number): { v: number; next: number } | null {
  let v: number | null = null, j = i;
  if (/^(\d+(\.\d+)?|\.\d+)$/.test(ws[j])) v = parseFloat(ws[j++]);
  else {
    const w = wholeWords(ws, j);
    if (w) {
      v = w.v;
      j = w.next;
    }
  }
  if (v == null || Number.isInteger(v)) {
    if (ws[j] === "point") {
      let digits = "", k = j + 1;
      for (; k < ws.length; k++) {
        const d = ws[k] in ONES ? String(ONES[ws[k]]) : /^\d+$/.test(ws[k]) ? ws[k] : "";
        if (!d) break;
        digits += d;
      }
      if (digits) {
        v = parseFloat(`${v ?? 0}.${digits}`);
        j = k;
      }
    } else if (v != null && ws[j] === "and" && ws[j + 1] === "a" && ws[j + 2] === "half") {
      v += 0.5;
      j += 3;
    }
  }
  return v == null ? null : { v, next: j };
}

type Token = { t: "n"; v: number } | { t: "reps" | "kg" | "lb" | "repsFirst" | "kgFirst" | "word" };

function tokens(ws: string[]): Token[] {
  const out: Token[] = [];
  for (let i = 0; i < ws.length; ) {
    const n = readNumber(ws, i);
    if (n) {
      out.push({ t: "n", v: n.v });
      i = n.next;
      continue;
    }
    const w = ws[i++];
    if (FILLER.has(w)) continue;
    out.push({ t: REPS.has(w) ? "reps" : KG.has(w) ? "kg" : POUNDS.has(w) ? "lb" : REPS_FIRST.has(w) ? "repsFirst" : KG_FIRST.has(w) ? "kgFirst" : "word" });
  }
  return out;
}

const SHAPE: Record<Token["t"], string> = { n: "n", reps: "r", kg: "k", lb: "l", repsFirst: "a", kgFirst: "f", word: "w" };

/**
 * What a phrase says: a set, a command, or unknown.
 * Sets: "10 at 45", "10 @ 45", "10 reps at 45 kilos", "45 kg for 10 reps", "45 for 10", "10 times|x|×|by 45",
 * "10 reps 45 kg", "45 kg 10 reps", and "10 reps" alone (kg null). A unit says which number is which; without one,
 * "at", "@", "times", "x", "×" and "by" put reps first and "for" puts kg first.
 * Unknown: pounds, more than two numbers, reps that aren't a whole number from 1 to 100, kg outside 0 to 1000, and
 * any word it doesn't know.
 */
export function parseSetPhrase(text: string): VoiceResult {
  // A minus sign before a number ("-45", "at-45", "10x-45") would be dropped with the other punctuation: refuse it
  // instead. "forty-five" has no digit after its hyphen.
  if (/[-\u2212\u2013]\s*\.?\d/.test(text)) return unknown();
  const ws = words(text);
  const command = COMMANDS[ws.filter((w) => !FILLER.has(w)).join(" ")];
  if (command) return { kind: "command", command };

  const toks = tokens(ws), nums = toks.flatMap((t) => (t.t === "n" ? [t.v] : []));
  const shape = toks.map((t) => SHAPE[t.t]).join("");
  let reps: number, kg: number | null;
  if (shape === "nr") [reps, kg] = [nums[0], null];
  else {
    const m = /^n([rk]?)([af]?)n([rk]?)$/.exec(shape);
    if (!m) return unknown();
    const [, u1, link, u2] = m;
    if ((u1 && u1 === u2) || !(u1 || u2 || link)) return unknown();
    const repsFirst = u1 === "r" || u2 === "k" || (!u1 && !u2 && link === "a");
    [reps, kg] = repsFirst ? [nums[0], nums[1]] : [nums[1], nums[0]];
  }
  if (!Number.isInteger(reps) || reps < 1 || reps > 100 || (kg != null && (kg < 0 || kg > 1000))) return unknown();
  return { kind: "set", reps, kg };
}

/** The first of the recognizer's guesses that reads as a set or a command, and its words; otherwise the top guess,
 *  unknown. */
export function bestAlternative(alternatives: string[]): { text: string; result: VoiceResult } {
  for (const text of alternatives) {
    const result = parseSetPhrase(text);
    if (result.kind !== "unknown") return { text: text.trim(), result };
  }
  return { text: (alternatives[0] ?? "").trim(), result: unknown() };
}

export const bestParse = (alternatives: string[]): VoiceResult => bestAlternative(alternatives).result;

import { describe, expect, it } from "vitest";
import { bestAlternative, bestParse, parseSetPhrase, type VoiceResult } from "@/lib/voice";

const set = (reps: number, kg: number | null): VoiceResult => ({ kind: "set", reps, kg });
const command = (c: "again" | "undo" | "done" | "skip"): VoiceResult => ({ kind: "command", command: c });
const unknown: VoiceResult = { kind: "unknown" };
/** Every phrase, read the same way. */
const each = (phrases: string[], want: VoiceResult) => {
  for (const p of phrases) expect([p, parseSetPhrase(p)]).toEqual([p, want]);
};

describe("parseSetPhrase: the ways to say a set", () => {
  it("<reps> at <kg> and <reps> @ <kg>", () => {
    each(["10 at 45", "ten at forty five", "Ten at 45.", "10 @ 45", "10@45", "10 @45"], set(10, 45));
  });

  it("<reps> reps at <kg> with any kilogram unit", () => {
    each(
      ["10 reps at 45 kilos", "10 reps at 45 kilo", "10 reps at 45 kg", "10 reps at 45 kgs", "10 reps at 45 kilograms", "10 reps at 45kg", "ten reps at forty five KG", "10 rep at 45 kilogrammes"],
      set(10, 45),
    );
    each(["10 at 45 kg", "10 at 45 kilos"], set(10, 45));
  });

  it("<kg> kg for <reps> reps, and <kg> for <reps>", () => {
    each(["45 kg for 10 reps", "45 kilos for 10 reps", "45 for 10", "forty five for ten", "45 kg for 10"], set(10, 45));
  });

  it("<reps> times, x, × or by <kg>", () => {
    each(["10 times 45", "10 x 45", "10x45", "10 × 45", "10×45", "10 by 45", "ten times forty five", "10 x 45 kg"], set(10, 45));
  });

  it("<reps> reps <kg> kg, and <kg> kg <reps> reps, with no word between", () => {
    each(["10 reps 45 kg", "ten reps forty five kilos", "45 kg 10 reps", "45kg 10reps", "forty five kilos ten reps"], set(10, 45));
  });

  it("<reps> reps alone: the weight is left to the card", () => {
    each(["10 reps", "ten reps", "10 rep", "log 10 reps please", "10reps"], set(10, null));
    expect(parseSetPhrase("twelve reps")).toEqual(set(12, null));
    expect(parseSetPhrase("1 rep")).toEqual(set(1, null));
    expect(parseSetPhrase("100 reps")).toEqual(set(100, null));
  });

  it("ignores filler words", () => {
    each(
      ["log a set of 10 at 45", "log set 10 at 45 please", "okay 10 at 45", "OK, ten at forty five", "um 10 at uh 45", "and 10 at 45", "10 at 45 please", "set of ten at forty five"],
      set(10, 45),
    );
  });
});

describe("parseSetPhrase: numbers", () => {
  it("reads number words from zero to 999", () => {
    expect(parseSetPhrase("twelve at twenty")).toEqual(set(12, 20));
    expect(parseSetPhrase("eight at forty-five")).toEqual(set(8, 45));
    expect(parseSetPhrase("eight at forty five")).toEqual(set(8, 45));
    expect(parseSetPhrase("five at one hundred and twenty")).toEqual(set(5, 120));
    expect(parseSetPhrase("five at one hundred twenty")).toEqual(set(5, 120));
    expect(parseSetPhrase("five at a hundred")).toEqual(set(5, 100));
    expect(parseSetPhrase("five at a hundred and five")).toEqual(set(5, 105));
    expect(parseSetPhrase("three at two hundred and fifty")).toEqual(set(3, 250));
    expect(parseSetPhrase("one at nine hundred and ninety nine")).toEqual(set(1, 999));
    expect(parseSetPhrase("nineteen at seventy")).toEqual(set(19, 70));
    expect(parseSetPhrase("ten at zero")).toEqual(set(10, 0));
    expect(parseSetPhrase("one hundred reps")).toEqual(set(100, null));
    expect(parseSetPhrase("one rep at sixty")).toEqual(set(1, 60));
  });

  it("reads decimals in digits, with a point or a comma", () => {
    expect(parseSetPhrase("8 at 22.5")).toEqual(set(8, 22.5));
    expect(parseSetPhrase("8 at 22,5")).toEqual(set(8, 22.5));
    expect(parseSetPhrase("8 at 22,25 kg")).toEqual(set(8, 22.25));
    expect(parseSetPhrase("8 at 22.5kg")).toEqual(set(8, 22.5));
    expect(parseSetPhrase("12 at 1,000")).toEqual(set(12, 1000));
  });

  it("refuses a number with a minus sign, rather than dropping the sign", () => {
    expect(parseSetPhrase("10 at -45")).toEqual(unknown);
    expect(parseSetPhrase("-10 at 45")).toEqual(unknown);
    expect(parseSetPhrase("10 at − 45")).toEqual(unknown);
    expect(parseSetPhrase("10 at forty-five")).toEqual(set(10, 45));
  });

  it("reads every thousands group of a number, and refuses one grouped any other way", () => {
    expect(parseSetPhrase("10 at 1,000,000")).toEqual(unknown);
    expect(parseSetPhrase("10 at 1,000,000 kg")).toEqual(unknown);
    expect(parseSetPhrase("10 at 1,00,000")).toEqual(unknown);
    expect(parseSetPhrase("10 at 22,500")).toEqual(unknown);
    expect(parseSetPhrase("10 at 1,2,5")).toEqual(unknown);
  });

  it('reads "point five", "point two five" and "and a half"', () => {
    expect(parseSetPhrase("eight at twenty two point five")).toEqual(set(8, 22.5));
    expect(parseSetPhrase("eight at twenty two point two five")).toEqual(set(8, 22.25));
    expect(parseSetPhrase("8 at 22 point 5")).toEqual(set(8, 22.5));
    expect(parseSetPhrase("eight at twenty two and a half")).toEqual(set(8, 22.5));
    expect(parseSetPhrase("8 at 22 and a half kilos")).toEqual(set(8, 22.5));
    expect(parseSetPhrase("six at a hundred and a half")).toEqual(set(6, 100.5));
    expect(parseSetPhrase("twelve at point five")).toEqual(set(12, 0.5));
  });
});

describe("parseSetPhrase: which number is which", () => {
  it("units decide when they're there", () => {
    expect(parseSetPhrase("45 kg at 10")).toEqual(set(10, 45));
    expect(parseSetPhrase("10 at 45 reps")).toEqual(set(45, 10));
    expect(parseSetPhrase("10 reps for 45")).toEqual(set(10, 45));
    expect(parseSetPhrase("12 reps for 45 kg")).toEqual(set(12, 45));
    expect(parseSetPhrase("45 kilos by 12")).toEqual(set(12, 45));
    expect(parseSetPhrase("10 reps 45")).toEqual(set(10, 45));
    expect(parseSetPhrase("10 45 kg")).toEqual(set(10, 45));
    expect(parseSetPhrase("45 kg 10")).toEqual(set(10, 45));
  });

  it('otherwise "at", "@", "times", "x", "×" and "by" put reps first, and "for" puts kg first', () => {
    expect(parseSetPhrase("12 at 40")).toEqual(set(12, 40));
    expect(parseSetPhrase("12 times 40")).toEqual(set(12, 40));
    expect(parseSetPhrase("40 for 12")).toEqual(set(12, 40));
    expect(parseSetPhrase("12 for 40")).toEqual(set(40, 12));
    expect(parseSetPhrase("12 by 40")).toEqual(set(12, 40));
  });
});

describe("parseSetPhrase: commands", () => {
  it("again", () => each(["again", "same", "same again", "repeat", "Again.", "okay same again please"], command("again")));
  it("undo", () => each(["undo", "scratch that", "delete that", "Scratch that!", "undo please"], command("undo")));
  it("done", () => each(["done", "finished", "that's it", "that’s it", "thats it", "okay done", "Done."], command("done")));
  it("skip", () => each(["skip", "skip it", "skip this", "Skip it.", "skip this set"], command("skip")));
  it("a command with a set in it is neither", () => {
    each(["10 at 45 done", "again 10 at 45", "skip 10 reps"], unknown);
  });
});

describe("parseSetPhrase: what it refuses rather than guess", () => {
  it("pounds", () => {
    each(["10 at 45 pounds", "10 at 100 lbs", "10 at 45 lb", "ten at a hundred pounds", "45 pounds for 10"], unknown);
  });

  it("more than two numbers", () => {
    each(["3 sets of 10 at 45", "set 2 10 at 45", "ten at forty and five", "10 at 45 at 50"], unknown);
  });

  it("reps that aren't a whole number from 1 to 100", () => {
    each(["10.5 at 45", "ten and a half at forty", "0 at 45", "zero reps", "101 reps", "150 at 20", "45 kg for 0 reps"], unknown);
  });

  it("kg outside 0 to 1000", () => {
    expect(parseSetPhrase("10 at 1000")).toEqual(set(10, 1000));
    each(["10 at 1001", "10 at 5000 kg", "2 at 1,500"], unknown);
  });

  it("a number with nothing to say what it is", () => {
    each(["45", "ten", "45 kg", "10 45", "ten forty five", "10 at", "at 45", "reps 10"], unknown);
  });

  it("the same unit twice", () => {
    each(["10 reps 12 reps", "10 kg at 45 kg"], unknown);
  });

  it("words it doesn't know, and nothing at all", () => {
    each(["ten at forty five on the leg press", "hello", "", "   ", "10 at 45 point", "at", "play some music", "constructor", "toString at 5", "1.2.3 at 5"], unknown);
  });
});

describe("bestParse and bestAlternative", () => {
  it("takes the first alternative that reads as a set or a command", () => {
    expect(bestParse(["turn at forty five", "ten at forty five", "10 at 40"])).toEqual(set(10, 45));
    expect(bestParse(["hello", "done"])).toEqual(command("done"));
    expect(bestParse(["10 at 45", "again"])).toEqual(set(10, 45));
    expect(bestAlternative(["turn at forty five", " ten at forty five"])).toEqual({ text: "ten at forty five", result: set(10, 45) });
  });

  it("is unknown when none does, with the top alternative's words", () => {
    expect(bestParse(["hello", "world"])).toEqual(unknown);
    expect(bestParse([])).toEqual(unknown);
    expect(bestAlternative(["play some music ", "play sum music"])).toEqual({ text: "play some music", result: unknown });
    expect(bestAlternative([])).toEqual({ text: "", result: unknown });
  });
});

import { describe, expect, it } from "vitest";
import { setsSummary } from "@/lib/format";
import { targetWords } from "@/lib/session";

describe("setsSummary", () => {
  const s = (reps: number | null, kg: number | null) => ({ reps, kg });
  const said = (sets: Parameters<typeof setsSummary>[0]) => setsSummary(sets).replace(/\u00a0/g, " ");
  it("reads sets at one weight as reps × kg", () => {
    expect(said([s(10, 45), s(10, 45), s(8, 45)])).toBe("10, 10, 8 × 45 kg");
    expect(said([s(10, 20)])).toBe("10 × 20 kg");
  });
  it("lists each set when the weight changed", () => {
    expect(said([s(10, 40), s(8, 45)])).toBe("10 × 40, 8 × 45 kg");
  });
  it("handles older weight-only entries, reps with no weight, and empty sets", () => {
    expect(said([s(null, 50)])).toBe("50 kg");
    expect(said([s(12, null), s(10, null)])).toBe("12, 10 reps");
    expect(said([s(null, null), s(10, 0)])).toBe("10 × 0 kg");
    expect(said([])).toBe("");
  });
  it("marks sets to failure, drop sets and rest-pause bursts, leaving plain working sets as they read", () => {
    const typed = (reps: number, kg: number, type: "failure" | "drop" | "restpause") => ({ reps, kg, type });
    expect(said([s(10, 45), typed(8, 45, "failure")])).toBe("10, 8F × 45 kg");
    expect(said([s(10, 45), typed(12, 30, "drop")])).toBe("10 × 45, 12D × 30 kg");
    expect(said([s(10, 45), typed(4, 45, "restpause")])).toBe("10, 4R × 45 kg");
  });
  it("reads a hold's reps as seconds, and a lift done one side at a time as each side", () => {
    const sec = (sets: Parameters<typeof setsSummary>[0], unit: Parameters<typeof setsSummary>[1]) => setsSummary(sets, unit).replace(/\u00a0/g, " ");
    expect(sec([s(45, null), s(40, null)], "sec")).toBe("45s, 40s");
    expect(sec([s(45, 10), s(40, 10)], "sec")).toBe("45s, 40s × 10 kg");
    expect(sec([s(10, null), s(10, null)], "side")).toBe("10, 10 reps each side");
    expect(sec([s(10, 20), s(8, 22)], "side")).toBe("10 × 20, 8 × 22 kg each side");
    expect(targetWords({ sets: "3", reps: "30-45" }, { timed: true })).toBe("3 × 30–45 s");
    expect(targetWords({ sets: "3", reps: "10" }, { perSide: true })).toBe("3 × 10 each side");
    expect(targetWords({ sets: "3", reps: "8-10" })).toBe("3 × 8–10");
  });
  it("only breaks a line after a comma, never inside 8 × 45 kg", () => {
    expect(setsSummary([s(10, 40), s(8, 45)])).toBe("10\u00a0×\u00a040, 8\u00a0×\u00a045\u00a0kg");
    expect(setsSummary([s(10, 45), s(8, 45)])).toBe("10, 8\u00a0×\u00a045\u00a0kg");
  });
});

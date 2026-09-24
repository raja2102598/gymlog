import { describe, expect, it } from "vitest";
import { setsSummary } from "@/lib/format";

describe("setsSummary", () => {
  const s = (reps: number | null, kg: number | null) => ({ reps, kg });
  const said = (sets: ReturnType<typeof s>[]) => setsSummary(sets).replace(/\u00a0/g, " ");
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
  it("only breaks a line after a comma, never inside 8 × 45 kg", () => {
    expect(setsSummary([s(10, 40), s(8, 45)])).toBe("10\u00a0×\u00a040, 8\u00a0×\u00a045\u00a0kg");
    expect(setsSummary([s(10, 45), s(8, 45)])).toBe("10, 8\u00a0×\u00a045\u00a0kg");
  });
});

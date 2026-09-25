import { describe, expect, it } from "vitest";
import { depthOf, hashOf, parentOf, routeOf, sameRoute, tabOf } from "@/lib/route";

describe("routing", () => {
  it("reads and writes a metric's address", () => {
    expect(routeOf("#health/sleep")).toEqual({ view: "health", metric: "sleep" });
    expect(hashOf({ view: "health", metric: "sleep" })).toBe("#health/sleep");
    expect(routeOf("#health/nonsense")).toEqual({ view: "today" }); // not a real metric: falls back to Today
  });

  it("reads and writes a lift's address, encoding names that aren't plain words", () => {
    expect(routeOf("#progress/lift/Leg%20Press")).toEqual({ view: "progress", lift: "Leg Press" });
    expect(hashOf({ view: "progress", lift: "Leg Press" })).toBe("#progress/lift/Leg%20Press");
    // A name with a slash or an accent round-trips too.
    const tricky = "Squat / Front-Squat (café)";
    expect(routeOf(hashOf({ view: "progress", lift: tricky }))).toEqual({ view: "progress", lift: tricky });
    // A link mangled by hand can't be decoded: Progress opens, rather than the app failing to start.
    expect(routeOf("#progress/lift/100%")).toEqual({ view: "progress" });
  });

  it("puts a lift's page at the same depth as a metric's, under Progress, with no change to plain Progress", () => {
    expect(depthOf({ view: "progress", lift: "Leg Press" })).toBe(2);
    expect(depthOf({ view: "progress" })).toBe(1);
    expect(parentOf({ view: "progress", lift: "Leg Press" })).toEqual({ view: "progress" });
    expect(tabOf({ view: "progress", lift: "Leg Press" })).toBe("progress");
  });

  it("puts My gym under Settings, as deep as the plan editor", () => {
    expect(routeOf("#gym")).toEqual({ view: "gym" });
    expect(hashOf({ view: "gym" })).toBe("#gym");
    expect(depthOf({ view: "gym" })).toBe(2);
    expect(parentOf({ view: "gym" })).toEqual({ view: "settings" });
    expect(tabOf({ view: "gym" })).toBe("settings");
  });

  it("tells a lift's route apart from plain Progress and from another lift", () => {
    const a = { view: "progress" as const, lift: "Leg Press" }, b = { view: "progress" as const, lift: "Bench Press" };
    expect(sameRoute(a, { ...a })).toBe(true);
    expect(sameRoute(a, b)).toBe(false);
    expect(sameRoute(a, { view: "progress" })).toBe(false);
  });
});

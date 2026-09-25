import { describe, expect, it } from "vitest";
import { depthOf, hashOf, isPushed, parentOf, routeOf, sameRoute, tabOf } from "@/lib/route";

describe("routing", () => {
  it("reads and writes a metric's address", () => {
    expect(routeOf("#health/sleep")).toEqual({ view: "health", metric: "sleep" });
    expect(hashOf({ view: "health", metric: "sleep" })).toBe("#health/sleep");
    expect(routeOf("#health/nonsense")).toEqual({ view: "home" }); // not a real metric: falls back to Home
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

  it("puts a lift's page under Progress, a level deeper than the workout it also opens from, with no change to plain Progress", () => {
    expect(depthOf({ view: "progress", lift: "Leg Press" })).toBe(3);
    expect(depthOf({ view: "progress" })).toBe(1);
    expect(parentOf({ view: "progress", lift: "Leg Press" })).toEqual({ view: "progress" });
    expect(tabOf({ view: "progress", lift: "Leg Press" })).toBe("progress");
  });

  it("puts My gym under Train, as deep as the plan editor and deeper than Settings, which opens it too", () => {
    expect(routeOf("#gym")).toEqual({ view: "gym" });
    expect(hashOf({ view: "gym" })).toBe("#gym");
    expect(depthOf({ view: "gym" })).toBe(3);
    expect(parentOf({ view: "gym" })).toEqual({ view: "train" });
    expect(tabOf({ view: "gym" })).toBe("train");
  });

  it("puts the workout and its summary over Train, with no tab bar, and Settings over Home", () => {
    expect(routeOf("#workout")).toEqual({ view: "workout" });
    expect(routeOf("#workout/done")).toEqual({ view: "workout", done: true });
    expect(hashOf({ view: "workout", done: true })).toBe("#workout/done");
    expect(sameRoute({ view: "workout" }, { view: "workout", done: true })).toBe(false);
    expect(depthOf({ view: "workout" })).toBe(2);
    expect(parentOf({ view: "workout" })).toEqual({ view: "train" });
    expect(isPushed({ view: "workout" })).toBe(true);
    expect(isPushed({ view: "settings" })).toBe(true);
    // Deeper than the tabs it opens from (Health's Edit, the avatar on Home), so Back returns there.
    expect(depthOf({ view: "settings" })).toBeGreaterThan(depthOf({ view: "health" }));
    expect(depthOf({ view: "plan" })).toBeGreaterThan(depthOf({ view: "settings" }));
    expect(isPushed({ view: "train" })).toBe(false);
    expect(parentOf({ view: "settings" })).toEqual({ view: "home" });
    expect(routeOf("#train")).toEqual({ view: "train" });
  });

  it("tells a lift's route apart from plain Progress and from another lift", () => {
    const a = { view: "progress" as const, lift: "Leg Press" }, b = { view: "progress" as const, lift: "Bench Press" };
    expect(sameRoute(a, { ...a })).toBe(true);
    expect(sameRoute(a, b)).toBe(false);
    expect(sameRoute(a, { view: "progress" })).toBe(false);
  });
});

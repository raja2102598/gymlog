import { describe, expect, it, vi } from "vitest";
import { handleBack, onBack } from "@/lib/back";
import { directionOf, moveScreens } from "@/lib/pageTransition";
import { depthOf, hashOf, isPushed, parentOf, routeOf, sameRoute, tabOf } from "@/lib/route";

// Getting around: each screen's address and place (lib/route.ts), the phone's Back (lib/back.ts), and the move from one
// screen to the next (lib/pageTransition.ts).

describe("routing", () => {
  it("reads and writes Home's address, a metric's, and the old #dashboard's", () => {
    expect(routeOf("")).toEqual({ view: "home" });
    expect(hashOf({ view: "home" })).toBe("");
    expect(routeOf("#health/sleep")).toEqual({ view: "health", metric: "sleep" });
    expect(hashOf({ view: "health", metric: "sleep" })).toBe("#health/sleep");
    expect(routeOf("#health/nonsense")).toEqual({ view: "home" }); // not a real metric: falls back to Home
    expect(routeOf("#dashboard")).toEqual({ view: "progress" }); // Progress's old name
  });

  it("puts a metric's page under Health and the plan editor under Train, deeper than Settings over Home", () => {
    expect([depthOf({ view: "home" }), depthOf({ view: "settings" }), depthOf({ view: "health", metric: "water" }), depthOf({ view: "plan" })]).toEqual([0, 2, 2, 3]);
    expect(parentOf({ view: "health", metric: "water" })).toEqual({ view: "health" });
    expect([tabOf({ view: "plan" }), parentOf({ view: "plan" })]).toEqual(["train", { view: "train" }]);
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

const doc = (dialog: { close: () => void } | null) => ({ querySelector: () => dialog }) as unknown as Pick<Document, "querySelector">;

describe("the phone's Back", () => {
  it("closes an open dialog (the exercise library) before anything else", () => {
    const dialog = { close: vi.fn() }, screen = vi.fn(() => true), atStart = vi.fn();
    const off = onBack(screen);
    handleBack(doc(dialog), atStart);
    expect(dialog.close).toHaveBeenCalled();
    expect(screen).not.toHaveBeenCalled();
    expect(atStart).not.toHaveBeenCalled();
    off();
  });

  it("then asks the screens, newest first, stopping at the first that closes something", () => {
    const order: string[] = [];
    const offA = onBack(() => (order.push("page"), true));
    const offB = onBack(() => (order.push("menu"), false));
    const atStart = vi.fn();
    handleBack(doc(null), atStart);
    expect(order).toEqual(["menu", "page"]);
    expect(atStart).not.toHaveBeenCalled();
    offA();
    offB();
  });

  it("with nothing to close or leave, puts the app in the background", () => {
    const off = onBack(() => false), atStart = vi.fn();
    handleBack(doc(null), atStart);
    expect(atStart).toHaveBeenCalledTimes(1);
    off();
  });
});

describe("moving between screens", () => {
  it("goes forward into a page, back out of one, and across the tabs, Home among them", () => {
    expect(directionOf({ view: "home" }, { view: "settings" })).toBe("forward");
    expect(directionOf({ view: "train" }, { view: "workout" })).toBe("forward");
    expect(directionOf({ view: "progress" }, { view: "progress", lift: "Leg Press" })).toBe("forward");
    expect(directionOf({ view: "health", metric: "sleep" }, { view: "health" })).toBe("back");
    expect(directionOf({ view: "workout" }, { view: "progress", lift: "Leg Press" })).toBe("forward");
    expect(directionOf({ view: "home" }, { view: "health" })).toBe("across");
    expect(directionOf({ view: "train" }, { view: "home" })).toBe("across");
    expect(directionOf({ view: "train" }, { view: "progress" })).toBe("across");
  });

  it("runs the change in a view transition with its direction on <html>, or straight away without one", async () => {
    let done = () => {};
    const finished = new Promise<void>((r) => (done = r));
    const dataset: Record<string, string> = {};
    const doc = { documentElement: { dataset }, startViewTransition: vi.fn((cb: () => void) => (cb(), { finished })) } as unknown as Document;
    const update = vi.fn();
    moveScreens("forward", update, doc);
    expect(update).toHaveBeenCalledTimes(1);
    expect(dataset.nav).toBe("forward");
    done();
    await finished;
    await Promise.resolve();
    expect(dataset.nav).toBeUndefined();
    // No direction (a change from the plan picker, say): no transition.
    moveScreens(null, update, doc);
    expect(update).toHaveBeenCalledTimes(2);
    expect(doc.startViewTransition).toHaveBeenCalledTimes(1);
    // A browser without view transitions: straight away.
    moveScreens("back", update, { documentElement: { dataset: {} } } as unknown as Document);
    expect(update).toHaveBeenCalledTimes(3);
  });
});

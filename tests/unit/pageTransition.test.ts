import { describe, expect, it, vi } from "vitest";
import { directionOf, moveScreens } from "@/lib/pageTransition";

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

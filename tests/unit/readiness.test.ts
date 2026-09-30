import { describe, expect, it } from "vitest";
import { readiness, readinessLine, RHR_DAYS, RHR_OVER, RHR_READINGS, SHORT_NIGHT } from "@/lib/readiness";
import { addDays } from "@/lib/dates";
import type { HealthDay } from "@/lib/types";
import { atWednesdayNoon, day, storeWith, WED } from "./helpers";

// The readiness note on Home's workout card (lib/readiness.ts): today's signals (last night's sleep, resting heart rate
// against its usual, the knee before the session), each alone and together, at their edges, and with nothing to go
// on; and its line, before and after Hold today. What Hold today does to the day's suggestions is in
// progression.test.ts, with the knee's hold.
atWednesdayNoon();

/** A store on WED with these Health Connect days, and today's knee score before the session. */
const on = (health: Record<string, HealthDay>, kneeBefore?: number) => {
  const s = storeWith(kneeBefore != null ? { [WED]: day({ kneeBefore }) } : {});
  s.health = health;
  return s;
};
/** Resting heart rate `bpm` on each of the `n` days before WED: two weeks, unless said. */
const usual = (bpm: number, n = 14): Record<string, HealthDay> => Object.fromEntries(Array.from({ length: n }, (_, i) => [addDays(WED, -1 - i), { restingHr: bpm }]));

describe("today's signals", () => {
  it("a short night alone: under 6 h, not 6 h itself", () => {
    expect(SHORT_NIGHT).toBe(360);
    expect(readiness(on({ [WED]: { sleepMin: 310 } }), WED)).toEqual({ sleepMin: 310 });
    expect(readiness(on({ [WED]: { sleepMin: 359 } }), WED)).toEqual({ sleepMin: 359 });
    expect(readiness(on({ [WED]: { sleepMin: 360 } }), WED)).toBeNull();
    expect(readiness(on({ [WED]: { sleepMin: 480 } }), WED)).toBeNull();
    // Last night is the sleep that ended today: yesterday's short night doesn't count today.
    expect(readiness(on({ [addDays(WED, -1)]: { sleepMin: 300 } }), WED)).toBeNull();
  });

  it("resting heart rate alone: 7 bpm or more over its average of the two weeks before", () => {
    expect(RHR_OVER).toBe(7);
    expect(readiness(on({ ...usual(58), [WED]: { restingHr: 66 } }), WED)).toEqual({ rhr: { bpm: 66, over: 8 } });
    expect(readiness(on({ ...usual(58), [WED]: { restingHr: 65 } }), WED)).toEqual({ rhr: { bpm: 65, over: 7 } });
    expect(readiness(on({ ...usual(58), [WED]: { restingHr: 64 } }), WED)).toBeNull();
    // The average, not the last reading: a week at 56 and a week at 60 is 58.
    const mixed = { ...usual(56), ...usual(60, 7), [WED]: { restingHr: 65 } };
    expect(readiness(on(mixed), WED)).toEqual({ rhr: { bpm: 65, over: 7 } });
    // Over two weeks only: the day before them doesn't count.
    expect(RHR_DAYS).toBe(14);
    expect(readiness(on({ ...usual(58), [addDays(WED, -15)]: { restingHr: 40 }, [WED]: { restingHr: 64 } }), WED)).toBeNull();
  });

  it("resting heart rate needs a week of readings to know what's usual, and one today", () => {
    expect(RHR_READINGS).toBe(7);
    expect(readiness(on({ ...usual(58, 7), [WED]: { restingHr: 66 } }), WED)).toEqual({ rhr: { bpm: 66, over: 8 } });
    expect(readiness(on({ ...usual(58, 6), [WED]: { restingHr: 66 } }), WED)).toBeNull();
    expect(readiness(on({ ...usual(58), [WED]: { sleepMin: 420 } }), WED)).toBeNull();
  });

  it("the knee alone: over the plan's limit, the score that holds knee lifts, and not at it", () => {
    const s = on({}, 6);
    expect(s.plan.kneeLimit).toBe(5);
    expect(readiness(s, WED)).toEqual({ knee: 6 });
    expect(readiness(on({}, 5), WED)).toBeNull();
    const t = on({}, 5);
    t.plan.kneeLimit = 4;
    expect(readiness(t, WED)).toEqual({ knee: 5 });
  });

  it("several together, each named", () => {
    const r = readiness(on({ ...usual(58), [WED]: { sleepMin: 310, restingHr: 67 } }, 7), WED);
    expect(r).toEqual({ sleepMin: 310, rhr: { bpm: 67, over: 9 }, knee: 7 });
    expect(readinessLine(r, false)).toBe("Slept 5 h 10 min, resting heart rate 9 bpm above usual and knee 7/10. Keep today’s weights where they were last time.");
    expect(readinessLine(readiness(on({ [WED]: { sleepMin: 310 } }, 6), WED), false)).toBe("Slept 5 h 10 min and knee 6/10. Keep today’s weights where they were last time.");
  });

  it("nothing with nothing to go on: no Health Connect data and no knee score, as on the website before the app syncs", () => {
    expect(readiness(on({}), WED)).toBeNull();
    expect(readiness(on({ [WED]: { steps: 4000 } }), WED)).toBeNull();
    expect(readiness(on({ [WED]: { sleepMin: 0, restingHr: 0 } }), WED)).toBeNull();
  });
});

describe("the note's line", () => {
  it("names the reason and what to do, one line for each signal alone", () => {
    expect(readinessLine({ sleepMin: 310 }, false)).toBe("Slept 5 h 10 min. Keep today’s weights where they were last time.");
    expect(readinessLine({ rhr: { bpm: 66, over: 8 } }, false)).toBe("Resting heart rate 8 bpm above usual. Keep today’s weights where they were last time.");
    expect(readinessLine({ knee: 6 }, false)).toBe("Knee 6/10. Keep today’s weights where they were last time.");
  });

  it("says the day holds once it does, with or without a reason left", () => {
    expect(readinessLine({ sleepMin: 310 }, true)).toBe("Slept 5 h 10 min. Today’s weights stay where they were last time.");
    expect(readinessLine(null, true)).toBe("Today’s weights stay where they were last time.");
  });
});

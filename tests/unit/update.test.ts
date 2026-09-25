import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  availableMessage,
  CHECK_INTERVAL_MS,
  dismissedUpdateCode,
  downloadingMessage,
  downloadPercent,
  formatMB,
  lastCheckedAt,
  NOTHING_PUBLISHED,
  setDismissedUpdateCode,
  setLastCheckedAt,
  shouldCheckNow,
  shouldShowUpdateNotice,
  updateFinding,
} from "@/lib/update";

describe("shouldCheckNow", () => {
  it("is false before 12 hours have passed", () => {
    expect(shouldCheckNow(1000, 1000)).toBe(false);
    expect(shouldCheckNow(1000, 1000 + CHECK_INTERVAL_MS - 1)).toBe(false);
  });
  it("is true once 12 hours have passed, and past it", () => {
    expect(shouldCheckNow(1000, 1000 + CHECK_INTERVAL_MS)).toBe(true);
    expect(shouldCheckNow(1000, 1000 + CHECK_INTERVAL_MS * 3)).toBe(true);
  });
  it("is true straight away when it's never checked (0), any time after the epoch's first 12 hours", () => {
    expect(shouldCheckNow(0, Date.now())).toBe(true);
  });
});

describe("formatMB", () => {
  it("shows one decimal place", () => {
    expect(formatMB(18.7 * 1024 * 1024)).toBe("18.7 MB");
    expect(formatMB(5 * 1024 * 1024)).toBe("5.0 MB");
  });
  it("rounds to the nearest tenth", () => {
    expect(formatMB(1024 * 1024 + 512 * 1024)).toBe("1.5 MB");
  });
});

describe("availableMessage", () => {
  it("names the version and its size", () => {
    expect(availableMessage("1.0.46", 18.7 * 1024 * 1024)).toBe("Version 1.0.46 is available (18.7 MB).");
  });
});

describe("updateFinding", () => {
  const latest = { code: 70, name: "1.0.70", commit: "b6c171f", size: 6 * 1024 * 1024, sha256: "e465a7" };
  it("offers a newer build", () => {
    expect(updateFinding({ enabled: true, available: true, latest })).toEqual({ kind: "available", latest });
  });
  it("is up to date when the published build isn't newer", () => {
    expect(updateFinding({ enabled: true, available: false, latest })).toEqual({ kind: "upToDate" });
  });
  it("says nothing is published, rather than up to date, when there's no version.json to compare with", () => {
    // 1.0.70 went out as a draft: its version.json was a 404, and phones said they had the newest version.
    expect(updateFinding({ enabled: true, available: false })).toEqual({ kind: "nothingPublished" });
    expect(NOTHING_PUBLISHED).toBe("Couldn’t find a published build to update from. Try again in a few minutes.");
  });
  it("hides the controls in a build with no repo to check", () => {
    expect(updateFinding({ enabled: false, available: false })).toEqual({ kind: "hidden" });
  });
});

describe("downloadPercent", () => {
  it("is the share received, rounded", () => {
    expect(downloadPercent(45, 100)).toBe(45);
    expect(downloadPercent(1, 3)).toBe(33);
    expect(downloadPercent(100, 100)).toBe(100);
  });
  it("is 0 while the total isn't known, never a division by zero", () => {
    expect(downloadPercent(0, 0)).toBe(0);
    expect(downloadPercent(5, 0)).toBe(0);
  });
  it("never goes outside 0 to 100", () => {
    expect(downloadPercent(-5, 100)).toBe(0);
    expect(downloadPercent(150, 100)).toBe(100);
  });
});

describe("downloadingMessage", () => {
  it("reads as a percentage in progress", () => {
    expect(downloadingMessage(45, 100)).toBe("Downloading… 45%");
  });
});

describe("shouldShowUpdateNotice", () => {
  it("shows a build newer than the one dismissed", () => {
    expect(shouldShowUpdateNotice(46, 45)).toBe(true);
  });
  it("stays hidden once that build is the one dismissed, or an older one", () => {
    expect(shouldShowUpdateNotice(46, 46)).toBe(false);
    expect(shouldShowUpdateNotice(45, 46)).toBe(false);
  });
  it("stays hidden with nothing latest to show", () => {
    expect(shouldShowUpdateNotice(undefined, 0)).toBe(false);
  });
  it("shows the first build found when nothing's been dismissed yet", () => {
    expect(shouldShowUpdateNotice(1, 0)).toBe(true);
  });
});

function memoryStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
}

describe("remembered on this device", () => {
  beforeEach(() => vi.stubGlobal("localStorage", memoryStorage()));
  afterEach(() => vi.unstubAllGlobals());

  it("lastCheckedAt starts at 0 and keeps what's set", () => {
    expect(lastCheckedAt()).toBe(0);
    setLastCheckedAt(1758000000000);
    expect(lastCheckedAt()).toBe(1758000000000);
  });

  it("dismissedUpdateCode starts at 0 and keeps what's set", () => {
    expect(dismissedUpdateCode()).toBe(0);
    setDismissedUpdateCode(46);
    expect(dismissedUpdateCode()).toBe(46);
  });
});

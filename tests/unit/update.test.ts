import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Updating the Android app (lib/update.ts, native/update.ts, shell/useAndroidUpdate.ts): when it checks, what the
// notice says and when it shows, and Update (or Settings' Download and install) downloading the build and handing it
// to Android's installer.
vi.mock("@capacitor/core", async () => (await import("./nativeMocks")).capacitorCore);
vi.mock("@capacitor/app", async () => ({ App: (await import("./nativeMocks")).app }));

import { retryWith, updateSteps, type AndroidUpdate } from "@/components/shell/useAndroidUpdate";
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
import { downloadUnderway, downloadUpdate, followDownload, type DownloadProgress } from "@/native/update";
import { flush, memoryStorage } from "./helpers";
import { appUpdate } from "./nativeMocks";

beforeEach(() => vi.stubGlobal("localStorage", memoryStorage()));
afterEach(() => vi.unstubAllGlobals());

describe("checking for a new build", () => {
  it("checks once 12 hours have passed, and at once when it never has, remembering when on this phone", () => {
    expect(shouldCheckNow(1000, 1000)).toBe(false);
    expect(shouldCheckNow(1000, 1000 + CHECK_INTERVAL_MS - 1)).toBe(false);
    expect(shouldCheckNow(1000, 1000 + CHECK_INTERVAL_MS)).toBe(true);
    expect(shouldCheckNow(1000, 1000 + CHECK_INTERVAL_MS * 3)).toBe(true);
    expect(shouldCheckNow(0, Date.now())).toBe(true); // never checked
    expect(lastCheckedAt()).toBe(0);
    setLastCheckedAt(1758000000000);
    expect(lastCheckedAt()).toBe(1758000000000);
  });

  it("offers a newer build, is up to date otherwise, says when nothing's published, and hides in a build with no repo", () => {
    const latest = { code: 70, name: "1.0.70", commit: "b6c171f", size: 6 * 1024 * 1024, sha256: "e465a7" };
    expect(updateFinding({ enabled: true, available: true, latest })).toEqual({ kind: "available", latest });
    expect(updateFinding({ enabled: true, available: false, latest })).toEqual({ kind: "upToDate" });
    // 1.0.70 went out as a draft: its version.json was a 404, and phones said they had the newest version.
    expect(updateFinding({ enabled: true, available: false })).toEqual({ kind: "nothingPublished" });
    expect(NOTHING_PUBLISHED).toBe("Couldn’t find a published build to update from. Try again in a few minutes.");
    expect(updateFinding({ enabled: false, available: false })).toEqual({ kind: "hidden" });
  });
});

describe("the update notice", () => {
  it("names the version and its size, to a tenth of a MB", () => {
    expect(availableMessage("1.0.46", 18.7 * 1024 * 1024)).toBe("Version 1.0.46 is available (18.7 MB).");
    expect(formatMB(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(formatMB(1024 * 1024 + 512 * 1024)).toBe("1.5 MB");
  });

  it("shows a build newer than the one dismissed, remembered on this phone, and stays hidden for that one or older", () => {
    expect(dismissedUpdateCode()).toBe(0);
    expect(shouldShowUpdateNotice(1, dismissedUpdateCode())).toBe(true); // the first build found
    setDismissedUpdateCode(46);
    expect(dismissedUpdateCode()).toBe(46);
    expect([shouldShowUpdateNotice(47, 46), shouldShowUpdateNotice(46, 46), shouldShowUpdateNotice(45, 46)]).toEqual([true, false, false]);
    expect(shouldShowUpdateNotice(undefined, 0)).toBe(false); // nothing latest to show
  });
});

describe("how far a download has got", () => {
  it("is the share received, rounded, 0 while the total isn't known, and never outside 0 to 100", () => {
    expect([downloadPercent(45, 100), downloadPercent(1, 3), downloadPercent(100, 100)]).toEqual([45, 33, 100]);
    expect([downloadPercent(0, 0), downloadPercent(5, 0)]).toEqual([0, 0]);
    expect([downloadPercent(-5, 100), downloadPercent(150, 100)]).toEqual([0, 100]);
    expect(downloadingMessage(45, 100)).toBe("Downloading… 45%");
  });
});

const latest = { code: 82, name: "1.0.82", commit: "abc", size: 8_600_000, sha256: "f00" };

/** The steps against a fake native module; `states` records every state they set, as React would see it. */
function run(native: {
  download?: (onProgress: (p: { received: number; total: number }) => void) => Promise<void>;
  install?: () => Promise<{ started: true } | { needsPermission: true }>;
  /** A download someone else started, still going: followed rather than started again. */
  underway?: (onProgress: (p: { received: number; total: number }) => void) => Promise<void>;
}) {
  let state: AndroidUpdate = { kind: "available", latest };
  const states: AndroidUpdate[] = [];
  const set = (next: AndroidUpdate | ((cur: AndroidUpdate) => AndroidUpdate)) => {
    state = typeof next === "function" ? next(state) : next;
    states.push(state);
  };
  const m = {
    downloadUpdate: vi.fn(native.download ?? (async () => {})),
    downloadUnderway: vi.fn(() => !!native.underway),
    followDownload: vi.fn((onProgress: (p: { received: number; total: number }) => void) => (native.underway ? native.underway(onProgress) : null)),
    installUpdate: vi.fn(native.install ?? (async () => ({ started: true as const }))),
    openInstallSettings: vi.fn(async () => {}),
    onAppResume: vi.fn(() => () => {}),
  };
  return { steps: updateSteps(set, async () => m), states, m, now: () => state };
}

describe("the update notice's Update and Settings' Download and install", () => {
  it("download the build, say how far it's got, then hand it straight to Android's installer", async () => {
    const r = run({
      download: async (onProgress) => {
        onProgress({ received: 4_300_000, total: 8_600_000 });
      },
    });
    await r.steps.download(latest);
    expect(r.states.map((s) => s.kind)).toEqual(["downloading", "downloading", "readyToInstall"]);
    expect(r.states[1]).toMatchObject({ received: 4_300_000, total: 8_600_000 });
    expect(r.m.installUpdate).toHaveBeenCalledTimes(1);
  });

  it("ask for Android's one-time permission to install, when it isn't given yet", async () => {
    const r = run({ install: async () => ({ needsPermission: true }) });
    await r.steps.download(latest);
    expect(r.now()).toEqual({ kind: "needsPermission", latest });
  });

  it("say why a download failed, keeping the build so it can be tried again", async () => {
    const r = run({
      download: async () => {
        throw new Error("The download didn't match its checksum.");
      },
    });
    await r.steps.download(latest);
    expect(r.now()).toEqual({ kind: "error", message: "Couldn’t download the update: The download didn't match its checksum.", latest });
    expect(retryWith(r.now())).toBe("download");
    expect(r.m.installUpdate).not.toHaveBeenCalled();
  });

  it("follow a download already started elsewhere, without opening the installer a second time", async () => {
    const r = run({
      underway: async (onProgress) => {
        onProgress({ received: 8_600_000, total: 8_600_000 });
      },
    });
    await r.steps.download(latest);
    expect(r.m.downloadUpdate).not.toHaveBeenCalled();
    expect(r.m.installUpdate).not.toHaveBeenCalled();
    expect(r.now()).toEqual({ kind: "readyToInstall", latest });
  });

  it("open Android's installer once when two places ask at the same moment (both back from Android's settings)", async () => {
    let release: (r: { started: true }) => void = () => {};
    const r = run({ install: () => new Promise((resolve) => (release = resolve)) });
    const other = updateSteps(() => {}, async () => r.m);
    const both = Promise.all([r.steps.install(latest), other.install(latest)]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    release({ started: true });
    await both;
    expect(r.m.installUpdate).toHaveBeenCalledTimes(1);
    expect(r.now()).toEqual({ kind: "readyToInstall", latest });
  });

  it("say so when the installer can't start", async () => {
    const r = run({
      install: async () => {
        throw new Error("no installer");
      },
    });
    await r.steps.install(latest);
    expect(r.now()).toEqual({ kind: "error", message: "Couldn’t start the installer: no installer.", latest, step: "install" });
  });

  it("try the installer again after it failed, without downloading the build again", async () => {
    let fail = true;
    const r = run({
      install: async () => {
        if (fail) throw new Error("no installer");
        return { started: true };
      },
    });
    await r.steps.download(latest);
    expect(retryWith(r.now())).toBe("install");
    fail = false;
    await r.steps.install(latest);
    expect(r.m.downloadUpdate).toHaveBeenCalledTimes(1);
    expect(r.m.installUpdate).toHaveBeenCalledTimes(2);
    expect(r.now()).toEqual({ kind: "readyToInstall", latest });
  });
});

describe("downloading an update", () => {
  beforeEach(() => {
    appUpdate.download.mockClear();
  });

  it("joins a download that's under way instead of starting a second, with the progress for both", async () => {
    const a: DownloadProgress[] = [], b: DownloadProgress[] = [];
    const first = downloadUpdate((p) => a.push(p));
    await flush();
    appUpdate.progress({ received: 4, total: 10 });
    // Settings left and opened again: another "Download and install" joins the first, where it's got to.
    const second = downloadUpdate((p) => b.push(p));
    appUpdate.progress({ received: 10, total: 10 });
    appUpdate.finish();
    await Promise.all([first, second]);
    expect(appUpdate.download).toHaveBeenCalledTimes(1);
    expect(a).toEqual([{ received: 4, total: 10 }, { received: 10, total: 10 }]);
    expect(b).toEqual([{ received: 4, total: 10 }, { received: 10, total: 10 }]);
    expect(appUpdate.listeners.size).toBe(0);
  });

  it("lets Settings, opened again mid-download, follow it to the end, a failure included; then nothing's under way", async () => {
    expect(downloadUnderway()).toBe(false);
    expect(followDownload(() => {})).toBeNull();
    const first = downloadUpdate(() => {});
    await flush();
    appUpdate.progress({ received: 3, total: 10 });
    expect(downloadUnderway()).toBe(true);
    const seen: DownloadProgress[] = [];
    const following = followDownload((p) => seen.push(p));
    appUpdate.fail(new Error("The download didn’t match what was expected"));
    await expect(following).rejects.toThrow("didn’t match");
    await expect(first).rejects.toThrow("didn’t match");
    expect(seen).toEqual([{ received: 3, total: 10 }]);
    expect(downloadUnderway()).toBe(false);
    expect(followDownload(() => {})).toBeNull();
    // And the next "Download and install" starts afresh.
    const again = downloadUpdate(() => {});
    await flush();
    appUpdate.finish();
    await again;
    expect(appUpdate.download).toHaveBeenCalledTimes(2);
  });
});

import { describe, expect, it, vi } from "vitest";
import { updateSteps, type AndroidUpdate } from "@/components/shell/useAndroidUpdate";

const latest = { code: 82, name: "1.0.82", commit: "abc", size: 8_600_000, sha256: "f00" };

/** The steps against a fake native module; `states` records every state they set, as React would see it. */
function run(native: { download?: (onProgress: (p: { received: number; total: number }) => void) => Promise<void>; install?: () => Promise<{ started: true } | { needsPermission: true }> }) {
  let state: AndroidUpdate = { kind: "available", latest };
  const states: AndroidUpdate[] = [];
  const set = (next: AndroidUpdate | ((cur: AndroidUpdate) => AndroidUpdate)) => {
    state = typeof next === "function" ? next(state) : next;
    states.push(state);
  };
  const m = {
    downloadUpdate: vi.fn(native.download ?? (async () => {})),
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
    expect(r.m.installUpdate).not.toHaveBeenCalled();
  });

  it("say so when the installer can't start", async () => {
    const r = run({
      install: async () => {
        throw new Error("no installer");
      },
    });
    await r.steps.install(latest);
    expect(r.now()).toEqual({ kind: "error", message: "Couldn’t start the installer: no installer.", latest });
  });
});

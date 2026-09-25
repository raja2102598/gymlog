import { describe, expect, it, vi } from "vitest";
import { handleBack, onBack } from "@/lib/back";

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

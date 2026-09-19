import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { showToast, useToast } from "@/stores/toast";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  useToast.getState().dismiss();
  vi.useRealTimers();
});

describe("toast store", () => {
  it("shows one receipt and lets it go by itself", () => {
    showToast({ kind: "success", text: "Saved" });
    expect(useToast.getState().toast?.text).toBe("Saved");
    vi.advanceTimersByTime(4199);
    expect(useToast.getState().toast).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(useToast.getState().toast).toBeNull();
  });

  it("replaces the last receipt with the newest and restarts the clock, since the newest is the undoable one", () => {
    showToast({ kind: "success", text: "First" });
    const first = useToast.getState().toast!.id;
    vi.advanceTimersByTime(3000);
    showToast({ kind: "error", text: "Second", detail: "why" });
    const second = useToast.getState().toast!;
    expect(second.id).toBeGreaterThan(first);
    expect(second.kind).toBe("error");
    vi.advanceTimersByTime(3000);
    expect(useToast.getState().toast?.text).toBe("Second");
    vi.advanceTimersByTime(1200);
    expect(useToast.getState().toast).toBeNull();
  });

  it("dismisses on demand and does not come back when the old timer would have fired", () => {
    showToast({ kind: "info", text: "Queued" });
    useToast.getState().dismiss();
    expect(useToast.getState().toast).toBeNull();
    showToast({ kind: "success", text: "Later" });
    vi.advanceTimersByTime(4100);
    expect(useToast.getState().toast?.text).toBe("Later");
  });
});

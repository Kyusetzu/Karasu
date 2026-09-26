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

  it("keeps a toast with an action up long enough to reach the button", () => {
    showToast({ kind: "success", text: "Set to 8", action: { label: "Undo", run: () => {} } });
    vi.advanceTimersByTime(6999);
    expect(useToast.getState().toast).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(useToast.getState().toast).toBeNull();
  });

  it("stops the clock while paused and gives back what was left, with a floor", () => {
    showToast({ kind: "success", text: "Saved" });
    vi.advanceTimersByTime(4000);
    useToast.getState().pause();
    vi.advanceTimersByTime(60_000);
    expect(useToast.getState().toast?.text).toBe("Saved");
    useToast.getState().resume();
    vi.advanceTimersByTime(1499);
    expect(useToast.getState().toast).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(useToast.getState().toast).toBeNull();
  });

  it("resumes the time that was left when more than the floor remains, and ignores a stray resume", () => {
    showToast({ kind: "success", text: "Saved" });
    useToast.getState().resume();
    vi.advanceTimersByTime(1000);
    useToast.getState().pause();
    useToast.getState().pause();
    vi.advanceTimersByTime(10_000);
    useToast.getState().resume();
    vi.advanceTimersByTime(3199);
    expect(useToast.getState().toast).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(useToast.getState().toast).toBeNull();
  });
});

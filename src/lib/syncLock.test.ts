import { describe, expect, it, beforeEach, vi } from "vitest";
import { acquire, isSyncing, release, subscribe } from "@/lib/syncLock";

describe("syncLock", () => {
  beforeEach(() => release());

  it("starts free", () => {
    expect(isSyncing()).toBe(false);
  });

  it("grants the lock once and refuses the second taker", () => {
    expect(acquire()).toBe(true);
    expect(acquire()).toBe(false);
    expect(isSyncing()).toBe(true);
  });

  it("can be taken again after a release", () => {
    acquire();
    release();
    expect(isSyncing()).toBe(false);
    expect(acquire()).toBe(true);
  });

  it("releases idempotently, so an unbalanced finally cannot free a later sync", () => {
    acquire();
    release();
    release();
    expect(acquire()).toBe(true);
    expect(isSyncing()).toBe(true);
  });

  it("notifies subscribers on both edges and stops after unsubscribe", () => {
    const seen = vi.fn();
    const off = subscribe(seen);
    acquire();
    release();
    expect(seen).toHaveBeenCalledTimes(2);
    off();
    acquire();
    expect(seen).toHaveBeenCalledTimes(2);
  });

  it("does not notify when the state did not change", () => {
    const seen = vi.fn();
    const off = subscribe(seen);
    acquire();
    acquire();
    expect(seen).toHaveBeenCalledTimes(1);
    off();
  });
});

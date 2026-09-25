import { describe, expect, it, vi } from "vitest";
import { createBackStack, type HistoryLike } from "./backStack";

/** A browser-like history: `back()` moves the index, and the test delivers popstate by calling `stack.onPopState()`. */
function fakeHistory() {
  const entries: unknown[] = [null];
  let idx = 0;
  const h: HistoryLike = {
    pushState(data) {
      entries.splice(idx + 1);
      entries.push(data);
      idx++;
    },
    back() {
      if (idx > 0) idx--;
    },
    get state() {
      return entries[idx];
    },
  };
  return { h, entries, index: () => idx };
}

describe("createBackStack", () => {
  it("closes the overlay on a system back and consumes only our entry", () => {
    const { h, index } = fakeHistory();
    const stack = createBackStack(h);
    const close = vi.fn();
    stack.register(close);
    expect(index()).toBe(1);

    h.back(); // the user's gesture
    expect(stack.onPopState()).toBe("closed");
    expect(close).toHaveBeenCalledTimes(1);
    expect(index()).toBe(0);
  });

  it("nets zero history entries when closed by other means", () => {
    const { h, index } = fakeHistory();
    const stack = createBackStack(h);
    const close = vi.fn();
    const release = stack.register(close);

    release(); // Escape / backdrop / action
    expect(index()).toBe(0);
    expect(stack.onPopState()).toBe("swallowed");
    expect(close).not.toHaveBeenCalled();
  });

  it("the swallow is one-shot", () => {
    const { h } = fakeHistory();
    const stack = createBackStack(h);
    stack.register(vi.fn())();
    expect(stack.onPopState()).toBe("swallowed");
    expect(stack.onPopState()).toBe("passthrough");
  });

  it("stacked overlays close one per back press, topmost first", () => {
    const { h } = fakeHistory();
    const stack = createBackStack(h);
    const closeA = vi.fn();
    const closeB = vi.fn();
    stack.register(closeA);
    stack.register(closeB);

    h.back();
    expect(stack.onPopState()).toBe("closed");
    expect(closeB).toHaveBeenCalledTimes(1);
    expect(closeA).not.toHaveBeenCalled();

    h.back();
    expect(stack.onPopState()).toBe("closed");
    expect(closeA).toHaveBeenCalledTimes(1);
  });

  it("releasing after a back-close is a no-op", () => {
    const { h, index } = fakeHistory();
    const stack = createBackStack(h);
    const release = stack.register(vi.fn());
    h.back();
    stack.onPopState();
    release(); // effect cleanup after the close
    expect(index()).toBe(0);
  });

  it("a navigation that buried the entry leaves history alone on release", () => {
    const { h, index } = fakeHistory();
    const stack = createBackStack(h);
    const release = stack.register(vi.fn());
    h.pushState({ usr: null, key: "route" }, ""); // the router's own push
    release();
    // Popping here would eat the router's entry, so the ours stays buried.
    expect(index()).toBe(2);
    // The later back over the buried entry is nobody's close.
    h.back();
    expect(stack.onPopState()).toBe("passthrough");
  });

  it("a back with nothing registered passes through", () => {
    const { h } = fakeHistory();
    const stack = createBackStack(h);
    h.pushState({ usr: null, key: "route" }, "");
    h.back();
    expect(stack.onPopState()).toBe("passthrough");
  });

  it("a double back during an exit animation passes the second through", () => {
    const { h } = fakeHistory();
    const stack = createBackStack(h);
    stack.register(vi.fn());
    h.back();
    expect(stack.onPopState()).toBe("closed");
    h.back();
    expect(stack.onPopState()).toBe("passthrough");
  });

  /** A filter chosen in a panel is written after the panel's entry is gone, or the router overwrites its marker. */
  it("runs a settled callback only after the swallowed popstate of a close", () => {
    const { h, index } = fakeHistory();
    const stack = createBackStack(h);
    const release = stack.register(vi.fn());
    const write = vi.fn();
    release();
    stack.whenSettled(write);
    expect(write).not.toHaveBeenCalled();
    expect(index()).toBe(0);
    expect(stack.onPopState()).toBe("swallowed");
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("runs a settled callback at once when nothing is unwinding", () => {
    const { h } = fakeHistory();
    const stack = createBackStack(h);
    const write = vi.fn();
    stack.whenSettled(write);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("runs at once after a back-gesture close, whose entry the gesture already popped", () => {
    const { h } = fakeHistory();
    const stack = createBackStack(h);
    const release = stack.register(vi.fn());
    h.back();
    expect(stack.onPopState()).toBe("closed");
    release();
    const write = vi.fn();
    stack.whenSettled(write);
    expect(write).toHaveBeenCalledTimes(1);
  });

  /** Any open overlay's entry is the current one, so a write waits until the last of them has unwound. */
  it("waits while any overlay is still open", () => {
    const { h } = fakeHistory();
    const stack = createBackStack(h);
    const outer = stack.register(vi.fn());
    const inner = stack.register(vi.fn());
    inner();
    const write = vi.fn();
    stack.whenSettled(write);
    expect(stack.onPopState()).toBe("swallowed");
    expect(write).not.toHaveBeenCalled();
    outer();
    expect(write).not.toHaveBeenCalled();
    expect(stack.onPopState()).toBe("swallowed");
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("runs a waiting callback when the back gesture closes the last overlay", () => {
    const { h } = fakeHistory();
    const stack = createBackStack(h);
    stack.register(vi.fn());
    const write = vi.fn();
    stack.whenSettled(write);
    expect(write).not.toHaveBeenCalled();
    h.back();
    expect(stack.onPopState()).toBe("closed");
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("runs waiting callbacks in the order they were queued", () => {
    const { h } = fakeHistory();
    const stack = createBackStack(h);
    const release = stack.register(vi.fn());
    const order: number[] = [];
    stack.whenSettled(() => order.push(1));
    stack.whenSettled(() => order.push(2));
    release();
    stack.onPopState();
    expect(order).toEqual([1, 2]);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { act } from "react";
import { usePullToSync } from "./usePullToSync";
import { PULL_SLOP_PX } from "@/lib/pullToSync";

const hooks = vi.hoisted(() => ({ sync: vi.fn(), available: true }));

vi.mock("@/hooks/useManualSync", () => ({
  useManualSync: () => ({ sync: hooks.sync, syncing: false, available: hooks.available }),
}));

/** jsdom implements no `TouchEvent`, and the hook only ever reads `touches[0].clientY`, so this is the whole surface. */
function touch(type: string, y: number, count = 1): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "touches", {
    value: Array.from({ length: count }, () => ({ clientY: y })),
  });
  return event;
}

/** A scroller jsdom will agree is one: real layout never runs here, so both sizes are declared. */
function scroller(scrollTop: number): HTMLElement {
  const el = document.createElement("div");
  el.style.overflowY = "auto";
  Object.defineProperty(el, "scrollHeight", { value: 900, configurable: true });
  Object.defineProperty(el, "clientHeight", { value: 600, configurable: true });
  el.scrollTop = scrollTop;
  document.body.appendChild(el);
  return el;
}

function Probe() {
  const { state } = usePullToSync();
  return <output data-testid="phase">{state.phase}</output>;
}

const phase = () => screen.getByTestId("phase").textContent;

/** Far enough that the damping has certainly passed the trigger; the exact travel is the reducer test's business. */
const FAR = 600;

function drag(el: HTMLElement, to: number, count = 1): void {
  act(() => {
    el.dispatchEvent(touch("touchstart", 0, count));
  });
  act(() => {
    el.dispatchEvent(touch("touchmove", to, count));
  });
}

afterEach(() => {
  hooks.sync.mockClear();
  hooks.available = true;
  document.body.innerHTML = "";
});

describe("usePullToSync", () => {
  it("arms and syncs when the pull starts at the top", () => {
    render(<Probe />);
    const el = scroller(0);
    drag(el, FAR);
    expect(phase()).toBe("ready");
    act(() => {
      el.dispatchEvent(touch("touchend", FAR, 0));
    });
    expect(hooks.sync).toHaveBeenCalledTimes(1);
    expect(phase()).toBe("idle");
  });

  it("does nothing while the page is scrolled, the case a pull must never be mistaken for", () => {
    render(<Probe />);
    drag(scroller(240), FAR);
    expect(phase()).toBe("idle");
    expect(hooks.sync).not.toHaveBeenCalled();
  });

  it("does not sync when the pull stops short of the threshold", () => {
    render(<Probe />);
    const el = scroller(0);
    drag(el, PULL_SLOP_PX + 4);
    expect(phase()).toBe("pulling");
    act(() => {
      el.dispatchEvent(touch("touchend", PULL_SLOP_PX + 4, 0));
    });
    expect(hooks.sync).not.toHaveBeenCalled();
  });

  it("stands down while a dialog is up", () => {
    render(<Probe />);
    const overlay = document.createElement("div");
    overlay.setAttribute("data-overlay", "");
    document.body.appendChild(overlay);
    drag(scroller(0), FAR);
    expect(phase()).toBe("idle");
    expect(hooks.sync).not.toHaveBeenCalled();
  });

  it("registers nothing at all without an account to sync for", () => {
    hooks.available = false;
    render(<Probe />);
    const el = scroller(0);
    drag(el, FAR);
    act(() => {
      el.dispatchEvent(touch("touchend", FAR, 0));
    });
    expect(phase()).toBe("idle");
    expect(hooks.sync).not.toHaveBeenCalled();
  });

  it("gives the gesture up when a second finger lands", () => {
    render(<Probe />);
    const el = scroller(0);
    drag(el, FAR);
    expect(phase()).toBe("ready");
    act(() => {
      el.dispatchEvent(touch("touchmove", FAR, 2));
    });
    expect(phase()).toBe("idle");
  });
});

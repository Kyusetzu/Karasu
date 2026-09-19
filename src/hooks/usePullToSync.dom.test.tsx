import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { act } from "react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router";
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

/** A list screen with nothing in it: the container still scrolls by CSS, it just has nothing to scroll. */
function emptyScroller(): HTMLElement {
  const el = document.createElement("div");
  el.style.overflowY = "auto";
  Object.defineProperty(el, "scrollHeight", { value: 600, configurable: true });
  Object.defineProperty(el, "clientHeight", { value: 600, configurable: true });
  el.scrollTop = 0;
  document.body.appendChild(el);
  return el;
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
  const navigate = useNavigate();
  return (
    <>
      <output data-testid="phase">{state.phase}</output>
      <button type="button" onClick={() => navigate("/search")}>
        away
      </button>
    </>
  );
}

/** The hook reads the route, so every mount sits inside a router; the second route is where "navigate away" lands. */
function mount(): void {
  render(
    <MemoryRouter initialEntries={["/list"]}>
      <Routes>
        <Route path="*" element={<Probe />} />
      </Routes>
    </MemoryRouter>,
  );
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
    mount();
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
    mount();
    drag(scroller(240), FAR);
    expect(phase()).toBe("idle");
    expect(hooks.sync).not.toHaveBeenCalled();
  });

  it("does not sync when the pull stops short of the threshold", () => {
    mount();
    const el = scroller(0);
    drag(el, PULL_SLOP_PX + 4);
    expect(phase()).toBe("pulling");
    act(() => {
      el.dispatchEvent(touch("touchend", PULL_SLOP_PX + 4, 0));
    });
    expect(hooks.sync).not.toHaveBeenCalled();
  });

  it("stands down while a dialog is up", () => {
    mount();
    const overlay = document.createElement("div");
    overlay.setAttribute("data-overlay", "");
    document.body.appendChild(overlay);
    drag(scroller(0), FAR);
    expect(phase()).toBe("idle");
    expect(hooks.sync).not.toHaveBeenCalled();
  });

  it("registers nothing at all without an account to sync for", () => {
    hooks.available = false;
    mount();
    const el = scroller(0);
    drag(el, FAR);
    act(() => {
      el.dispatchEvent(touch("touchend", FAR, 0));
    });
    expect(phase()).toBe("idle");
    expect(hooks.sync).not.toHaveBeenCalled();
  });

  it("lets go of a pull when the screen under the finger navigates away", () => {
    mount();
    const el = scroller(0);
    drag(el, PULL_SLOP_PX + 4);
    expect(phase()).toBe("pulling");
    // The list unmounts with the route, and Chromium then delivers the touch's end to nothing the document can hear.
    act(() => {
      el.remove();
      screen.getByText("away").click();
    });
    expect(phase()).toBe("idle");
    expect(hooks.sync).not.toHaveBeenCalled();
  });

  it("gives the gesture up when a second finger lands", () => {
    mount();
    const el = scroller(0);
    drag(el, FAR);
    expect(phase()).toBe("ready");
    act(() => {
      el.dispatchEvent(touch("touchmove", FAR, 2));
    });
    expect(phase()).toBe("idle");
  });
});

/** An empty or short list is exactly where someone reaches for pull-to-sync, and it is the case with nothing to scroll. */
describe("usePullToSync on a list with nothing to scroll", () => {
  it("still syncs from a screen whose content does not overflow", () => {
    mount();
    const el = emptyScroller();
    drag(el, FAR);
    expect(phase()).toBe("ready");
    act(() => {
      el.dispatchEvent(touch("touchend", FAR, 0));
    });
    expect(hooks.sync).toHaveBeenCalledTimes(1);
  });
});

import { afterEach, describe, expect, it } from "vitest";
import { useRef, useState } from "react";
import { act, render, screen } from "@testing-library/react";
import { STATUS_ORDER, type MediaListStatus } from "@/api/types";
import { adjacentTab } from "@/lib/navSwipe";
import { useTabSwipe } from "./useTabSwipe";

/** The list's tab swipe on a bare surface: which way steps where, where it stops, and what it leaves alone. */

function Probe({ initial = "CURRENT", enabled = true }: { initial?: MediaListStatus; enabled?: boolean }) {
  const surface = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<MediaListStatus>(initial);
  useTabSwipe({
    surface,
    content,
    enabled,
    canStep: (step) => adjacentTab(STATUS_ORDER, tab, step) !== null,
    onStep: (step) => setTab((t) => adjacentTab(STATUS_ORDER, t, step) ?? t),
  });
  return (
    <div ref={surface} data-testid="surface">
      <output data-testid="tab">{tab}</output>
      <div data-testid="strip" style={{ overflowX: "auto" }}>
        <span data-testid="strip-tab">tab</span>
      </div>
      <div ref={content} data-testid="content">
        <div data-testid="row">row</div>
        <input data-testid="field" />
      </div>
    </div>
  );
}

/** jsdom has no `TouchEvent`; the hook reads `touches[0]`'s two coordinates and nothing else. */
function touch(type: string, x: number, y: number, count = 1): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "touches", {
    value: Array.from({ length: count }, () => ({ clientX: x, clientY: y })),
  });
  return event;
}

/** A drag from (x, y) by (dx, dy) in two moves, then a lift; the first move is small, as a real finger's is. */
function swipe(target: HTMLElement, dx: number, dy: number, x = 500, y = 300): Event {
  let lastMove!: Event;
  act(() => {
    target.dispatchEvent(touch("touchstart", x, y));
    target.dispatchEvent(touch("touchmove", x + dx / 5, y + dy / 5));
    lastMove = touch("touchmove", x + dx, y + dy);
    target.dispatchEvent(lastMove);
    target.dispatchEvent(touch("touchend", x + dx, y + dy, 0));
  });
  return lastMove;
}

const tab = () => screen.getByTestId("tab").textContent;

afterEach(() => {
  document.body.innerHTML = "";
});

describe("useTabSwipe", () => {
  it("steps to the next tab on a swipe to the left, and back on one to the right", () => {
    render(<Probe />);
    swipe(screen.getByTestId("row"), -160, 8);
    expect(tab()).toBe("REPEATING");
    swipe(screen.getByTestId("row"), 160, -8);
    expect(tab()).toBe("CURRENT");
  });

  /** The row has two ends: no swipe goes from Planning to Watching, or from Watching to Planning. */
  it("stops at both ends instead of looping", () => {
    const { unmount } = render(<Probe initial="PLANNING" />);
    swipe(screen.getByTestId("row"), -160, 0);
    expect(tab()).toBe("PLANNING");
    unmount();
    render(<Probe initial="CURRENT" />);
    swipe(screen.getByTestId("row"), 160, 0);
    expect(tab()).toBe("CURRENT");
  });

  it("claims a sideways drag from the page, so the list does not pan with it", () => {
    render(<Probe />);
    const move = swipe(screen.getByTestId("row"), -160, 4);
    expect(move.defaultPrevented).toBe(true);
  });

  it("leaves a vertical scroll alone and does not claim it", () => {
    render(<Probe />);
    const move = swipe(screen.getByTestId("row"), 30, 220);
    expect(tab()).toBe("CURRENT");
    expect(move.defaultPrevented).toBe(false);
  });

  it("ignores a short flick", () => {
    render(<Probe />);
    swipe(screen.getByTestId("row"), -40, 0);
    expect(tab()).toBe("CURRENT");
  });

  it("leaves the edge strips to the system back gesture", () => {
    render(<Probe />);
    swipe(screen.getByTestId("row"), 160, 0, 4);
    swipe(screen.getByTestId("row"), -160, 0, window.innerWidth - 4);
    expect(tab()).toBe("CURRENT");
  });

  it("stands down in a field, under an overlay, and while switched off", () => {
    const { unmount } = render(<Probe />);
    swipe(screen.getByTestId("field"), -160, 0);
    expect(tab()).toBe("CURRENT");
    const overlay = document.createElement("div");
    overlay.setAttribute("data-overlay", "");
    document.body.appendChild(overlay);
    swipe(screen.getByTestId("row"), -160, 0);
    expect(tab()).toBe("CURRENT");
    overlay.remove();
    unmount();
    render(<Probe enabled={false} />);
    swipe(screen.getByTestId("row"), -160, 0);
    expect(tab()).toBe("CURRENT");
  });

  /** The status strip scrolls sideways on a phone; a drag along it reads the rest of the row, not the next list. */
  it("leaves a sideways drag on a strip that overflows to the strip", () => {
    render(<Probe />);
    const strip = screen.getByTestId("strip");
    Object.defineProperty(strip, "scrollWidth", { value: 800 });
    Object.defineProperty(strip, "clientWidth", { value: 300 });
    const move = swipe(screen.getByTestId("strip-tab"), -160, 0);
    expect(tab()).toBe("CURRENT");
    expect(move.defaultPrevented).toBe(false);
  });

  it("swipes across a strip that fits, since there is nothing of it to scroll", () => {
    render(<Probe />);
    swipe(screen.getByTestId("strip-tab"), -160, 0);
    expect(tab()).toBe("REPEATING");
  });

  it("puts the list back where it was when the swipe falls short", () => {
    render(<Probe />);
    const content = screen.getByTestId("content");
    act(() => {
      const row = screen.getByTestId("row");
      row.dispatchEvent(touch("touchstart", 500, 300));
      row.dispatchEvent(touch("touchmove", 470, 300));
    });
    expect(content.style.transform).toMatch(/translateX\(-/);
    act(() => void screen.getByTestId("row").dispatchEvent(touch("touchend", 470, 300, 0)));
    expect(content.style.transform).toBe("");
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import BottomBar from "./BottomBar";
import { renderWithProviders, signIn, signOut } from "@/test/render";
import { SWIPE_MIN_PX } from "@/lib/navSwipe";

const opened = vi.fn();

function mount() {
  signIn();
  window.addEventListener("open-command-palette", opened);
  return renderWithProviders(<BottomBar />);
}

/** A flick on the bar, as a pointer reports it: up is a negative delta. */
function flick(el: HTMLElement, dy: number, dx = 0): void {
  fireEvent.pointerDown(el, { pointerType: "touch", clientX: 100, clientY: 400 });
  fireEvent.pointerUp(el, { pointerType: "touch", clientX: 100 + dx, clientY: 400 + dy });
}

const bar = () => screen.getByRole("navigation", { name: "nav.primary" });

afterEach(() => {
  window.removeEventListener("open-command-palette", opened);
  opened.mockClear();
  signOut();
});

describe("BottomBar swipe", () => {
  it("opens the palette on an upward flick from the bar", () => {
    mount();
    flick(bar(), -(SWIPE_MIN_PX + 30));
    expect(opened).toHaveBeenCalledTimes(1);
  });

  it("leaves a tap on a slot alone", () => {
    mount();
    flick(bar(), -2);
    expect(opened).not.toHaveBeenCalled();
  });

  it("leaves a downward drag alone, which is pull-to-sync's gesture", () => {
    mount();
    flick(bar(), SWIPE_MIN_PX + 30);
    expect(opened).not.toHaveBeenCalled();
  });

  it("ignores a mouse, which has Ctrl+K and the context menu", () => {
    mount();
    const el = bar();
    fireEvent.pointerDown(el, { pointerType: "mouse", clientX: 100, clientY: 400 });
    fireEvent.pointerUp(el, { pointerType: "mouse", clientX: 100, clientY: 300 });
    expect(opened).not.toHaveBeenCalled();
  });

  it("stands down while another overlay owns the screen", () => {
    mount();
    const overlay = document.createElement("div");
    overlay.setAttribute("data-overlay", "");
    document.body.appendChild(overlay);
    flick(bar(), -(SWIPE_MIN_PX + 30));
    overlay.remove();
    expect(opened).not.toHaveBeenCalled();
  });

  it("swallows the tap the flick ends on, so the slot under the finger does not navigate", () => {
    mount();
    const el = bar();
    const tapped = vi.fn();
    el.addEventListener("click", tapped);
    flick(el, -(SWIPE_MIN_PX + 30));
    fireEvent.click(el);
    expect(tapped).not.toHaveBeenCalled();
  });

  /** A gesture must never be the only way to an action, so the sheet keeps a plain row for it. */
  it("also reaches the palette from the More sheet", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: /nav\.more/ }));
    fireEvent.click(screen.getByRole("button", { name: "ctx.palette" }));
    expect(opened).toHaveBeenCalledTimes(1);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { fireEvent, screen } from "@testing-library/react";
import ActionHost from "./ActionHost";
import PullToSync from "./PullToSync";
import { renderWithProviders, signIn, signOut } from "@/test/render";

/** The two touch gestures share a screen: a press must not sync, and a pull must not open a menu. */

const hooks = vi.hoisted(() => ({ sync: vi.fn() }));
vi.mock("@/hooks/useManualSync", () => ({
  useManualSync: () => ({ sync: hooks.sync, syncing: false, available: true }),
}));

/** jsdom implements no `TouchEvent`; the pull hook only ever reads `touches[0].clientY`. */
function touch(type: string, y: number, count = 1): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "touches", {
    value: Array.from({ length: count }, () => ({ clientY: y })),
  });
  return event;
}

/** A scroller holding a card, which is what both gestures actually land on. */
function screenWithCard(scrollTop: number): { scroller: HTMLElement; card: HTMLElement } {
  const scroller = document.createElement("div");
  scroller.style.overflowY = "auto";
  Object.defineProperty(scroller, "scrollHeight", { value: 900, configurable: true });
  Object.defineProperty(scroller, "clientHeight", { value: 600, configurable: true });
  scroller.scrollTop = scrollTop;
  const card = document.createElement("div");
  card.dataset.mediaId = "1";
  card.dataset.mediaType = "ANIME";
  card.dataset.mediaTitle = "Cowboy Bebop";
  scroller.appendChild(card);
  document.body.appendChild(scroller);
  return { scroller, card };
}

function mount() {
  signIn();
  renderWithProviders(
    <>
      <PullToSync />
      <ActionHost />
    </>,
  );
}

const menu = () => screen.queryByRole("dialog");

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
  hooks.sync.mockClear();
  signOut();
  document.body.innerHTML = "";
});

describe("the touch gestures together", () => {
  it("opens the sheet on a still press and syncs nothing", () => {
    mount();
    const { card } = screenWithCard(0);
    card.dispatchEvent(touch("touchstart", 100));
    fireEvent.pointerDown(card, { pointerType: "touch", isPrimary: true, clientX: 10, clientY: 100 });
    act(() => void vi.advanceTimersByTime(600));
    card.dispatchEvent(touch("touchend", 100, 0));

    expect(menu()).not.toBeNull();
    expect(hooks.sync).not.toHaveBeenCalled();
  });

  it("syncs on a pull from the top and opens no sheet", () => {
    mount();
    const { card } = screenWithCard(0);
    card.dispatchEvent(touch("touchstart", 100));
    fireEvent.pointerDown(card, { pointerType: "touch", isPrimary: true, clientX: 10, clientY: 100 });
    // The same movement that arms the pull is what takes the press away, well before it could fire.
    card.dispatchEvent(touch("touchmove", 700));
    fireEvent.pointerMove(window, { clientX: 10, clientY: 700 });
    act(() => void vi.advanceTimersByTime(600));
    card.dispatchEvent(touch("touchend", 700, 0));

    expect(hooks.sync).toHaveBeenCalledTimes(1);
    expect(menu()).toBeNull();
  });

  it("does neither when the press is held on a scrolled screen", () => {
    mount();
    const { card } = screenWithCard(300);
    card.dispatchEvent(touch("touchstart", 100));
    card.dispatchEvent(touch("touchmove", 700));
    card.dispatchEvent(touch("touchend", 700, 0));

    expect(hooks.sync).not.toHaveBeenCalled();
    expect(menu()).toBeNull();
  });
});

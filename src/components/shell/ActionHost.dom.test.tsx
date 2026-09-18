import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { fireEvent, screen } from "@testing-library/react";
import ActionHost from "./ActionHost";
import { renderWithProviders, signIn, signOut } from "@/test/render";
import type { ListResult, MediaListEntry } from "@/api/types";

const saveListEntry = vi.hoisted(() => vi.fn(() => Promise.resolve({ queued: false })));
vi.mock("@/api/anilist", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/anilist")>()),
  saveListEntry,
  isTauri: true,
}));

const ENTRY: MediaListEntry = {
  id: 55,
  mediaId: 1,
  status: "CURRENT",
  score: 8,
  progress: 3,
  progressVolumes: 0,
  repeat: 0,
  notes: null,
  updatedAt: 0,
  private: false,
  hiddenFromStatusLists: false,
  customLists: {},
  advancedScores: {},
  startedAt: null,
  completedAt: null,
  media: {
    id: 1,
    title: { romaji: "Cowboy Bebop", english: null, native: null },
    coverImage: { large: null },
    episodes: 26,
    format: "TV",
    status: "FINISHED",
    season: null,
    seasonYear: null,
    averageScore: null,
    genres: [],
    synonyms: [],
    nextAiringEpisode: null,
  },
};

const LIST: ListResult = {
  lists: [{ name: "Watching", status: "CURRENT", isCustomList: false, entries: [ENTRY] }],
  fromCache: false,
  pending: 0,
  fetchedAt: 0,
};

/** A card as the three emitters render it: an id, a type, and a title, and nothing about the entry's state. */
function card(): HTMLElement {
  const el = document.createElement("div");
  el.dataset.mediaId = "1";
  el.dataset.mediaType = "ANIME";
  el.dataset.mediaTitle = "Cowboy Bebop";
  document.body.appendChild(el);
  return el;
}

function press(el: HTMLElement, over: Partial<PointerEventInit> = {}): void {
  fireEvent.pointerDown(el, { pointerType: "touch", isPrimary: true, clientX: 10, clientY: 10, ...over });
}

function mount() {
  const viewer = signIn();
  const { queryClient } = renderWithProviders(<ActionHost />);
  // The test client collects on sight, and nothing observes a seeded list; advancing the hold would sweep it away.
  queryClient.setQueryDefaults(["mediaList"], { gcTime: Infinity });
  queryClient.setQueryData(["mediaList", "ANIME", viewer.id], LIST);
  return queryClient;
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
  saveListEntry.mockClear();
  signOut();
  document.body.innerHTML = "";
});

const hold = () => act(() => void vi.advanceTimersByTime(600));

describe("ActionHost long press", () => {
  it("opens the sheet for the pressed card after the hold", () => {
    mount();
    const el = card();
    press(el);
    expect(screen.queryByRole("dialog")).toBeNull();
    hold();
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText("Cowboy Bebop")).toBeTruthy();
  });

  it("offers the writes a cached entry makes possible", () => {
    mount();
    press(card());
    hold();
    expect(screen.getByRole("button", { name: "common.plusOne" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "actions.changeStatus" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "actions.remove" })).toBeTruthy();
  });

  it("writes the increment the entry's own progress implies", async () => {
    mount();
    press(card());
    hold();
    // Back to real time before the click: the optimistic patch awaits a cancellation the fake clock never delivers.
    vi.useRealTimers();
    fireEvent.pointerUp(window);
    fireEvent.click(screen.getByRole("button", { name: "common.plusOne" }));
    await vi.waitFor(() =>
      expect(saveListEntry).toHaveBeenCalledWith(
        expect.objectContaining({ mediaId: 1, progress: 4 }),
      ),
    );
  });

  it("is a scroll, not a press, once the finger moves past the slop", () => {
    mount();
    const el = card();
    press(el);
    fireEvent.pointerMove(window, { clientX: 10, clientY: 60 });
    hold();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("is a tap, not a press, when the finger lifts first", () => {
    mount();
    const el = card();
    press(el);
    fireEvent.pointerUp(window);
    hold();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("leaves a mouse alone, so the right-click menu keeps its own path", () => {
    mount();
    press(card(), { pointerType: "mouse" });
    hold();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("never fires over a control that owns its own press", () => {
    mount();
    const el = card();
    const button = document.createElement("button");
    el.appendChild(button);
    press(button);
    hold();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("stands down while another overlay is up", () => {
    mount();
    const overlay = document.createElement("div");
    overlay.setAttribute("data-overlay", "");
    document.body.appendChild(overlay);
    press(card());
    hold();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("swallows the tap that ends the press, or the card would open behind the sheet", () => {
    mount();
    const el = card();
    const onClick = vi.fn();
    el.addEventListener("click", onClick);
    press(el);
    hold();
    fireEvent.pointerUp(window);
    fireEvent.click(el);
    expect(onClick).not.toHaveBeenCalled();
  });

  /** The swallow is one tap and never reaches inside the sheet, or the first row tapped would do nothing. */
  it("lets the first row tapped after the press through", () => {
    const onRun = vi.fn();
    mount();
    const el = card();
    press(el);
    hold();
    fireEvent.pointerUp(window);
    const row = screen.getByRole("button", { name: "ctx.open" });
    row.addEventListener("click", onRun);
    fireEvent.click(row);
    expect(onRun).toHaveBeenCalled();
  });

  it("swallows the native menu Chromium raises on the same gesture", () => {
    mount();
    const el = card();
    const onContext = vi.fn();
    window.addEventListener("contextmenu", onContext);
    press(el);
    hold();
    fireEvent.contextMenu(el);
    window.removeEventListener("contextmenu", onContext);
    expect(onContext).not.toHaveBeenCalled();
  });
});

describe("ActionHost right click", () => {
  const right = (el: HTMLElement) => fireEvent.contextMenu(el, { clientX: 40, clientY: 40 });

  it("opens the menu on the card that was clicked", () => {
    mount();
    right(card());
    expect(screen.getByRole("menu", { name: "ctx.menuLabel" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "common.plusOne" })).toBeTruthy();
  });

  /** The one thing a rewrite here can quietly break: an editable field must keep the browser's own menu. */
  it("leaves the native menu to editable content", () => {
    mount();
    const field = document.createElement("textarea");
    document.body.appendChild(field);
    right(field);
    expect(screen.queryByRole("menu", { name: "ctx.menuLabel" })).toBeNull();
  });

  it("offers the app chrome on the background, where there is no card", () => {
    mount();
    const empty = document.createElement("div");
    document.body.appendChild(empty);
    right(empty);
    expect(screen.getByRole("menuitem", { name: "ctx.back" })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "common.plusOne" })).toBeNull();
  });

  it("does not fire straight after a touch, where the press already answered", () => {
    mount();
    const el = card();
    press(el);
    right(el);
    expect(screen.queryByRole("menu", { name: "ctx.menuLabel" })).toBeNull();
  });
});

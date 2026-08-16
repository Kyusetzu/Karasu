import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import type { SyncStatus } from "@/api/types";
import { renderWithProviders, signIn, signOut } from "@/test/render";

/**
 * The component is a shell around one command, so the command is the seam.
 * `isTauri` is false under jsdom, and the hook gates on it — mocking the module
 * is what lets the panel be rendered at all.
 */
const status = vi.fn<() => Promise<SyncStatus>>();

vi.mock("@/api/anilist", async (orig) => ({
  ...(await orig<typeof import("@/api/anilist")>()),
  isTauri: true,
  syncStatus: () => status(),
  flushQueue: () => Promise.resolve(0),
}));

import SyncPanel from "./SyncPanel";

const IDLE: SyncStatus = {
  connected: true,
  draining: false,
  queued: [],
  recent: [],
  rate: {
    remaining: 24,
    limit: 30,
    observedAgoMs: 900,
    throttledForMs: null,
    throttleKind: null,
  },
};

const panel = () => (
  <SyncPanel label="Show sync details">
    <span>1 change queued</span>
  </SyncPanel>
);

beforeEach(() => {
  signIn();
  status.mockReset();
  status.mockResolvedValue(IDLE);
});

afterEach(signOut);

describe("SyncPanel", () => {
  it("costs nothing until it is opened", async () => {
    renderWithProviders(panel());
    // The command is cheap, but it is still a round-trip per tick and there is
    // nothing to look at while the panel is shut.
    await waitFor(() => expect(screen.getByRole("button")).toBeTruthy());
    expect(status).not.toHaveBeenCalled();
  });

  it("opens on the trigger and reads the status", async () => {
    renderWithProviders(panel());
    fireEvent.click(screen.getByRole("button", { name: "Show sync details" }));
    await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy());
    expect(status).toHaveBeenCalled();
  });

  /**
   * The overlay contract: screen-level key handlers stand down while this is up,
   * and they must keep standing down through the exit animation — otherwise the
   * last frame of the panel is a frame where `j` moves a list behind it.
   */
  it("marks itself as an overlay and keeps doing so while it leaves", async () => {
    renderWithProviders(panel());
    fireEvent.click(screen.getByRole("button", { name: "Show sync details" }));
    await waitFor(() => expect(document.querySelector("[data-overlay]")).toBeTruthy());

    fireEvent.keyDown(window, { key: "Escape" });
    // Still mounted, still marked — `usePresence` holds the node for the exit.
    expect(document.querySelector("[data-overlay]")).toBeTruthy();
  });

  it("returns focus to the trigger when Escape closes it", async () => {
    renderWithProviders(panel());
    const trigger = screen.getByRole("button", { name: "Show sync details" });
    fireEvent.click(trigger);
    await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy());

    fireEvent.keyDown(window, { key: "Escape" });
    expect(document.activeElement).toBe(trigger);
  });

  /**
   * A status read that failed is a state to render. Falling through to the
   * empty one would say "nothing is waiting to be sent" about a queue nobody
   * could read — the most reassuring possible way to report a broken database.
   */
  it("renders a failed read rather than the empty state", async () => {
    status.mockRejectedValue(new Error("database is locked"));
    renderWithProviders(panel());
    fireEvent.click(screen.getByRole("button", { name: "Show sync details" }));
    await waitFor(() => expect(screen.getByText(/database is locked/)).toBeTruthy());
    expect(screen.queryByText("syncPanel.empty")).toBeNull();
  });

  /** The seed is 30, and rendering a seed as a measurement is the one thing
   *  this row must not do. */
  it("says the budget is unmeasured rather than inventing one", async () => {
    status.mockResolvedValue({
      ...IDLE,
      rate: { ...IDLE.rate, remaining: null, limit: null },
    });
    renderWithProviders(panel());
    fireEvent.click(screen.getByRole("button", { name: "Show sync details" }));
    await waitFor(() =>
      expect(screen.getByText("syncPanel.headroomUnknown")).toBeTruthy(),
    );
  });

  /**
   * This test used to assert on `"retry-after"` — a string `client.rs` has
   * never emitted. It passed, and the app was wrong: every real 429 rendered as
   * the app pacing itself, which is the one distinction the field exists to
   * draw. Both branches are pinned now, and `ThrottleKind` makes a third
   * spelling a type error.
   */
  it("names a 429 and a self-imposed pause differently", async () => {
    status.mockResolvedValue({
      ...IDLE,
      rate: { ...IDLE.rate, throttledForMs: 117_400, throttleKind: "retryAfter" },
    });
    const { unmount } = renderWithProviders(panel());
    fireEvent.click(screen.getByRole("button", { name: "Show sync details" }));
    // Rounded up: a countdown that reaches 0 while the client is still parked
    // is worse than one second of over-reporting.
    await waitFor(() =>
      expect(screen.getByText('syncPanel.throttleLimited:{"s":118}')).toBeTruthy(),
    );
    unmount();

    status.mockResolvedValue({
      ...IDLE,
      rate: { ...IDLE.rate, throttledForMs: 400, throttleKind: "preflight" },
    });
    renderWithProviders(panel());
    fireEvent.click(screen.getByRole("button", { name: "Show sync details" }));
    await waitFor(() =>
      expect(screen.getByText('syncPanel.throttlePacing:{"s":1}')).toBeTruthy(),
    );
  });

  /**
   * The complaint this list answers: an idle app has nothing queued, so the
   * panel had nothing to show while the headroom moved underneath it. The
   * traffic is what moves it, and the pacing figure is broken out because
   * self-inflicted delay and AniList being slow look identical from outside.
   */
  it("shows recent traffic even with an empty queue", async () => {
    status.mockResolvedValue({
      ...IDLE,
      recent: [
        {
          seq: 2,
          operation: "MediaListCollection",
          startedAgoMs: 1_200,
          durationMs: 940,
          pacedMs: 0,
          status: 200,
          remainingAfter: 28,
          outcome: "ok",
        },
        {
          seq: 1,
          operation: "Page",
          startedAgoMs: 9_000,
          durationMs: 1_100,
          pacedMs: 800,
          status: 200,
          remainingAfter: 29,
          outcome: "ok",
        },
      ],
    });
    renderWithProviders(panel());
    fireEvent.click(screen.getByRole("button", { name: "Show sync details" }));

    await waitFor(() => expect(screen.getByText("MediaListCollection")).toBeTruthy());
    expect(screen.getByText("syncPanel.empty")).toBeTruthy();
    expect(screen.getByText('syncPanel.tookMs:{"ms":940}')).toBeTruthy();
    // Only the row that actually waited carries the pacing figure — a 0 ms
    // column on every healthy row would bury the one that matters.
    expect(screen.getByText('syncPanel.paced:{"ms":800}')).toBeTruthy();
    expect(screen.queryByText('syncPanel.paced:{"ms":0}')).toBeNull();
    // And the reading's age, which the panel computed and discarded before.
    expect(screen.getByText("syncPanel.measuredNow")).toBeTruthy();
  });

  it("labels a queued row by what it changes", async () => {
    status.mockResolvedValue({
      ...IDLE,
      queued: [
        {
          id: 1,
          kind: "save",
          subject: 21,
          fields: ["progress", "status"],
          queuedAt: Math.floor(Date.now() / 1000) - 120,
        },
      ],
    });
    renderWithProviders(panel());
    fireEvent.click(screen.getByRole("button", { name: "Show sync details" }));
    // No list in the cache, so the title is unknown — and the row says so with
    // the id rather than disappearing, because this count has to agree with the
    // pending badge.
    await waitFor(() =>
      expect(screen.getByText('syncPanel.rowUntitled:{"id":21}')).toBeTruthy(),
    );
    expect(
      screen.getByText("syncPanel.fieldProgress, syncPanel.fieldStatus"),
    ).toBeTruthy();
  });
});

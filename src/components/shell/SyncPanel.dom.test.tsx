import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import type { SyncStatus } from "@/api/types";
import { renderWithProviders, signIn, signOut } from "@/test/render";

/** The one command the panel wraps; `isTauri` is false under jsdom and the hook gates on it, so the module is mocked. */
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
    // Cheap, but still a round-trip per tick with nothing to look at while the panel is shut.
    await waitFor(() => expect(screen.getByRole("button")).toBeTruthy());
    expect(status).not.toHaveBeenCalled();
  });

  it("opens on the trigger and reads the status", async () => {
    renderWithProviders(panel());
    fireEvent.click(screen.getByRole("button", { name: "Show sync details" }));
    await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy());
    expect(status).toHaveBeenCalled();
  });

  /** Proves `data-overlay` holds through the exit animation, so the list behind cannot act on the last frame. */
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

  /** Proves a failed read renders as one, since the empty state would call an unreadable queue "nothing waiting". */
  it("renders a failed read rather than the empty state", async () => {
    status.mockRejectedValue(new Error("database is locked"));
    renderWithProviders(panel());
    fireEvent.click(screen.getByRole("button", { name: "Show sync details" }));
    await waitFor(() => expect(screen.getByText(/database is locked/)).toBeTruthy());
    expect(screen.queryByText("syncPanel.empty")).toBeNull();
  });

  /** Proves the row says "unmeasured" rather than rendering the seed as a measurement. */
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

  /** Pins both `ThrottleKind` branches, so a real 429 never renders as the app pacing itself. */
  it("names a 429 and a self-imposed pause differently", async () => {
    status.mockResolvedValue({
      ...IDLE,
      rate: { ...IDLE.rate, throttledForMs: 117_400, throttleKind: "retryAfter" },
    });
    const { unmount } = renderWithProviders(panel());
    fireEvent.click(screen.getByRole("button", { name: "Show sync details" }));
    // Rounded up; a countdown that reaches 0 while the client is still parked is worse than over-reporting.
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

  /** Proves traffic shows with an empty queue, and pacing is broken out because self-delay looks like a slow AniList. */
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
    // Only the row that waited carries the pacing figure; a column on every healthy row would bury it.
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
    // No cached title, so the row shows the id rather than vanishing: the count must match the pending badge.
    await waitFor(() =>
      expect(screen.getByText('syncPanel.rowUntitled:{"id":21}')).toBeTruthy(),
    );
    expect(
      screen.getByText("syncPanel.fieldProgress, syncPanel.fieldStatus"),
    ).toBeTruthy();
  });
});

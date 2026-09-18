import { afterEach, describe, expect, it } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import DetectionPopup from "./DetectionPopup";
import { renderWithProviders } from "@/test/render";
import { useNowPlaying, type NowPlaying } from "@/stores/nowPlaying";

const PLAYING: NowPlaying = {
  process: "mpv.exe",
  streaming: false,
  mediaType: "ANIME",
  rawTitle: "[Grp] Cowboy Bebop - 05.mkv",
  parsedTitle: "Cowboy Bebop",
  season: null,
  episode: 5,
  sourceEpisode: 5,
  mediaId: 1,
  matchedTitle: "Cowboy Bebop",
  overridden: false,
  progress: 4,
  totalEpisodes: 26,
};

const IDLE = {
  phase: "idle",
  reason: null,
  forceable: false,
  mediaId: null,
  episode: null,
  updateAtMs: null,
  armedAtMs: null,
  yieldingTo: null,
} as const;

function playing(value: NowPlaying | null): void {
  useNowPlaying.setState({ current: value, scrobble: { ...IDLE } });
}

afterEach(() => {
  playing(null);
  localStorage.removeItem("karasu-detection-view");
});

describe("DetectionPopup", () => {
  it("draws nothing while nothing is playing", () => {
    playing(null);
    const { container } = renderWithProviders(<DetectionPopup />);
    expect(container.textContent).toBe("");
  });

  it("names the title and the episode once something plays", () => {
    playing(PLAYING);
    renderWithProviders(<DetectionPopup />);
    expect(screen.getByText("Cowboy Bebop")).toBeTruthy();
    expect(screen.getByText(/common\.episode/)).toBeTruthy();
  });

  /** It arrives unprompted, so it must not take the keyboard away from whatever the user was doing. */
  it("is not an overlay and steals no focus", () => {
    playing(PLAYING);
    renderWithProviders(<DetectionPopup />);
    expect(document.querySelector("[data-overlay]")).toBeNull();
    expect(document.activeElement).toBe(document.body);
  });

  it("collapses to the compact form and back", () => {
    playing(PLAYING);
    renderWithProviders(<DetectionPopup />);
    // The eyebrow and the buttons are the expanded half; the title and the toggle survive the collapse.
    expect(screen.getByText(/nowPlaying\.heading/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "nowPlaying.collapse" }));
    expect(screen.queryByText(/nowPlaying\.heading/)).toBeNull();
    expect(screen.getByText("Cowboy Bebop")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "nowPlaying.expand" }));
    expect(screen.getByText(/nowPlaying\.heading/)).toBeTruthy();
  });

  it("remembers the choice across a remount, which is what makes it a preference", () => {
    playing(PLAYING);
    const first = renderWithProviders(<DetectionPopup />);
    fireEvent.click(screen.getByRole("button", { name: "nowPlaying.collapse" }));
    first.unmount();

    renderWithProviders(<DetectionPopup />);
    expect(screen.getByRole("button", { name: "nowPlaying.expand" })).toBeTruthy();
    expect(screen.queryByText(/nowPlaying\.heading/)).toBeNull();
  });
});

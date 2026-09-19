import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import DetectionPopup from "./DetectionPopup";
import { renderWithProviders, signIn, signOut } from "@/test/render";
import { useNowPlaying, type NowPlaying } from "@/stores/nowPlaying";
import type { ListResult, Media, MediaListEntry } from "@/api/types";
import { DETECTION_MARGIN, DETECTION_MIN_WIDTH } from "@/lib/detectionLayout";

/** jsdom has no `matchMedia`, so the shell shape is a flag the tests flip rather than the real media query. */
const shell = vi.hoisted(() => ({ phone: false }));
vi.mock("@/hooks/usePhoneShell", () => ({ usePhoneShell: () => shell.phone }));

const mediaByIds = vi.hoisted(() => vi.fn((): Promise<Media[]> => Promise.resolve([])));
vi.mock("@/api/queries", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/queries")>()),
  mediaByIds,
}));

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
  episodeTitle: "Asteroid Blues",
};

const MEDIA: Media = {
  id: 1,
  title: { romaji: "Cowboy Bebop", english: null, native: "カウボーイビバップ" },
  coverImage: { large: "https://img.example/bebop.jpg" },
  episodes: 26,
  format: "TV",
  status: "FINISHED",
  season: "SPRING",
  seasonYear: 1998,
  averageScore: null,
  genres: [],
  synonyms: [],
  nextAiringEpisode: null,
};

const ENTRY: MediaListEntry = {
  id: 55,
  mediaId: 1,
  status: "CURRENT",
  score: 8,
  progress: 4,
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
  media: MEDIA,
};

const LIST: ListResult = {
  lists: [{ name: "Watching", status: "CURRENT", isCustomList: false, entries: [ENTRY] }],
  fromCache: false,
  pending: 0,
  fetchedAt: 0,
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

/** A signed-in user whose list cache already holds the detected title, the way every list screen leaves it. */
function mountWithList() {
  const viewer = signIn();
  playing(null);
  const rendered = renderWithProviders(<DetectionPopup />);
  rendered.queryClient.setQueryDefaults(["mediaList"], { gcTime: Infinity });
  rendered.queryClient.setQueryData(["mediaList", "ANIME", viewer.id], LIST);
  act(() => playing(PLAYING));
  return rendered;
}

const region = () => screen.getByRole("region", { name: "nowPlaying.title" });
const handle = () => screen.getByTitle("nowPlaying.dragHint");

/** The card as the browser would lay it out docked bottom-right in a 1024×768 jsdom window. */
function layOut(rect = { left: 600, top: 500, width: 352, height: 160 }) {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    ...rect,
    right: rect.left + rect.width,
    bottom: rect.top + rect.height,
    x: rect.left,
    y: rect.top,
    toJSON: () => rect,
  });
}

function drag(el: HTMLElement, from: [number, number], to: [number, number]): void {
  fireEvent.pointerDown(el, { button: 0, buttons: 1, pointerId: 1, clientX: from[0], clientY: from[1] });
  fireEvent.pointerMove(el, { buttons: 1, pointerId: 1, clientX: to[0], clientY: to[1] });
  fireEvent.pointerUp(el, { button: 0, buttons: 0, pointerId: 1, clientX: to[0], clientY: to[1] });
}

afterEach(() => {
  playing(null);
  signOut();
  shell.phone = false;
  mediaByIds.mockClear();
  localStorage.removeItem("karasu-detection-view");
  localStorage.removeItem("karasu-detection-layout");
  vi.restoreAllMocks();
});

describe("DetectionPopup", () => {
  it("draws nothing while nothing is playing", () => {
    playing(null);
    const { container } = renderWithProviders(<DetectionPopup />);
    expect(container.textContent).toBe("");
  });

  it("names the title, the episode and the episode's own name once something plays", () => {
    playing(PLAYING);
    renderWithProviders(<DetectionPopup />);
    expect(screen.getByText("Cowboy Bebop")).toBeTruthy();
    expect(screen.getByText(/nowPlaying\.episodeShort/)).toBeTruthy();
    expect(screen.getByText(/Asteroid Blues/)).toBeTruthy();
  });

  it("spells the season only when the source carried one, and chapters for manga", () => {
    playing({ ...PLAYING, season: 2 });
    const first = renderWithProviders(<DetectionPopup />);
    expect(screen.getByText(/nowPlaying\.seasonEpisode/)).toBeTruthy();
    first.unmount();
    playing({ ...PLAYING, mediaType: "MANGA", episode: 12 });
    renderWithProviders(<DetectionPopup />);
    expect(screen.getByText(/nowPlaying\.chapterShort/)).toBeTruthy();
  });

  it("draws the cover, the native title and the AniList line from the list cache", () => {
    mountWithList();
    const img = region().querySelector("img[src='https://img.example/bebop.jpg']");
    expect(img).not.toBeNull();
    expect(screen.getByText("カウボーイビバップ")).toBeTruthy();
    const meta = screen.getByText(/format\.TV/);
    expect(meta.textContent).toMatch(/season\.SPRING/);
    expect(meta.textContent).toMatch(/1998/);
    expect(meta.textContent).toMatch(/nowPlaying\.episodesShort/);
    // The cache answered, so the one bounded request for an off-list title never went out.
    expect(mediaByIds).not.toHaveBeenCalled();
  });

  it("asks once for a title the list cache cannot answer, and shows the placeholder meanwhile", async () => {
    mediaByIds.mockResolvedValueOnce([MEDIA]);
    playing(PLAYING);
    renderWithProviders(<DetectionPopup />);
    expect(region().querySelector("img")).toBeNull();
    await waitFor(() => expect(region().querySelector("img")).not.toBeNull());
    expect(mediaByIds).toHaveBeenCalledTimes(1);
    expect(mediaByIds).toHaveBeenCalledWith([1]);
  });

  it("is a named landmark, so a screen reader can reach it without it taking focus", () => {
    playing(PLAYING);
    renderWithProviders(<DetectionPopup />);
    expect(region()).toBeTruthy();
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

describe("DetectionPopup as a window", () => {
  it("stays docked until the header is dragged, then follows the pointer by its travel", () => {
    layOut();
    playing(PLAYING);
    renderWithProviders(<DetectionPopup />);
    expect(region().style.left).toBe("");
    drag(handle(), [700, 510], [650, 400]);
    expect(region().classList.contains("fixed")).toBe(true);
    expect(region().style.left).toBe("550px");
    expect(region().style.top).toBe("390px");
  });

  it("treats a wobble under the threshold as a press, not a drag", () => {
    layOut();
    playing(PLAYING);
    renderWithProviders(<DetectionPopup />);
    drag(handle(), [700, 510], [702, 511]);
    expect(region().style.left).toBe("");
  });

  it("never leaves the viewport", () => {
    layOut();
    playing(PLAYING);
    renderWithProviders(<DetectionPopup />);
    drag(handle(), [700, 510], [-500, -500]);
    expect(region().style.left).toBe(`${DETECTION_MARGIN}px`);
    expect(region().style.top).toBe(`${DETECTION_MARGIN}px`);
  });

  it("remembers where it was put and how wide it is", () => {
    layOut();
    playing(PLAYING);
    const first = renderWithProviders(<DetectionPopup />);
    drag(handle(), [700, 510], [650, 400]);
    first.unmount();
    expect(JSON.parse(localStorage.getItem("karasu-detection-layout")!)).toEqual({
      left: 550,
      top: 390,
      width: 352,
    });
    renderWithProviders(<DetectionPopup />);
    expect(region().style.left).toBe("550px");
    expect(region().style.width).toBe("352px");
  });

  it("docks again on a double click of the header", () => {
    layOut();
    playing(PLAYING);
    renderWithProviders(<DetectionPopup />);
    drag(handle(), [700, 510], [650, 400]);
    fireEvent.doubleClick(handle());
    expect(region().style.left).toBe("");
    expect(JSON.parse(localStorage.getItem("karasu-detection-layout")!)).toEqual({ width: 352 });
  });

  it("widens from its left edge, keeping the right edge where it was", () => {
    layOut();
    playing(PLAYING);
    renderWithProviders(<DetectionPopup />);
    const edge = region().querySelector<HTMLElement>(".cursor-ew-resize")!;
    drag(edge, [600, 520], [500, 520]);
    expect(region().style.width).toBe("452px");
    drag(edge, [500, 520], [900, 520]);
    expect(region().style.width).toBe(`${DETECTION_MIN_WIDTH}px`);
  });

  it("keeps the phone's dock: no handle, no edge, and a drag that changes nothing", () => {
    shell.phone = true;
    layOut();
    playing(PLAYING);
    renderWithProviders(<DetectionPopup />);
    expect(screen.queryByTitle("nowPlaying.dragHint")).toBeNull();
    expect(region().querySelector(".cursor-ew-resize")).toBeNull();
    drag(screen.getByText(/nowPlaying\.heading/), [700, 510], [650, 400]);
    expect(region().style.left).toBe("");
    expect(region().style.width).toBe("");
  });
});

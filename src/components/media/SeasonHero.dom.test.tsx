import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import type { HeroMedia } from "@/api/queries";
import { useContentFilter } from "@/stores/contentFilter";
import { renderWithProviders } from "@/test/render";

const hero = vi.fn<() => Promise<HeroMedia[]>>();

vi.mock("@/api/anilist", async (orig) => ({
  ...(await orig<typeof import("@/api/anilist")>()),
  isTauri: true,
}));

vi.mock("@/api/queries", async (orig) => ({
  ...(await orig<typeof import("@/api/queries")>()),
  seasonHero: () => hero(),
}));

import SeasonHero from "./SeasonHero";

const media = (id: number, romaji: string, over: Partial<HeroMedia> = {}): HeroMedia => ({
  id,
  type: "ANIME",
  title: { romaji, english: null, native: null },
  bannerImage: `https://s4.anilist.co/banner/${id}.jpg`,
  coverImage: { extraLarge: null, large: null },
  format: "TV",
  episodes: 12,
  averageScore: 80,
  genres: [],
  isAdult: false,
  ...over,
});

beforeEach(() => {
  hero.mockReset();
  useContentFilter.setState({ level: "off", ready: true, error: null });
});

afterEach(() => {
  vi.useRealTimers();
  useContentFilter.setState({ level: "strict", ready: false, error: null });
});

describe("SeasonHero", () => {
  it("links the title to the entry", async () => {
    hero.mockResolvedValue([media(1, "Frieren")]);
    renderWithProviders(<SeasonHero />);
    const link = await screen.findByRole("link", { name: "Frieren" });
    // `renderWithProviders` uses a MemoryRouter, so no hash prefix here.
    expect(link.getAttribute("href")).toBe("/media/1");
  });

  /** Nothing is a better hero than a broken one. */
  it("renders nothing at all when the season came back empty", async () => {
    hero.mockResolvedValue([]);
    const { container } = renderWithProviders(<SeasonHero />);
    await waitFor(() => expect(container.querySelector("section")).toBeNull());
  });

  /** Proves the genre rule, which the query argument cannot cover, runs on the hero too. */
  it("drops a title the content filter blocks", async () => {
    useContentFilter.setState({ level: "moderate", ready: true, error: null });
    hero.mockResolvedValue([media(1, "Blocked", { isAdult: true }), media(2, "Fine")]);
    renderWithProviders(<SeasonHero />);
    await waitFor(() => expect(screen.getByRole("link", { name: "Fine" })).toBeTruthy());
    expect(screen.queryByRole("link", { name: "Blocked" })).toBeNull();
  });

  it("offers one dot per title, and none for a single one", async () => {
    hero.mockResolvedValue([media(1, "A"), media(2, "B"), media(3, "C")]);
    const { unmount } = renderWithProviders(<SeasonHero />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "A" })).toBeTruthy(),
    );
    // Three dots plus the prev/next pair.
    expect(screen.getAllByRole("button")).toHaveLength(5);
    unmount();

    hero.mockResolvedValue([media(9, "Only")]);
    renderWithProviders(<SeasonHero />);
    await waitFor(() => expect(screen.getByRole("link", { name: "Only" })).toBeTruthy());
    // No dots and no arrows: there is nowhere to go.
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  /** A slide mounts only as the active one or its successor, and stays once seen, since unmounting drops the decode. */
  it("mounts a slide only once it is needed, and the arrows step and wrap", async () => {
    hero.mockResolvedValue([media(1, "A"), media(2, "B"), media(3, "C")]);
    const { container } = renderWithProviders(<SeasonHero />);
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("A"),
    );
    // Probed by the img, not by role: an inactive slide is aria-hidden, so by name it looks unmounted.
    expect(container.querySelector('img[src*="banner/3"]')).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "dashboard.heroNext" }));
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("B");
    // B's successor is C, so its banner exists now, preloaded for the crossfade and still hidden.
    expect(container.querySelector('img[src*="banner/3"]')).toBeTruthy();

    // Backwards from the second, twice: past the first, wrapping to the last.
    const prev = screen.getByRole("button", { name: "dashboard.heroPrev" });
    fireEvent.click(prev);
    fireEvent.click(prev);
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("C");
  });

  it("advances on its own", async () => {
    // Faked before the render, or the mount effect's timer stays real; `shouldAdvanceTime` lets the query settle.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    hero.mockResolvedValue([media(1, "First"), media(2, "Second")]);
    renderWithProviders(<SeasonHero />);
    // The heading is the current slide; both stay mounted, so the heading has to change rather than the link set.
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("First"),
    );
    await act(async () => {
      vi.advanceTimersByTime(7000);
    });
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Second");
  });

  // No reduced-motion hold, deliberately: advancing is content, not motion, and the crossfade is what the CSS cuts.
});

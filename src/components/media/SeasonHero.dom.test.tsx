import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import type { HeroMedia } from "@/api/queries";
import { useContentFilter } from "@/stores/contentFilter";
import { renderWithProviders } from "@/test/render";

const hero = vi.fn<() => Promise<HeroMedia[]>>();
const reduced = vi.fn(() => false);

vi.mock("@/api/anilist", async (orig) => ({
  ...(await orig<typeof import("@/api/anilist")>()),
  isTauri: true,
}));

vi.mock("@/api/queries", async (orig) => ({
  ...(await orig<typeof import("@/api/queries")>()),
  seasonHero: () => hero(),
}));

vi.mock("@/lib/motion", async (orig) => ({
  ...(await orig<typeof import("@/lib/motion")>()),
  prefersReducedMotion: () => reduced(),
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
  reduced.mockReturnValue(false);
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

  /** The same filter every other dashboard section runs through — the query
   *  argument covers the server side, this covers the genre rule. */
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

  /** Five parallel banner downloads at first paint were the hero's whole
   *  wait, so a slide mounts only as the active one or its successor —
   *  and stays mounted once seen, because unmounting drops the decode. */
  it("mounts a slide only once it is needed, and the arrows step and wrap", async () => {
    hero.mockResolvedValue([media(1, "A"), media(2, "B"), media(3, "C")]);
    const { container } = renderWithProviders(<SeasonHero />);
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("A"),
    );
    // Probed by the banner img, not by role: an inactive slide is
    // aria-hidden, which also empties its accessible name — a name query
    // could never tell "not mounted" from "mounted and hidden".
    expect(container.querySelector('img[src*="banner/3"]')).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "dashboard.heroNext" }));
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("B");
    // B's successor is C, so its banner exists now — preloaded for the
    // crossfade, still hidden until it becomes the active slide.
    expect(container.querySelector('img[src*="banner/3"]')).toBeTruthy();

    // Backwards from the second, twice: past the first, wrapping to the last.
    const prev = screen.getByRole("button", { name: "dashboard.heroPrev" });
    fireEvent.click(prev);
    fireEvent.click(prev);
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("C");
  });

  it("advances on its own", async () => {
    // Installed *before* the render: the slide timer is scheduled in a mount
    // effect, so faking the clock afterwards leaves it on the real one and the
    // test waits seven seconds to fail. `shouldAdvanceTime` lets the query's
    // promise still settle.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    hero.mockResolvedValue([media(1, "First"), media(2, "Second")]);
    renderWithProviders(<SeasonHero />);
    // The heading is the *current* slide; both stay mounted, so it is the
    // heading that has to change rather than the link set.
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("First"),
    );
    await act(async () => {
      vi.advanceTimersByTime(7000);
    });
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Second");
  });

  /**
   * The rotation is a `setTimeout`, and the `!important` reduce-motion rules in
   * `index.css` act on animation and transition properties — they cannot see a
   * timer. So it has to ask, and holding on the first slide is right twice
   * over: it is also the most popular title.
   */
  it("holds on the first title under reduced motion", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    reduced.mockReturnValue(true);
    hero.mockResolvedValue([media(1, "First"), media(2, "Second")]);
    renderWithProviders(<SeasonHero />);
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("First"),
    );
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("First");
  });
});

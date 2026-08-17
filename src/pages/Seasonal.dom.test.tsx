import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import type { MediaWithListStatus } from "@/api/queries";
import { useContentFilter } from "@/stores/contentFilter";
import { renderWithProviders, signIn, signOut } from "@/test/render";

/**
 * The grouping arithmetic is proven in `lib/formatGroups.test.ts`. This is the
 * other half — that the JSX carries it: right sections, right order, right
 * counts, and a roving offset that survives being split across grids.
 *
 * The page gates its query on `isTauri`, so the module is the seam.
 */
const seasonal = vi.fn();

vi.mock("@/api/anilist", async (orig) => ({
  ...(await orig<typeof import("@/api/anilist")>()),
  isTauri: true,
}));

vi.mock("@/api/queries", async (orig) => ({
  ...(await orig<typeof import("@/api/queries")>()),
  seasonalAnime: () => seasonal(),
}));

import Seasonal from "./Seasonal";

let nextId = 1;
const media = (format: string | null, over: Partial<MediaWithListStatus> = {}) =>
  ({
    id: nextId++,
    type: "ANIME",
    title: { romaji: `Title ${nextId}`, english: null, native: null },
    coverImage: { large: null },
    format,
    genres: [],
    mediaListEntry: null,
    ...over,
  }) as unknown as MediaWithListStatus;

beforeEach(() => {
  nextId = 1;
  signIn();
  // The page renders nothing until the stored filter level has been read.
  useContentFilter.setState({ level: "off", ready: true, error: null });
  seasonal.mockReset();
});

afterEach(() => {
  signOut();
  useContentFilter.setState({ level: "strict", ready: false, error: null });
});

const headings = () =>
  screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);

describe("Seasonal grouping", () => {
  it("orders the sections by format, not by what AniList sent", async () => {
    seasonal.mockResolvedValue({
      media: [media("MUSIC"), media("MOVIE"), media("TV"), media("OVA")],
    });
    renderWithProviders(<Seasonal />);
    await waitFor(() => expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(4));
    expect(headings()).toEqual([
      "format.TV",
      "format.MOVIE",
      "format.OVA",
      "format.MUSIC",
    ]);
  });

  /** A heading over nothing is worse than no heading. */
  it("shows only the formats this season has", async () => {
    seasonal.mockResolvedValue({ media: [media("TV"), media("TV")] });
    renderWithProviders(<Seasonal />);
    await waitFor(() => expect(headings()).toEqual(["format.TV"]));
  });

  /**
   * `Media.format` is `string | null`, so a value AniList adds later has to
   * land somewhere rather than dropping off a page that claims to show the
   * season.
   */
  it("keeps an unknown format under a trailing heading", async () => {
    seasonal.mockResolvedValue({
      media: [media("TV"), media("HOLOGRAM"), media(null)],
    });
    renderWithProviders(<Seasonal />);
    await waitFor(() =>
      expect(headings()).toEqual(["format.TV", "seasonal.otherFormats"]),
    );
    // Both oddities are in it — two cards under one heading.
    const other = screen.getByRole("heading", { name: "seasonal.otherFormats" })
      .parentElement!.parentElement!;
    expect(within(other).getAllByRole("link").length).toBeGreaterThanOrEqual(2);
  });

  it("counts each section beside its heading", async () => {
    seasonal.mockResolvedValue({
      media: [media("TV"), media("TV"), media("TV"), media("MOVIE")],
    });
    renderWithProviders(<Seasonal />);
    await waitFor(() => expect(headings()).toEqual(["format.TV", "format.MOVIE"]));
    expect(screen.getByText("3")).toBeTruthy();
    expect(screen.getByText("1")).toBeTruthy();
  });

  /**
   * The badge only ever appears with the filter off — `adultQueryArg` excludes
   * these server-side at moderate and strict, so they never reach a card. That
   * is correct, and it is why this test sets the level explicitly.
   */
  it("marks adult titles, and only those", async () => {
    seasonal.mockResolvedValue({
      media: [media("TV", { isAdult: true }), media("TV", { isAdult: false })],
    });
    renderWithProviders(<Seasonal />);
    await waitFor(() => expect(screen.getByText("18+")).toBeTruthy());
    expect(screen.getAllByText("18+")).toHaveLength(1);
  });

  it("renders every title exactly once across the sections", async () => {
    seasonal.mockResolvedValue({
      media: [media("TV"), media("MOVIE"), media("TV"), media("MUSIC")],
    });
    renderWithProviders(<Seasonal />);
    await waitFor(() => expect(headings()).toHaveLength(3));
    expect(document.querySelectorAll("[data-media-id]")).toHaveLength(4);
  });
});

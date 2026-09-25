import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import type { ListResult } from "@/api/types";
import type { MediaWithListStatus } from "@/api/queries";
import { renderWithProviders, signOut, useLocalProfile } from "@/test/render";

/** Proves the card resolves its entry from the local list, since AniList reports null for every title without a token. */
vi.mock("@/api/anilist", async (orig) => ({
  ...(await orig<typeof import("@/api/anilist")>()),
  isTauri: true,
}));

import MediaCard from "./MediaCard";

const media = (over: Partial<MediaWithListStatus> = {}) =>
  ({
    id: 21,
    type: "ANIME",
    title: { romaji: "One Piece", english: null, native: null },
    coverImage: { large: null },
    format: "TV",
    genres: [],
    isAdult: false,
    averageScore: null,
    // What AniList always returns in local mode, for every title.
    mediaListEntry: null,
    ...over,
  }) as unknown as MediaWithListStatus;

/** A local list that *does* hold the title, as SQLite would serve it. */
const localList = (): ListResult => ({
  fromCache: false,
  pending: 0,
  lists: [
    {
      name: "Watching",
      status: "CURRENT",
      isCustomList: false,
      entries: [
        {
          id: 500,
          mediaId: 21,
          status: "CURRENT",
          score: 9,
          progress: 87,
          progressVolumes: 0,
          repeat: 0,
          notes: "keep me",
          updatedAt: 0,
          private: false,
        },
      ],
    },
  ],
} as unknown as ListResult);

beforeEach(useLocalProfile);
afterEach(signOut);

describe("MediaCard in the account-free profile", () => {
  it("finds the entry in the local list when AniList reports none", async () => {
    const { queryClient } = renderWithProviders(<MediaCard media={media()} />);
    // The list screens key on user 0 — the `?? 0` convention.
    queryClient.setQueryData(["mediaList", "ANIME", 0], localList());

    // The status circle, not the add-to-Planning plus: the card resolved the entry rather than believing the null.
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "media.addDefault" })).toBeNull(),
    );
    expect(screen.getByTitle("status.ANIME.CURRENT")).toBeInTheDocument();
  });

  it("gives up edit, never the status or the quick add, on a cover too narrow for two circles", async () => {
    const { queryClient } = renderWithProviders(<MediaCard media={media({ id: 999 })} />);
    queryClient.setQueryData(["mediaList", "ANIME", 0], localList());
    await screen.findByRole("button", { name: "media.addDefault" });
    expect(screen.getByRole("button", { name: "common.edit" })).toHaveClass("@max-cover-pair:hidden");
    expect(screen.getByRole("button", { name: "media.addDefault" })).not.toHaveClass("@max-cover-pair:hidden");
  });

  /** A title genuinely absent must still offer the quick add. */
  it("still offers the quick add for a title that is not on the local list", async () => {
    const { queryClient } = renderWithProviders(
      <MediaCard media={media({ id: 999 })} />,
    );
    queryClient.setQueryData(["mediaList", "ANIME", 0], localList());
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "media.addDefault" })).toBeInTheDocument(),
    );
  });
});

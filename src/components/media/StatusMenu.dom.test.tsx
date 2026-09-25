import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { MediaDetail } from "@/api/queries";
import type { MutationResult, SaveEntryInput } from "@/api/types";
import { checkA11y } from "@/test/a11y";
import { renderWithProviders, signIn, signOut } from "@/test/render";

const save = vi.fn<(input: SaveEntryInput, media?: unknown) => Promise<MutationResult>>();

vi.mock("@/api/anilist", async (orig) => ({
  ...(await orig<typeof import("@/api/anilist")>()),
  isTauri: true,
  saveListEntry: (input: SaveEntryInput, media?: unknown) => save(input, media),
}));

import { StatusMenu } from "./StatusMenu";

/** Only the fields the menu and the completion fill read; the rest of a detail is the page's business. */
const media = {
  id: 42,
  type: "ANIME",
  title: { romaji: "Sparks of Tomorrow", english: null, native: null },
  episodes: 13,
  chapters: null,
  volumes: null,
  mediaListEntry: { id: 7, status: "CURRENT", progress: 11, score: 0, repeat: 0, notes: null },
} as unknown as MediaDetail;

const echo = (over: Record<string, unknown>) =>
  ({
    queued: false,
    entry: { id: 7, mediaId: 42, status: "CURRENT", progress: 11, score: 0, repeat: 0, notes: null, updatedAt: 1, ...over },
  }) as MutationResult;

function mount(entry: { status: "CURRENT" | "PLANNING" } | null, detail: MediaDetail = media) {
  const out = renderWithProviders(
    <StatusMenu media={detail} entry={entry} progressLabel={entry ? "· 11 / 13" : null} />,
  );
  // The page's query holds this copy in the app; here nothing observes it, so it must outlive the test client's zero gcTime.
  out.queryClient.setQueryDefaults(["mediaDetail"], { gcTime: Infinity });
  out.queryClient.setQueryData(["mediaDetail", 42], detail);
  return out;
}

async function pick(label: string) {
  const user = userEvent.setup({ delay: null });
  await user.click(screen.getByTitle("actions.changeStatus"));
  const sheet = await screen.findByRole("dialog");
  await user.click(within(sheet).getByRole("button", { name: label }));
}

beforeEach(() => {
  save.mockReset();
  signIn();
});

afterEach(() => {
  cleanup();
  signOut();
});

describe("StatusMenu", () => {
  it("names the entry's status and progress, and offers all six with the current one pressed", async () => {
    mount({ status: "CURRENT" });
    const trigger = screen.getByTitle("actions.changeStatus");
    expect(trigger).toHaveTextContent("status.ANIME.CURRENT· 11 / 13");
    await userEvent.setup({ delay: null }).click(trigger);
    const sheet = await screen.findByRole("dialog");
    const options = within(sheet).getAllByRole("button");
    expect(options.map((o) => o.textContent)).toEqual([
      "status.ANIME.CURRENT",
      "status.ANIME.REPEATING",
      "status.ANIME.COMPLETED",
      "status.ANIME.PAUSED",
      "status.ANIME.DROPPED",
      "status.ANIME.PLANNING",
    ]);
    expect(within(sheet).getByRole("button", { name: "status.ANIME.CURRENT" })).toHaveAttribute("aria-pressed", "true");
    await checkA11y(document.body);
  });

  /** The same fill the editor and the list apply, so a move into Completed from here also finishes the count. */
  it("moves the entry, filling the episode count on the way into Completed, and shows it at once", async () => {
    let land!: (r: MutationResult) => void;
    save.mockReturnValue(new Promise((resolve) => (land = resolve)));
    const { queryClient } = mount({ status: "CURRENT" });
    await pick("status.ANIME.COMPLETED");
    expect(save).toHaveBeenCalledWith({ mediaId: 42, status: "COMPLETED", progress: 13 }, undefined);
    // Before the write answers: the page's own copy already says where the entry went.
    const copy = () => queryClient.getQueryData<MediaDetail>(["mediaDetail", 42])?.mediaListEntry;
    expect(copy()).toMatchObject({ status: "COMPLETED", progress: 13 });
    land(echo({ status: "COMPLETED", progress: 13, score: 9 }));
    await waitFor(() => expect(copy()).toMatchObject({ status: "COMPLETED", progress: 13, score: 9 }));
  });

  it("puts the page's copy back when the write fails", async () => {
    save.mockRejectedValue(new Error("offline and not queued"));
    const { queryClient } = mount({ status: "CURRENT" });
    await pick("status.ANIME.PAUSED");
    await waitFor(() =>
      expect(queryClient.getQueryData<MediaDetail>(["mediaDetail", 42])?.mediaListEntry).toMatchObject({
        status: "CURRENT",
        progress: 11,
      }),
    );
  });

  it("does not write when the status picked is the one the entry already has", async () => {
    mount({ status: "CURRENT" });
    await pick("status.ANIME.CURRENT");
    expect(save).not.toHaveBeenCalled();
  });

  /** A new local entry is refused without its media object, which the list hook's save never sends. */
  it("adds a title that is not on the list, carrying its media", async () => {
    save.mockResolvedValue(echo({ status: "PLANNING", progress: 0 }));
    const detail = { ...media, mediaListEntry: null } as MediaDetail;
    const { queryClient } = mount(null, detail);
    expect(screen.getByTitle("actions.changeStatus")).toHaveTextContent("detail.addToList");
    await pick("status.ANIME.PLANNING");
    expect(save).toHaveBeenCalledWith({ mediaId: 42, status: "PLANNING" }, detail);
    await waitFor(() =>
      expect(queryClient.getQueryData<MediaDetail>(["mediaDetail", 42])?.mediaListEntry).toMatchObject({
        status: "PLANNING",
      }),
    );
  });

  /** The local echo carries ids and a timestamp only; taking it as the entry would name a status it does not have. */
  it("keeps the page's copy when the echo does not say the status", async () => {
    // Cast, because the type promises the AniList echo's fields and this is exactly the answer that lacks them.
    save.mockResolvedValue({ queued: false, entry: { id: 42, mediaId: 42, updatedAt: 1 } } as unknown as MutationResult);
    const detail = { ...media, mediaListEntry: null } as MediaDetail;
    const { queryClient } = mount(null, detail);
    await pick("status.ANIME.PLANNING");
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(queryClient.getQueryData<MediaDetail>(["mediaDetail", 42])?.mediaListEntry).toBeNull();
  });
});

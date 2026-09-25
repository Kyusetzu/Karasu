import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import { useQuery } from "@tanstack/react-query";
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
  averageScore: 76,
  stats: {
    scoreDistribution: [36, 27, 56, 100, 189, 294, 684, 926, 944, 522].map((amount, i) => ({ score: (i + 1) * 10, amount })),
    statusDistribution: null,
  },
  mediaListEntry: { id: 7, status: "CURRENT", progress: 11, score: 0, repeat: 0, notes: null },
} as unknown as MediaDetail;

const echo = (over: Record<string, unknown>) =>
  ({
    queued: false,
    entry: { id: 7, mediaId: 42, status: "CURRENT", progress: 11, score: 0, repeat: 0, notes: null, updatedAt: 1, ...over },
  }) as MutationResult;

/** The page's wiring: the entry is read back from the detail query, so an optimistic patch shows as it would there. */
function Page({ detail }: { detail: MediaDetail }) {
  const { data } = useQuery({ queryKey: ["mediaDetail", 42], queryFn: () => detail, initialData: detail, staleTime: Infinity });
  const entry = data.mediaListEntry;
  return (
    <StatusMenu
      media={data}
      entry={entry}
      progressLabel={entry ? `· ${entry.progress} / 13` : null}
      variant="sheet"
    />
  );
}

function mount(detail: MediaDetail = media) {
  return renderWithProviders(<Page detail={detail} />);
}

async function open() {
  const user = userEvent.setup({ delay: null });
  await user.click(screen.getByTitle("actions.changeStatus"));
  return { user, sheet: await screen.findByRole("dialog") };
}

async function pick(label: string) {
  const { user, sheet } = await open();
  await user.click(within(sheet).getByRole("button", { name: label }));
}

const copy = (qc: { getQueryData: (k: unknown[]) => unknown }) =>
  (qc.getQueryData(["mediaDetail", 42]) as MediaDetail | undefined)?.mediaListEntry;

beforeEach(() => {
  save.mockReset();
  signIn();
});

afterEach(() => {
  cleanup();
  signOut();
});

describe("StatusMenu", () => {
  it("names the entry's status and progress, and opens the six statuses with the current one pressed", async () => {
    mount();
    const trigger = screen.getByTitle("actions.changeStatus");
    expect(trigger).toHaveTextContent("status.ANIME.CURRENT· 11 / 13");
    const { sheet } = await open();
    const statuses = within(within(sheet).getByRole("group", { name: "common.status" })).getAllByRole("button");
    expect(statuses.map((o) => o.textContent)).toEqual([
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
    const { queryClient } = mount();
    await pick("status.ANIME.COMPLETED");
    expect(save).toHaveBeenCalledWith({ mediaId: 42, status: "COMPLETED", progress: 13 }, undefined);
    // Before the write answers: the page's own copy already says where the entry went.
    expect(copy(queryClient)).toMatchObject({ status: "COMPLETED", progress: 13 });
    land(echo({ status: "COMPLETED", progress: 13, score: 9 }));
    await waitFor(() => expect(copy(queryClient)).toMatchObject({ status: "COMPLETED", progress: 13, score: 9 }));
  });

  it("puts the page's copy back when the write fails", async () => {
    save.mockRejectedValue(new Error("offline and not queued"));
    const { queryClient } = mount();
    await pick("status.ANIME.PAUSED");
    await waitFor(() => expect(copy(queryClient)).toMatchObject({ status: "CURRENT", progress: 11 }));
  });

  it("does not write when the status picked is the one the entry already has", async () => {
    mount();
    await pick("status.ANIME.CURRENT");
    expect(save).not.toHaveBeenCalled();
  });

  /** A new local entry is refused without its media object, which the list hook's save never sends. */
  it("adds a title that is not on the list, carrying its media", async () => {
    save.mockResolvedValue(echo({ status: "PLANNING", progress: 0 }));
    const detail = { ...media, mediaListEntry: null } as MediaDetail;
    const { queryClient } = mount(detail);
    expect(screen.getByTitle("actions.changeStatus")).toHaveTextContent("detail.addToList");
    const { user, sheet } = await open();
    // Not on the list: only the statuses to add it with, and nothing to count or score yet.
    expect(within(sheet).getByRole("group", { name: "detail.addAs" })).toBeInTheDocument();
    expect(within(sheet).queryByRole("spinbutton")).toBeNull();
    await user.click(within(sheet).getByRole("button", { name: "status.ANIME.PLANNING" }));
    expect(save).toHaveBeenCalledWith({ mediaId: 42, status: "PLANNING" }, detail);
    await waitFor(() => expect(copy(queryClient)).toMatchObject({ status: "PLANNING" }));
    // Added, the rest of the editor opens up in the same sheet.
    expect(await within(sheet).findByRole("spinbutton", { name: "common.progress" })).toBeInTheDocument();
  });

  /** The local echo carries ids and a timestamp only; taking it as the entry would name a status it does not have. */
  it("keeps the page's copy when the echo does not say the status", async () => {
    // Cast, because the type promises the AniList echo's fields and this is exactly the answer that lacks them.
    save.mockResolvedValue({ queued: false, entry: { id: 42, mediaId: 42, updatedAt: 1 } } as unknown as MutationResult);
    const detail = { ...media, mediaListEntry: null } as MediaDetail;
    const { queryClient } = mount(detail);
    await pick("status.ANIME.PLANNING");
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(copy(queryClient)).toBeNull();
  });

  it("steps the progress either way, saving each step", async () => {
    save.mockImplementation((input) => Promise.resolve(echo({ progress: input.progress })));
    const { queryClient } = mount();
    const { user, sheet } = await open();
    await user.click(within(sheet).getByRole("button", { name: "detail.progressMore" }));
    expect(save).toHaveBeenLastCalledWith({ mediaId: 42, progress: 12 }, undefined);
    await waitFor(() => expect(copy(queryClient)).toMatchObject({ progress: 12 }));
    await user.click(within(sheet).getByRole("button", { name: "detail.progressLess" }));
    expect(save).toHaveBeenLastCalledWith({ mediaId: 42, progress: 11 }, undefined);
  });

  /** A typed count is one write when the field is left, not one per keystroke. */
  it("saves a typed count once the field is left, and when the back gesture closes the sheet on it", async () => {
    save.mockImplementation((input) => Promise.resolve(echo({ progress: input.progress })));
    mount();
    const { user, sheet } = await open();
    const field = within(sheet).getByRole("spinbutton", { name: "common.progress" });
    await user.clear(field);
    await user.type(field, "5");
    expect(save).not.toHaveBeenCalled();
    await user.tab();
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenLastCalledWith({ mediaId: 42, progress: 5 }, undefined);

    // Android's back gesture closes the sheet with the field still focused, and an unmounted field sends no blur.
    await user.clear(field);
    await user.type(field, "7");
    window.history.back();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(save).toHaveBeenLastCalledWith({ mediaId: 42, progress: 7 }, undefined);
  });

  /** The bars are the community's own histogram, and the line under them says where its mean sits and on how many. */
  it("scores from a bar of the community histogram and says what the community gave", async () => {
    save.mockImplementation((input) => Promise.resolve(echo({ score: input.score })));
    mount();
    const { user, sheet } = await open();
    expect(within(sheet).getByText('detail.communityMean:{"mean":"7.6","count":"3,778"}')).toBeInTheDocument();
    await user.click(within(sheet).getByRole("button", { name: "8" }));
    expect(save).toHaveBeenLastCalledWith({ mediaId: 42, score: 8 }, undefined);
    await waitFor(() => expect(within(sheet).getByRole("button", { name: "8" })).toHaveAttribute("aria-pressed", "true"));
    // The score given pressed again clears it.
    await user.click(within(sheet).getByRole("button", { name: "8" }));
    expect(save).toHaveBeenLastCalledWith({ mediaId: 42, score: 0 }, undefined);
  });

  it("saves rewatches, tags and notes together from behind the fold", async () => {
    save.mockImplementation(() => Promise.resolve(echo({})));
    mount();
    const { user, sheet } = await open();
    await user.click(within(sheet).getByRole("button", { name: "detail.moreAnime" }));
    await user.click(within(sheet).getByRole("button", { name: "entry.addRepeat" }));
    await user.type(within(sheet).getByRole("textbox", { name: "entry.notes" }), "rewatch in spring");
    expect(save).not.toHaveBeenCalled();
    await user.click(within(sheet).getByRole("button", { name: "common.save" }));
    expect(save).toHaveBeenLastCalledWith({ mediaId: 42, repeat: 1, notes: "rewatch in spring" }, undefined);
  });
});

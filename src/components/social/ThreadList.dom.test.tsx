import { describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import type { ThreadPage, ThreadSummary } from "@/api/social";
import { renderWithProviders } from "@/test/render";

vi.mock("@/api/anilist", async (orig) => ({
  ...(await orig<typeof import("@/api/anilist")>()),
  isTauri: true,
}));

import { ThreadList } from "./ThreadList";

const thread = (id: number): ThreadSummary =>
  ({
    id,
    title: `Thread ${id}`,
    replyCount: 0,
    viewCount: 0,
    likeCount: 0,
    isLiked: false,
    isLocked: false,
    isSticky: false,
    repliedAt: 0,
    createdAt: 0,
    siteUrl: null,
    user: null,
    replyUser: null,
    categories: null,
  }) as unknown as ThreadSummary;

const page = (threads: ThreadSummary[], hasNextPage: boolean): ThreadPage => ({
  pageInfo: { total: 0, currentPage: 1, lastPage: hasNextPage ? 2 : 1, hasNextPage },
  threads,
});

/** An empty page with more behind it still offers the next page; AniList really answers that way. */
describe("ThreadList paging states", () => {
  it("still offers the next page when the first one came back empty", async () => {
    const fetchPage = vi.fn(async () => page([], true));

    renderWithProviders(
      <ThreadList
        queryKey={["test", "empty-with-more"]}
        fetchPage={fetchPage}
        emptyTitle="Nothing subscribed here yet."
      />,
    );

    expect(await screen.findByText("Nothing subscribed here yet.")).toBeInTheDocument();
    // The button is the whole point: without it the reader cannot reach page 2.
    expect(screen.getByRole("button", { name: "social.loadMorePlain" })).toBeInTheDocument();
  });

  it("offers nothing further when the empty page really is the end", async () => {
    const fetchPage = vi.fn(async () => page([], false));

    renderWithProviders(
      <ThreadList
        queryKey={["test", "empty-final"]}
        fetchPage={fetchPage}
        emptyTitle="Nothing subscribed here yet."
      />,
    );

    expect(await screen.findByText("Nothing subscribed here yet.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "social.loadMorePlain" })).toBeNull();
  });

  it("forwards the actions an empty list is allowed to offer", async () => {
    const fetchPage = vi.fn(async () => page([], false));

    renderWithProviders(
      <ThreadList
        queryKey={["test", "empty-actions"]}
        fetchPage={fetchPage}
        emptyTitle="Nothing here"
        emptyActions={<button type="button">Browse the forum</button>}
      />,
    );

    expect(await screen.findByText("Browse the forum")).toBeInTheDocument();
  });

  /** A failure on a later page must not take the pages already on screen with it. */
  it("keeps the loaded pages when a later one fails", async () => {
    let call = 0;
    const fetchPage = vi.fn(async () => {
      call += 1;
      if (call === 1) return page([thread(1), thread(2)], true);
      throw new Error("boom");
    });

    renderWithProviders(
      <ThreadList
        queryKey={["test", "error-after-load"]}
        fetchPage={fetchPage}
        emptyTitle="Nothing here"
      />,
    );

    expect(await screen.findByText("Thread 1")).toBeInTheDocument();

    screen.getByRole("button", { name: "social.loadMorePlain" }).click();

    await waitFor(() => expect(fetchPage).toHaveBeenCalledTimes(2));
    // Both rows survive the failure, rather than being replaced by one red line.
    expect(screen.getByText("Thread 1")).toBeInTheDocument();
    expect(screen.getByText("Thread 2")).toBeInTheDocument();
  });
});

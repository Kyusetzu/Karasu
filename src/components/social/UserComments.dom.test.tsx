import { describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import type { UserCommentPage, UserForumComment } from "@/api/social";
import { renderWithProviders } from "@/test/render";

vi.mock("@/api/anilist", async (orig) => ({
  ...(await orig<typeof import("@/api/anilist")>()),
  isTauri: true,
}));

const fetchPage = vi.fn<(userId: number, page?: number) => Promise<UserCommentPage>>();

vi.mock("@/api/social", async (orig) => ({
  ...(await orig<typeof import("@/api/social")>()),
  userForumComments: (userId: number, page?: number) => fetchPage(userId, page),
}));

import { UserComments } from "./UserComments";

const comment = (id: number, title: string, text: string): UserForumComment => ({
  id,
  comment: text,
  likeCount: 2,
  createdAt: 1_700_000_000,
  thread: { id: 1, title },
});

const page = (comments: UserForumComment[], hasNextPage: boolean): UserCommentPage => ({
  pageInfo: { total: comments.length, currentPage: 1, lastPage: hasNextPage ? 2 : 1, hasNextPage },
  comments,
});

/**
 * The same three paging states `ThreadList.dom.test.tsx` pins, on the same
 * grounds: the list uses the shared footer discipline, and each of these
 * fails against a naive implementation.
 */
describe("UserComments paging states", () => {
  it("renders a comment under its thread's title, markdown flattened", async () => {
    fetchPage.mockReset();
    fetchPage.mockResolvedValue(
      page([comment(1, "New User Intro Thread - Welcome!", "__ello__ looking for a friend")], false),
    );

    renderWithProviders(<UserComments userId={8205117} emptyTitle="empty" />);

    expect(await screen.findByText("New User Intro Thread - Welcome!")).toBeTruthy();
    // `renderPlain` strips the markup and keeps the words.
    expect(screen.getByText(/ello looking for a friend/)).toBeTruthy();
    expect(screen.queryByText(/__ello__/)).toBeNull();
  });

  it("still offers the next page when the first one came back empty", async () => {
    fetchPage.mockReset();
    fetchPage.mockResolvedValue(page([], true));

    renderWithProviders(<UserComments userId={2} emptyTitle="nothing yet" />);

    expect(await screen.findByText("nothing yet")).toBeTruthy();
    expect(screen.getByRole("button", { name: "social.loadMorePlain" })).toBeTruthy();
  });

  it("keeps the loaded pages when a later one fails", async () => {
    fetchPage.mockReset();
    let call = 0;
    fetchPage.mockImplementation(async () => {
      call += 1;
      if (call === 1) return page([comment(1, "Thread A", "hi"), comment(2, "Thread B", "yo")], true);
      throw new Error("boom");
    });

    renderWithProviders(<UserComments userId={3} emptyTitle="empty" />);

    expect(await screen.findByText("Thread A")).toBeTruthy();
    screen.getByRole("button", { name: "social.loadMorePlain" }).click();

    await waitFor(() => expect(fetchPage).toHaveBeenCalledTimes(2));
    expect(screen.getByText("Thread A")).toBeTruthy();
    expect(screen.getByText("Thread B")).toBeTruthy();
  });
});

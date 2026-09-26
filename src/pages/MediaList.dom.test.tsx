import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { entry, listResult, media } from "@/test/fixtures";
import { signIn } from "@/test/render";
import MediaList from "./MediaList";

/** The header against a real browser history: a panel's choice must reach the URL without costing a back press. */

vi.mock("@/api/anilist", async (original) => ({
  ...(await original<typeof import("@/api/anilist")>()),
  fetchMediaList: vi.fn(async () =>
    listResult([
      entry({ id: 1, media: media({ id: 1, format: "TV" }) }),
      entry({ id: 2, media: media({ id: 2, format: "MOVIE" }) }),
    ]),
  ),
  flushQueue: vi.fn(async () => {}),
}));

function page(url: string) {
  window.history.replaceState(null, "", "/start");
  window.history.pushState(null, "", url);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <BrowserRouter>
        <MediaList type="ANIME" />
      </BrowserRouter>
    </QueryClientProvider>,
  );
}

/** Past every pending history traversal; jsdom delivers a `back()` a task later, as a browser does. */
const onPanelEntry = () => (window.history.state as { karasuBack?: number } | null)?.karasuBack !== undefined;
const chips = () => screen.queryByRole("group", { name: "list.activeFilters" });

beforeEach(() => {
  document.documentElement.setAttribute("data-reduce-motion", "");
  signIn();
});
afterEach(async () => {
  cleanup();
  document.documentElement.removeAttribute("data-reduce-motion");
  await waitFor(() => {
    if (onPanelEntry()) throw new Error("a panel's history entry is still unwinding");
  });
});

describe("MediaList header", () => {
  /** A replace while the panel's entry is on top would overwrite it, and the next back would undo the filter. */
  it("writes a panel's filter on close and leaves back to leave the page", async () => {
    page("/list");
    fireEvent.click(await screen.findByRole("button", { name: "list.filters" }));
    fireEvent.click(screen.getByRole("button", { name: "format.TV" }));
    // Drawn at once from the draft, before the URL has it.
    expect(within(chips()!).getByRole("button", { name: /format\.TV/ })).toBeInTheDocument();
    expect(window.location.search).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "common.done" }));
    await waitFor(() => expect(window.location.search).toBe("?format=TV"));
    expect(onPanelEntry()).toBe(false);
    window.history.back();
    await waitFor(() => expect(window.location.pathname).toBe("/start"));
  });

  it("lets a chip pressed as the panel closes win over the panel's own choice", async () => {
    page("/list");
    fireEvent.click(await screen.findByRole("button", { name: "list.filters" }));
    fireEvent.click(screen.getByRole("button", { name: "format.TV" }));
    const chip = within(chips()!).getByRole("button", { name: /format\.TV/ });
    fireEvent.pointerDown(chip);
    fireEvent.click(chip);
    await waitFor(() => expect(chips()).toBeNull());
    expect(window.location.search).toBe("");
  });

  it("finds in the list on Ctrl+F even on an empty tab, and not under an open panel", async () => {
    page("/list?tab=PAUSED");
    const search = await screen.findByRole("searchbox", { name: "list.searchLabel" });
    fireEvent.keyDown(window, { key: "f", ctrlKey: true });
    expect(search).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "list.filters" }));
    const panel = screen.getByRole("dialog", { name: "list.filters" });
    await waitFor(() => expect(panel).toContainElement(document.activeElement as HTMLElement));
    fireEvent.keyDown(window, { key: "f", ctrlKey: true });
    expect(panel).toContainElement(document.activeElement as HTMLElement);
  });

  /** An empty tab is a fact about the list; blaming the filter for it would send the user hunting for a cause. */
  it("calls an empty tab empty even while a filter is set", async () => {
    page("/list?tab=PAUSED&format=TV");
    expect(await screen.findByText(/^list\.emptyTab:/)).toBeInTheDocument();
    expect(screen.queryByText(/^list\.noMatch/)).toBeNull();
  });

  it("clears every filter and the search from the no-match state", async () => {
    page("/list?format=OVA&q=zzz");
    fireEvent.click(await screen.findByRole("button", { name: "list.clearFilter" }));
    await waitFor(() => expect(window.location.search).toBe(""));
    expect(screen.getByRole("searchbox", { name: "list.searchLabel" })).toHaveValue("");
  });
});

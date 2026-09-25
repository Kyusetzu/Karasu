import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRef } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { checkA11y } from "@/test/a11y";
import { CLEAR_FILTERS, parseListView, type ListView } from "@/lib/listFilters";
import type { MediaType } from "@/api/types";
import { ListMoreMenu, ListToolbar, type ListToolbarProps } from "./ListToolbar";

/** The list header's controls on their own: what each panel offers, what it reports, and what the chips undo. */

function Probe(over: Partial<ListToolbarProps> & { url?: string }) {
  const searchRef = useRef<HTMLInputElement>(null);
  const type: MediaType = over.type ?? "ANIME";
  const view: ListView = over.view ?? parseListView(new URLSearchParams(over.url ?? ""), type);
  return (
    <ListToolbar
      type={type}
      view={view}
      query=""
      onQuery={vi.fn()}
      searchRef={searchRef}
      shown={3}
      total={18}
      listNames={["Faves"]}
      tags={["cozy", "dub"]}
      presets={[{ name: "Airing", tab: "CURRENT", filter: "", sort: "updated" }]}
      onApplyPreset={vi.fn()}
      onManagePresets={vi.fn()}
      onRandom={vi.fn()}
      layout="grid"
      onLayout={vi.fn()}
      onDraft={vi.fn()}
      onChange={vi.fn()}
      onPanelOpen={vi.fn()}
      onPanelClosed={vi.fn()}
      phone={false}
      touch={false}
      {...over}
    />
  );
}

const button = (name: string | RegExp) => screen.getByRole("button", { name });
const dialog = (name: string) => screen.getByRole("dialog", { name });
const user = () => userEvent.setup({ delay: null });

beforeEach(() => document.documentElement.setAttribute("data-reduce-motion", ""));
afterEach(async () => {
  cleanup();
  document.documentElement.removeAttribute("data-reduce-motion");
  // A panel left open unwinds its history entry after the test; the next one must not open behind it.
  await waitFor(() => {
    if ((window.history.state as { karasuBack?: number } | null)?.karasuBack !== undefined) throw new Error("unwinding");
  });
});

describe("ListToolbar", () => {
  it("names the sort in its trigger and offers every key with the current one checked", () => {
    render(<Probe url="sort=title&dir=desc" />);
    fireEvent.click(button('list.sortButton:{"key":"sort.title","dir":"list.descending"}'));
    const panel = dialog("list.sortTitle");
    expect(within(panel).getByRole("radio", { name: "sort.title" })).toBeChecked();
    expect(within(panel).getByRole("radio", { name: "list.descending" })).toBeChecked();
    expect(within(panel).getAllByRole("radio")).toHaveLength(6);
  });

  /** "Score, ascending" was a choice about scores; a new key starts from its own default. */
  it("resets the direction with a new key and keeps the key with a new direction", () => {
    const onDraft = vi.fn();
    render(<Probe url="sort=score&dir=asc" onDraft={onDraft} />);
    fireEvent.click(button(/^list\.sortButton/));
    fireEvent.click(screen.getByRole("radio", { name: "sort.title" }));
    expect(onDraft).toHaveBeenLastCalledWith({ sort: "title", dir: "" });
    fireEvent.click(screen.getByRole("radio", { name: "list.descending" }));
    expect(onDraft).toHaveBeenLastCalledWith({ sort: "score", dir: "" });
  });

  it("offers the origin to manga only", async () => {
    const { unmount } = render(<Probe type="ANIME" />);
    fireEvent.click(button("list.filters"));
    expect(screen.queryByRole("group", { name: "list.originLabel" })).toBeNull();
    unmount();
    render(<Probe type="MANGA" />);
    fireEvent.click(button("list.filters"));
    // The first panel's entry is still unwinding, so this one opens a popstate later.
    expect(await screen.findByRole("group", { name: "list.originLabel" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "list.originKR" })).toBeInTheDocument();
  });

  it("drafts a filter, lets the same pill take it off, and resets only the panel filters", () => {
    const onDraft = vi.fn();
    render(<Probe url="format=TV&q=x&sort=title" onDraft={onDraft} />);
    fireEvent.click(button(/^list\.filtersActive/));
    fireEvent.click(screen.getByRole("button", { name: "format.MOVIE" }));
    expect(onDraft).toHaveBeenLastCalledWith({ format: "MOVIE" });
    fireEvent.click(screen.getByRole("button", { name: "format.TV", pressed: true }));
    expect(onDraft).toHaveBeenLastCalledWith({ format: "" });
    fireEvent.click(within(dialog("list.filters")).getByRole("button", { name: "list.resetFilters" }));
    expect(onDraft).toHaveBeenLastCalledWith(CLEAR_FILTERS);
  });

  it("disables the panel's reset while nothing is filtered", () => {
    render(<Probe />);
    fireEvent.click(button("list.filters"));
    expect(within(dialog("list.filters")).getByRole("button", { name: "list.resetFilters" })).toBeDisabled();
  });

  it("counts the active filters in the trigger and draws one chip each, which undo on their own", () => {
    const onChange = vi.fn();
    render(<Probe url="format=TV&tag=cozy&list=Faves" onChange={onChange} />);
    expect(button('list.filtersActive:{"n":3}')).toBeInTheDocument();
    const chips = screen.getByRole("group", { name: "list.activeFilters" });
    fireEvent.click(within(chips).getByRole("button", { name: 'list.removeFilter:{"name":"cozy"}' }));
    expect(onChange).toHaveBeenLastCalledWith({ tag: "" });
    fireEvent.click(within(chips).getByRole("button", { name: "list.resetFilters" }));
    expect(onChange).toHaveBeenLastCalledWith(CLEAR_FILTERS);
  });

  it("draws no chip row while only the search or the sort is set", () => {
    render(<Probe url="q=x&sort=title" />);
    expect(screen.queryByRole("group", { name: "list.activeFilters" })).toBeNull();
  });

  it("shows the match count only while something narrows the tab", () => {
    const { rerender } = render(<Probe />);
    expect(screen.queryByRole("status")).toBeNull();
    rerender(<Probe query="bebop" />);
    expect(screen.getByRole("status")).toHaveTextContent('list.matchCount:{"shown":3,"total":18}');
  });

  it("hints the shortcut only on an empty field with a keyboard to press it on", () => {
    const { rerender } = render(<Probe />);
    expect(screen.getByText("Ctrl F")).toBeInTheDocument();
    expect(screen.getByRole("searchbox")).toHaveAttribute("aria-keyshortcuts", "Control+F");
    rerender(<Probe query="x" />);
    expect(screen.queryByText("Ctrl F")).toBeNull();
    rerender(<Probe touch />);
    expect(screen.queryByText("Ctrl F")).toBeNull();
    expect(screen.getByRole("searchbox")).not.toHaveAttribute("aria-keyshortcuts");
  });

  it("empties a filled search on Escape and lets go of an empty one", async () => {
    const onQuery = vi.fn();
    const { rerender } = render(<Probe query="x" onQuery={onQuery} />);
    const u = user();
    screen.getByRole("searchbox").focus();
    await u.keyboard("{Escape}");
    expect(onQuery).toHaveBeenLastCalledWith("");
    rerender(<Probe query="" onQuery={onQuery} />);
    await u.keyboard("{Escape}");
    expect(screen.getByRole("searchbox")).not.toHaveFocus();
  });

  it("searches the tags once there are many, and keeps the chosen one in view", async () => {
    const tags = Array.from({ length: 14 }, (_, i) => `tag${i}`).concat("zebra");
    render(<Probe tags={tags} url="tag=tag3" />);
    fireEvent.click(button(/^list\.filtersActive/));
    const u = user();
    await u.type(screen.getByRole("searchbox", { name: "list.filterTags" }), "zebra");
    const group = screen.getByRole("group", { name: "tags.label" });
    expect(within(group).getAllByRole("button").map((b) => b.textContent)).toEqual(["tag3", "zebra"]);
  });

  it("reports a panel opening and closing, so the page can flush the search and commit the draft", () => {
    const onPanelOpen = vi.fn();
    const onPanelClosed = vi.fn();
    render(<Probe onPanelOpen={onPanelOpen} onPanelClosed={onPanelClosed} />);
    fireEvent.click(button("list.filters"));
    expect(onPanelOpen).toHaveBeenCalledTimes(1);
    fireEvent.click(within(dialog("list.filters")).getByRole("button", { name: "common.done" }));
    expect(onPanelClosed).toHaveBeenCalledTimes(1);
  });

  it("applies a preset once its panel has unwound", async () => {
    const onApplyPreset = vi.fn();
    render(<Probe onApplyPreset={onApplyPreset} />);
    fireEvent.click(button("presets.button"));
    fireEvent.click(within(dialog("presets.title")).getByRole("button", { name: /^Airing/ }));
    await waitFor(() => expect(onApplyPreset).toHaveBeenCalledWith("Airing"));
  });

  it("keeps the phone's toolbar to search, sort and filters, as sheets", () => {
    render(<Probe phone url="format=TV" />);
    expect(screen.queryByRole("button", { name: "presets.button" })).toBeNull();
    expect(screen.queryByRole("radiogroup", { name: "list.view" })).toBeNull();
    fireEvent.click(button(/^list\.filtersActive/));
    const panel = dialog("list.filters");
    expect(panel.parentElement).toHaveAttribute("data-overlay");
  });

  describe("axe", () => {
    it("passes closed, with chips", async () => {
      const { container } = render(<Probe url="format=TV&tag=cozy" query="x" />);
      expect(await checkA11y(container)).toHaveNoViolations();
    });

    it.each([
      ["sort", /^list\.sortButton/],
      ["filters", "list.filters"],
      ["presets", "presets.button"],
    ] as const)("passes with the %s panel open", async (_, trigger) => {
      const { container } = render(<Probe type="MANGA" />);
      fireEvent.click(button(trigger));
      expect(await checkA11y(container)).toHaveNoViolations();
    });

    it("passes with a phone sheet and the more menu open", async () => {
      render(
        <>
          <Probe phone />
          <ListMoreMenu
            type="ANIME"
            presets={[]}
            onApplyPreset={vi.fn()}
            onManagePresets={vi.fn()}
            onRandom={vi.fn()}
            layout="rows"
            onLayout={vi.fn()}
          />
        </>,
      );
      fireEvent.click(button("list.more"));
      expect(screen.getByRole("radiogroup", { name: "list.view" })).toBeInTheDocument();
      expect(await checkA11y(document.body)).toHaveNoViolations();
    });
  });
});

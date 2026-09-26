import { afterEach, describe, expect, it } from "vitest";
import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CommandPalette from "./CommandPalette";
import { renderWithProviders, signIn, signOut } from "@/test/render";
import { entry, listResult, media } from "@/test/fixtures";
import { usePlatform } from "@/stores/platform";

const RECENT = "karasu-palette-recent";

afterEach(() => {
  localStorage.removeItem(RECENT);
  usePlatform.setState({ info: null });
  signOut();
});

function openPalette() {
  act(() => {
    window.dispatchEvent(new Event("open-command-palette"));
  });
}

function groupNames(): string[] {
  return within(screen.getByRole("listbox"))
    .getAllByRole("group")
    .map((g) => g.getAttribute("aria-labelledby") ?? "");
}

/** The empty palette: what was used lately beside the keys worth knowing, and never a title in either. */
describe("CommandPalette", () => {
  it("offers the commands alone until something has been used, beside the main shortcuts", () => {
    signIn();
    renderWithProviders(<CommandPalette />);
    openPalette();
    expect(groupNames()).toEqual(["palette-group-palette.groupActions"]);
    const keys = screen.getByRole("region", { name: "palette.groupShortcuts" });
    // Worded as the row it names, and one cap for the whole combination.
    expect(within(keys).getByText("sync.button")).toBeInTheDocument();
    expect(within(keys).getByText("Ctrl R")).toBeInTheDocument();
    expect(within(keys).getByText("palette.keyClose")).toBeInTheDocument();
  });

  it("shows only the recent screens and commands once one has been used", async () => {
    const user = userEvent.setup({ delay: null });
    signIn();
    renderWithProviders(<CommandPalette />);
    openPalette();
    await user.type(screen.getByRole("combobox"), "nav.calendar{Enter}");
    openPalette();
    expect(groupNames()).toEqual(["palette-group-palette.groupRecent"]);
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["nav.calendar"]);
  });

  it("never remembers a title picked from the list", async () => {
    const user = userEvent.setup({ delay: null });
    const viewer = signIn();
    const { queryClient } = renderWithProviders(<CommandPalette />);
    queryClient.setQueryData(["mediaList", "ANIME", viewer.id], listResult([entry({ media: media({ id: 21 }) })]));
    openPalette();
    await user.type(screen.getByRole("combobox"), "Bebop");
    expect(screen.getByRole("option", { name: /Cowboy Bebop/ })).toBeInTheDocument();
    await user.keyboard("{Enter}");
    expect(localStorage.getItem(RECENT)).toBe("[]");
    openPalette();
    expect(groupNames()).not.toContain("palette-group-palette.groupRecent");
  });

  it("gives the whole width to the results once something is typed", async () => {
    const user = userEvent.setup({ delay: null });
    signIn();
    renderWithProviders(<CommandPalette />);
    openPalette();
    await user.type(screen.getByRole("combobox"), "cal");
    expect(screen.queryByRole("region", { name: "palette.groupShortcuts" })).toBeNull();
  });

  it("shows no keyboard reference on a phone", () => {
    usePlatform.setState({ info: { os: "android", appImage: false } });
    signIn();
    renderWithProviders(<CommandPalette />);
    openPalette();
    expect(screen.queryByRole("region", { name: "palette.groupShortcuts" })).toBeNull();
  });
});

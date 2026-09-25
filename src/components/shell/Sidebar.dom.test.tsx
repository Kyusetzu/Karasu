import { afterEach, describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Sidebar from "./Sidebar";
import { renderWithProviders, signIn } from "@/test/render";
import { saveCollapsed } from "@/lib/sidebarWidth";

afterEach(() => saveCollapsed(false));

/** The rail keeps every destination named: by its label when open, by a tooltip of its own when collapsed. */
describe("Sidebar", () => {
  it("names a collapsed item in a tooltip on hover, and leaves no native title to double it", async () => {
    const user = userEvent.setup({ delay: null });
    saveCollapsed(true);
    signIn();
    renderWithProviders(<Sidebar />);
    const calendar = screen.getByRole("link", { name: "nav.calendar" });
    expect(calendar).not.toHaveAttribute("title");
    await user.hover(calendar);
    await waitFor(() => expect(screen.getByText("nav.calendar")).toBeInTheDocument(), { timeout: 2000 });
  });

  it("shows the collapsed avatar at its own size rather than squeezed into a doubly inset column", () => {
    saveCollapsed(true);
    const viewer = signIn({ avatar: { large: "https://img.example/me.png" } });
    renderWithProviders(<Sidebar />);
    const profile = screen.getByRole("link", { name: viewer.name });
    expect(profile.querySelector("img")).toHaveClass("size-7");
    // Inside a column that is already inset, a second inset left the disc narrower than itself.
    expect(profile.closest("div.flex-col")).not.toHaveClass("mx-2.5");
  });

  it("keeps the focus on the collapse toggle when it is pressed from the keyboard, both ways", async () => {
    const user = userEvent.setup({ delay: null });
    signIn();
    renderWithProviders(<Sidebar />);
    const toggle = screen.getByRole("button", { name: "nav.collapseSidebar" });
    toggle.focus();
    await user.keyboard("{Enter}");
    const expand = screen.getByRole("button", { name: "nav.expandSidebar" });
    expect(expand).toBe(toggle);
    expect(expand).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("button", { name: "nav.collapseSidebar" })).toHaveFocus();
  });

  it("adds no tooltip while the labels are showing", async () => {
    const user = userEvent.setup({ delay: null });
    signIn();
    renderWithProviders(<Sidebar />);
    await user.hover(screen.getByRole("link", { name: "nav.calendar" }));
    await new Promise((r) => setTimeout(r, 500));
    expect(screen.getAllByText("nav.calendar")).toHaveLength(1);
  });
});
